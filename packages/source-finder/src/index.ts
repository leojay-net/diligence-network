import {
  config,
  createLogger,
  DiligenceDB,
  ResearchRequestSchema,
  SourceFinderOutputSchema,
  structuredComplete,
  runProviderService,
  type ResearchRequest,
  type SourceFinderOutput,
} from "@diligence-network/core";

const logger = createLogger("source-finder");

const SYSTEM_PROMPT = `You are Source Finder, a paid research agent on the CAP network. Given a
single question, use web search to find real, currently-accessible sources
and extract specific, checkable claims that answer it.

Rules:
- Every claim must be backed by at least one citation with a real URL that
  actually appeared in your search results. Never invent a URL or a source.
- Prefer primary sources (official docs, filings, the project's own
  repository or website) over secondary summaries when both are available.
- If you cannot find reliable sources for part of the question, say so in
  "gaps" rather than presenting a weakly-supported guess as a confident claim.
- Confidence scores are your own calibrated estimate, not a formality - a
  claim from one blog post should score lower than one confirmed by multiple
  independent primary sources.`;

async function handleResearch(request: ResearchRequest): Promise<SourceFinderOutput> {
  return structuredComplete({
    system: SYSTEM_PROMPT,
    prompt: `Research question: ${request.question}\n\nReturn your findings as structured JSON.`,
    schema: SourceFinderOutputSchema,
    allowWebSearch: true,
    maxOutputTokens: 8000,
  });
}

async function main(): Promise<void> {
  const db = new DiligenceDB(config.dbPath());
  const serviceId = config.agents.sourceFinder.serviceId();

  const runtime = await runProviderService<ResearchRequest, SourceFinderOutput>({
    role: "source-finder",
    serviceId,
    sdkKey: config.agents.sourceFinder.sdkKey(),
    serviceDescription: "Paid research with verifiable, cited sources for a single question.",
    db,
    logger,
    parseRequest: (requirements) => ResearchRequestSchema.parse(JSON.parse(requirements)),
    handle: (request) => handleResearch(request),
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
