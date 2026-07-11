# Architecture

## The order lifecycle, end to end

Every hop in this system - buyer to Diligence Lead, Diligence Lead to Source
Finder, Diligence Lead to Claim Grader - goes through the same CAP order
lifecycle. There is no shortcut for internal hops; the orchestrator hires its
own sub-agents exactly the way an external buyer would hire it.

```
Requester                                    Provider
    |                                            |
    |--- negotiateOrder({serviceId, ... }) ----->|
    |                                            |--- acceptNegotiation()
    |<---------- EventType.OrderCreated ---------|      (order now exists on-chain)
    |--- payOrder(orderId) --------------------->|
    |                                            |<--- EventType.OrderPaid
    |                                            |--- does the work ---
    |                                            |--- deliverOrder(orderId, ...)
    |<-------- EventType.OrderCompleted ---------|
    |--- getDelivery(orderId) ------------------>|
```

`packages/core/src/providerRuntime.ts` implements the right-hand column once,
shared by Source Finder, Claim Grader, and Diligence Lead's own buyer-facing
listener. `packages/core/src/requesterRuntime.ts` (the `Hirer` class)
implements the left-hand column once, shared by every hire the orchestrator
makes. Neither file has any diligence-specific logic in it - they are pure
CAP plumbing. The three agents' own `src/index.ts` files are the only place
domain logic (what a research question looks like, how a claim gets graded)
appears.

## Why price lives on the service, not the request

CAP's `negotiateOrder` takes a `serviceId` and optional `requirements`/
`metadata` strings - there is no price field to propose. Price is set once,
when a service is registered. This has a real consequence for this system's
design: **Diligence Lead cannot choose how much to pay Source Finder or
Claim Grader per request** - it can only choose *how many times* to hire
them. That's why the interesting fund-flow decision in this codebase is
`maxAffordableQuestions()` in `packages/orchestrator/src/workflow.ts`,
not a price negotiation: the buyer's stated budget is translated into a
number of research sub-hires (capped at 3) that Source Finder's fixed price
and Claim Grader's fixed price can actually cover. A buyer who pays more
gets more independently-researched angles investigated, not a better price
per angle.

## The simulated transport

`CAP_MODE=simulated` (the default) swaps `@croo-network/sdk`'s `AgentClient`
for `SimAgentClient` (`packages/core/src/sim/simAgentClient.ts`), which
implements the identical public interface (`CapAgentClient` in
`capClient.ts`) against a SQLite file shared by every agent process
(`packages/core/src/sim/simStore.ts`). It reproduces:

- The same status vocabulary as the real SDK's `OrderStatus`/`NegotiationStatus`
  constants (`pending`, `accepted`, `created`, `paid`, `completed`, `rejected`).
- The same WebSocket event model (`connectWebSocket()` returning a stream
  with `.on(eventType, handler)` / `.onAny(handler)` / `.close()`), driven by
  a 400ms poll over the shared database rather than a real socket - each
  event is delivered exactly once per agent, tracked in a `seen_events` table,
  so restarting one agent mid-flow doesn't replay history at it.
- The "no proof, no payment" rule: `deliverOrder` with an empty deliverable
  throws rather than silently clearing, the same as a real invalid submission
  would surface as an `APIError` from the live SDK.

Because `CapAgentClient` is the same interface either way, and both
`negotiateOrder`/`acceptNegotiation`/`payOrder`/`deliverOrder` calls and the
WebSocket event names are identical, switching to `CAP_MODE=live` is a
one-line environment change, not a code change. `packages/core/src/sim/simAgentClient.test.ts`
exercises the full lifecycle against this transport and is the fastest way
to confirm a change to the orchestration logic hasn't broken the state
machine.

## Reputation without a discovery API

CAP does not currently expose an endpoint to search or rank agents/services
programmatically - confirmed by reading the shipped SDK's type declarations,
not assumed. `DiligenceDB.reputationFor(serviceId)` (`packages/core/src/db.ts`)
computes a completed-vs-failed count from this system's own observed audit
trail instead: every hire this network has ever made is recorded, on
success or failure, and that history is the only trust signal used or
claimed. Nothing in this codebase claims to rank third-party agents it has
no data on - that would be a fabricated feature.

## A worked example: driving one report in simulated mode

```bash
# terminal 1
npm run dev:source-finder
# terminal 2
npm run dev:claim-grader
# terminal 3
npm run dev:orchestrator
# terminal 4
npm run dev:dashboard
# terminal 5 - act as a buyer
npm run demo:buyer -- "Is the CROO Agent Protocol a credible foundation to build on?"
```

The buyer script (`packages/orchestrator/src/simulate-buyer.ts`) uses the
exact same `createCapClient` / `Hirer` pair every other requester in this
system uses - it is not a special-cased mock, just a fifth CAP identity
playing the buyer's role. Watch the dashboard at `http://localhost:4400`
while it runs: the orders table fills in as each hop clears, and the report
appears with its full audit trail once Diligence Lead delivers.
