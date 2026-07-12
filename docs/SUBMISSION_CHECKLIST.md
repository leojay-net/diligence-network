# Submission checklist

Everything below is something only you can do — an account, a wallet, or a
button in a dashboard neither I nor the code can act on. Steps are ordered;
each one unblocks the next.

## 1. Push the repo to GitHub

The repo is already git-initialized locally with two commits.

```bash
cd diligence-network
gh repo create diligence-network --public --source=. --remote=origin
git push -u origin main
```

(No `gh` CLI? Create an empty repo at github.com/new, then
`git remote add origin <url> && git push -u origin main`.)

Submission requires a public repo with an MIT/Apache-2.0/similar license —
`LICENSE` is already MIT, so nothing else to do here.

## 2. Register four agents on the CROO Dashboard

Go to `agent.croo.network`, sign in (wallet, Google, or email), then repeat
**My Agents → Register Agent** four times — three real services plus one
lightweight buyer identity for testing/the demo recording:

| Agent | Register a service? | Notes |
|---|---|---|
| Diligence Lead | Yes | This is the buyer-facing one — the only one that needs to look good publicly |
| Source Finder | Yes | |
| Claim Grader | Yes | |
| Demo Buyer | No | Just an agent + wallet, used to play the buyer in testing and the recording |

For each of the three service agents, on the service wizard:

- **Service Name**: public-facing, e.g. "Diligence Lead", "Source Finder", "Claim Grader"
- **Price (USDC)**: matches `.env.example`'s defaults, or set your own —
  `ORCHESTRATOR_PRICE_USDC` / `SOURCE_FINDER_PRICE_USDC` / `CLAIM_GRADER_PRICE_USDC`
  just need to match whatever you actually register, so the orchestrator's
  budget math (`maxAffordableQuestions` in `packages/orchestrator/src/workflow.ts`)
  stays accurate
- **SLA**: minimum is 5 minutes; give Source Finder and Claim Grader enough
  room for a real web-search-backed Gemini call — 10–15 minutes is safer
  than the minimum. Diligence Lead's own SLA needs to cover the *whole*
  workflow (its own two sub-hires plus their SLAs), so give it the longest
  window, e.g. 30 minutes
- **Deliverable type**: Text (every agent here JSON-encodes its structured
  output into that field — matches the SDK's own example)
- **Requirements type**: Text (also JSON-encoded — see each agent's
  `parseRequest` in its `src/index.ts`)
- **Require Fund Transfer**: leave off — none of these are swap/cross-chain
  services

**Copy the API Key the instant it's shown — it's shown once per agent.**
Paste each into `.env`:

```
ORCHESTRATOR_SDK_KEY=...
SOURCE_FINDER_SDK_KEY=...
CLAIM_GRADER_SDK_KEY=...
```

(the Demo Buyer's key doesn't go in `.env` — see step 5)

Also copy each agent's **service ID** from its Configure page into:

```
ORCHESTRATOR_SERVICE_ID=...
SOURCE_FINDER_SERVICE_ID=...
CLAIM_GRADER_SERVICE_ID=...
```

## 3. Fund the wallets

Each agent's Configure page shows an **AA Wallet Address** — deposit USDC
(Base network) there, not the Owner/Executor address shown alongside it.

- Source Finder and Claim Grader each need enough for a handful of test
  orders at whatever price you set (a few dollars covers a lot of testing).
- Diligence Lead technically self-funds from what the buyer pays it, but
  fund it with a small buffer too (covers your first test run before any
  real buyer payment has landed, and covers the gap if a sub-hire's price
  is briefly more than what's already arrived).
- Fund the Demo Buyer wallet with enough to pay Diligence Lead's price a
  few times over, for testing and for the recording.

## 4. Flip to live mode

```
CAP_MODE=live
```

Nothing else changes — same code path either way, see
`packages/core/src/capClient.ts`.

## 5. Smoke-test before recording

Put the Demo Buyer's real SDK key and service ID in `.env`:

```
DEMO_BUYER_SDK_KEY=...
DEMO_BUYER_SERVICE_ID=...
```

Then:

```bash
npm run dev:source-finder     # separate terminals
npm run dev:claim-grader
npm run dev:orchestrator
npm run dev:dashboard
npm run demo:buyer -- "<a real subject>"
```

Watch `localhost:4400` fill in as each hop clears. If a step times out or
gets rejected, that's the SLA windows from step 2 being too tight for a real
Gemini + web-search round trip — loosen them before recording.

## 6. Record the demo

Follow `docs/DEMO_SCRIPT.md`. State on camera whether the run is live or
simulated — don't leave it ambiguous.

## 7. File the BUIDL on DoraHacks

All five submission requirements this maps to:
1. Listed on Agent Store — done in step 2
2. Integrated with CAP, settles on-chain — done in step 4
3. Open source, permissive license — done in step 1
4. Demo + README — step 6 + the repo's `README.md`
5. BUIDL filed on DoraHacks — fill in the DoraHacks form with the repo URL,
   demo video, and a description; pick Research & Intelligence Agents +
   Data & Verification Agents as the two tracks (max 2 per BUIDL)
