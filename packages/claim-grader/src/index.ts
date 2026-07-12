import {
  config,
  createLogger,
  DiligenceDB,
  GradingRequestSchema,
  ClaimGraderOutputSchema,
  structuredComplete,
  runProviderService,
  type GradingRequest,
  type ClaimGraderOutput,
} from "@diligence-network/core";

const logger = createLogger("claim-grader");

const SYSTEM_PROMPT = `You are Claim Grader, a paid verification agent on the CAP network. You are
handed a set of claims, each already attached to the citations another agent
found for it, and your job is to independently judge whether the evidence
actually supports each claim.

Rules:
- Do not do your own research and do not take the submitting agent's framing
  at face value - read only the citation's "supports" text as the evidence,
  and judge whether it genuinely backs the claim as stated.
- "supported" requires the cited evidence to directly and specifically back
  the claim. "contradicted" means the evidence you were given actually
  conflicts with the claim. "unverifiable" means the evidence is too thin,
  vague, or off-topic to judge either way - this is a legitimate verdict, not
  a failure.
- If two claims in the set contradict each other, say so in "contradictions"
  even if each is individually plausible.
- Your rationale must reference the specific evidence you weighed, not just
  restate the claim.`;

async function handleGrading(request: GradingRequest): Promise<ClaimGraderOutput> {
  const claimsForPrompt = request.findings
    .map((finding, index) => {
      const evidence = finding.citations
        .map((citation) => `    - ${citation.url} ("${citation.title}"): ${citation.supports}`)
        .join("\n");
      return `${index + 1}. Claim: ${finding.claim}\n   Evidence:\n${evidence}`;
    })
    .join("\n\n");

  return structuredComplete({
    system: SYSTEM_PROMPT,
    prompt: `Grade the following claims against their supplied evidence:\n\n${claimsForPrompt}\n\nReturn your verdicts as structured JSON.`,
    schema: ClaimGraderOutputSchema,
    allowWebSearch: false,
    maxOutputTokens: 8000,
  });
}

async function main(): Promise<void> {
  const db = new DiligenceDB(config.dbPath());
  const serviceId = config.agents.claimGrader.serviceId();

  const runtime = await runProviderService<GradingRequest, ClaimGraderOutput>({
    role: "claim-grader",
    serviceId,
    sdkKey: config.agents.claimGrader.sdkKey(),
    serviceDescription: "Independent grading of claims against their supplied evidence.",
    db,
    logger,
    parseRequest: (requirements) => GradingRequestSchema.parse(JSON.parse(requirements)),
    handle: (request) => handleGrading(request),
    serializeResult: (result) => JSON.stringify(result),
  });

  const shutdown = () => {
    logger.info("shutting down");
    runtime.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("fatal error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
