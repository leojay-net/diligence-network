# Demo video shot list

Target length: under 5 minutes. Record after switching `CAP_MODE=live` with
funded wallets if at all possible - the judging rubric explicitly rewards
real CAP orders during the run; if that isn't ready in time, say so plainly
on camera rather than letting simulated mode pass silently as live.

## 1. What it is (30s)

State the one-sentence pitch on camera or in a title card: a due-diligence
service where the buyer's single payment is fanned out to independently
listed CAP agents that research and cross-verify each other's work, with
every hop settling on-chain and showing up in an audit trail. Do not mention
that this was built for a hackathon.

## 2. The three agents (30s)

Show the three `packages/*` directories for a few seconds each, or a single
slide listing them:

- Diligence Lead - buyer-facing, decomposes the request, hires the two below.
- Source Finder - paid research with cited sources.
- Claim Grader - independent verification of those claims against their evidence.

Say explicitly that all three are separately listed, separately priced, and
separately paid - this is the fact the rest of the video has to prove.

## 3. Live run (90-120s)

Start all three agents and the dashboard on screen (four terminal panes or a
tiled recording). Kick off one report via `npm run demo:buyer -- "<subject>"`
with a subject picked for the recording (something CAP-community-relevant
reads well here - a token, project, or protocol).

While it runs, narrate what's happening at each stage rather than sitting in
silence:

- Diligence Lead accepting the buyer's negotiation.
- Diligence Lead negotiating with Source Finder for each sub-question -
  point out this is a second, independent CAP order, not a function call.
- Source Finder's real web search and citations.
- The hire to Claim Grader once findings come back.
- Diligence Lead delivering the final report and the buyer script printing
  the summary and audit trail.

## 4. Dashboard (45s)

Switch to `http://localhost:4400`. Walk through:

- The Orders table filling in as each hop clears - point at the different
  `serviceId`s and directions (buyer vs. provider) to show this is real
  multi-party settlement, not one process.
- Click into the finished report: show the findings with real citation URLs,
  the verdicts Claim Grader produced, and the audit trail at the bottom
  listing every sub-agent hired, its cost, and its status.

## 5. Code highlights (60s)

Two short scrolls, no need to read code line by line on camera:

- `packages/orchestrator/src/workflow.ts` - point at `maxAffordableQuestions()`
  and say in one sentence that the buyer's budget determines how many
  independent sub-agents get hired, not a price negotiation (CAP prices are
  fixed per service).
- `packages/core/src/requesterRuntime.ts` - point at `Hirer.hire()` and note
  it wraps the real `negotiateOrder` / `payOrder` / `deliverOrder` /
  `connectWebSocket` calls from `@croo-network/sdk` directly - same calls,
  same event types as the SDK's own quick-start examples.

## 6. Close (15s)

State plainly whether this run was `CAP_MODE=live` or `simulated`, and if
simulated, say why (wallet funding still in progress, Dashboard registration
pending, etc.) rather than leaving it ambiguous. Judges can verify the claim
either way against the repo and the on-chain history.

## Recording notes

- Keep the terminal font large enough to read at 1080p.
- Don't cut around failures - if a hire times out or a delivery gets
  rejected on camera, that's a more convincing demonstration of real error
  handling than a scripted happy path with the messy parts edited out.
- End with the dashboard still open and the completed report visible, not on
  a terminal prompt.
