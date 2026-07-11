# Diligence Network

A verified due-diligence service built on the CROO Agent Protocol (CAP). A
buyer pays for a single report on a subject (a project, a counterparty, a
claim); underneath, the system fans that payment out to independently
listed, independently priced CAP agents, cross-checks their output against
each other, and settles every hop on-chain before delivering a report with a
full audit trail back to the buyer.

It is three separate agents, each with its own CAP identity, its own wallet,
and its own listing, not one process pretending to be three:

- **Diligence Lead** (`packages/orchestrator`) - the buyer-facing service.
  Takes a subject, decomposes it into sub-questions, hires the two agents
  below to answer and verify them, and delivers a synthesized report.
- **Source Finder** (`packages/source-finder`) - a research agent. Given one
  question, searches the web and returns claims, each backed by a citation
  with a real URL. Independently listed and independently useful - anyone on
  the network can hire it, not only Diligence Lead.
- **Claim Grader** (`packages/claim-grader`) - a verification agent. Given a
  set of claims and the evidence submitted for them, independently judges
  whether the evidence actually supports each claim, flags contradictions,
  and produces a confidence score. Also independently listed.

Diligence Lead is simultaneously a CAP provider (it sells the report) and a
CAP requester (it buys research and verification to produce that report) -
the same identity, doing both sides of the protocol in the same run. That is
the part of CAP that a single-purpose agent never exercises.

## Why this design

CAP's own submission rubric weights Technical Execution and A2A
Composability at 55% combined, and explicitly asks whether a submission
would be "impossible, or much worse, on a normal API marketplace." A single
agent that wraps one LLM call cannot answer that question - there is nothing
about it that requires on-chain commerce or agent-to-agent hiring. This
system's answer is concrete:

- **Genuine two-sided participation.** Diligence Lead is not a stub that
  calls two mock endpoints - Source Finder and Claim Grader are real,
  separately deployable, separately priced CAP services that settle real
  orders. The composability is empirical, not asserted: every hop is in the
  `orders` and `audit_entries` tables the dashboard reads from.
- **A real fund-flow problem, not a demo happy path.** A single buyer
  payment has to fan out into multiple sub-payments, with one sub-agent's
  price affecting how much research depth the buyer's budget can actually
  fund (see `maxAffordableQuestions` in `packages/orchestrator/src/workflow.ts`).
  That is an accounting and settlement problem, not a prompting problem.
- **Verify-the-verifiers, not verify-the-output.** Claim Grader does not
  re-run Source Finder's research; it independently judges whether the
  *evidence already gathered* actually supports each claim, on its own
  context, for its own fee. That separation - one agent finds, a different
  agent checks - is the trust layer a single agent can't provide for itself.
- **No platform discovery API, so we don't pretend there is one.** CAP does
  not currently expose a way to discover or rank other agents
  programmatically (confirmed against the published SDK, not assumed). A
  submission that claims to "dynamically rank agents by reputation" against
  that platform is describing a feature that doesn't exist. This system
  instead computes its own reputation signal from *observed, verifiable
  settlement outcomes* it stores locally (`DiligenceDB.reputationFor`) -
  real orders, not a fabricated ranking.

## Repository layout

```
diligence-network/
  packages/
    core/            shared domain types, CAP client, LLM client, persistence
    source-finder/   Source Finder agent (provider only)
    claim-grader/    Claim Grader agent (provider only)
    orchestrator/    Diligence Lead agent (provider + requester)
  apps/
    dashboard/       read-only operator console (orders, deliveries, audit trail)
  docs/
    ARCHITECTURE.md  order-lifecycle and fund-flow design in depth
    DEMO_SCRIPT.md   shot list for the submission demo video
```

## How CAP is actually used

This matters more than it usually would, so it's worth being precise about
what maps to what in `@croo-network/sdk` (all verified against the package's
own shipped type declarations, not guessed from the README alone):

| Concept | Where it lives |
|---|---|
| `AgentClient` (one per agent, authenticated by its own SDK-Key) | `packages/core/src/capClient.ts` → `createCapClient()` |
| `negotiateOrder` / `acceptNegotiation` / `rejectNegotiation` | `packages/core/src/providerRuntime.ts` (provider side), `packages/core/src/requesterRuntime.ts` (`Hirer`, requester side) |
| `payOrder` | `Hirer.hire()` in `requesterRuntime.ts` |
| `deliverOrder` / `getDelivery` | `providerRuntime.ts` (deliver), `requesterRuntime.ts` (fetch result) |
| `connectWebSocket` + `EventType.*` | Both runtimes - this is how every agent reacts to negotiations, payments, and deliveries in real time, exactly as CAP's own quick-start examples show |

A detail that shapes the whole system: **price is a property of a
pre-registered *service*, not something negotiated per request.** CAP's
`negotiateOrder` takes a `serviceId`, and that service's price is set once
when the agent is registered on the CROO Dashboard - there is no
"propose a price" step at request time. Each agent here owns exactly one
service, so a `serviceId` doubles as that agent's address on the network.
This is also why a generic "hire the best-priced agent" broker isn't
possible against the current SDK: there's no discovery endpoint to browse
services or prices from code, only the Dashboard UI.

### CAP integration notes for reviewers

- The SDK's `AgentClient` constructor takes no wallet private key - signing
  happens server-side, authenticated by an SDK-Key. Each agent's on-chain
  wallet address is issued by the Dashboard and must be funded with USDC
  there before it can pay for anything.
- `deliverOrder`'s `deliverableText` is a plain string. Every agent here
  JSON-serializes its structured output into that field and the buyer side
  parses it back - this follows the SDK's own quick-start example
  (`deliverableText: '{"analysis": "done", "score": 95}'`) rather than
  inventing a different convention.
- There is no `disputed` order status in the SDK's own `OrderStatus`
  constants - the real lifecycle is `created → paid → completed`, with
  `rejected`/`expired` as the failure branches before payment and
  `*_failed` variants for transaction failures. This system's audit trail
  uses that vocabulary rather than a `cleared`/`disputed` model that isn't
  what the protocol actually implements.
- WebSocket events (`order_negotiation_created`, `order_paid`,
  `order_completed`, etc.) are the primary integration point, matching the
  SDK's documented Provider/Requester quick-start patterns exactly.

## Running it

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Set `ANTHROPIC_API_KEY`. Everything else has a working default for
simulated mode.

### 3. Choose a mode

**Simulated (default, `CAP_MODE=simulated`).** A faithful reproduction of
CAP's own order lifecycle - negotiate, accept, pay, deliver, clear - backed
by a shared local SQLite file instead of the real network. Every agent's
business logic is byte-for-byte identical in this mode; only
`packages/core/src/capClient.ts`'s factory function decides which transport
to construct. This is what lets the whole system, including real Claude
API calls for research and grading, run end-to-end before any wallet is
funded or any Dashboard registration exists.

**Live (`CAP_MODE=live`).** Real `@croo-network/sdk` calls against
`api.croo.network`, real Base-mainnet USDC settlement. Requires, per agent:
a registered service on the CROO Dashboard, an issued SDK-Key, and a funded
on-chain wallet. Fill in `*_SDK_KEY` and `*_SERVICE_ID` in `.env` once those
exist. No code changes are needed to switch modes.

### 4. Run the three agents and the dashboard

```bash
npm run dev:source-finder
npm run dev:claim-grader
npm run dev:orchestrator
npm run dev:dashboard   # http://localhost:4400
```

In simulated mode, drive a full report end-to-end by acting as a buyer
against the orchestrator's service (`diligence-lead-v1` by default):

```bash
npm run demo:buyer -- "Is the CROO Agent Protocol a credible foundation to build on?"
```

This uses the same `createCapClient`/`Hirer` pair every other requester in
the system uses - see `docs/ARCHITECTURE.md` for the full walkthrough.

## Tests

```bash
npm test
```

Exercises the full negotiate → accept → pay → deliver → clear lifecycle
against the simulated transport, plus its refusal-on-empty-delivery
invariant.

## License

MIT - see `LICENSE`.
