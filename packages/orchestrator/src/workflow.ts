import {
  config,
  createLogger,
  structuredComplete,
  DiligencePlanSchema,
  SourceFinderOutputSchema,
  ClaimGraderOutputSchema,
  type AuditEntry,
  type ClaimGraderOutput,
  type DiligenceReport,
  type DiligenceRequest,
  type Hirer,
  type ResearchFinding,
  type ResearchRequest,
  type GradingRequest,
  type SourceFinderOutput,
} from "@diligence-network/core";

const logger = createLogger("orchestrator:workflow");

const PLANNER_SYSTEM_PROMPT = `You are the planning step of a due-diligence orchestrator. Given a subject a
buyer wants investigated, propose the sub-questions that will get hired out
to an independent research agent. Pick whichever risk angles actually matter
for this specific subject - don't mechanically cover every category if the
subject doesn't call for it.`;

/**
 * How many sub-questions the buyer's payment actually funds: their budget
 * has to cover one Claim Grader pass plus one Source Finder hire per
 * question. This is the fund-flow contract made explicit - the report's
 * depth is a direct, honest function of what was paid for, not a fixed
 * number dressed up as configurable.
 */
export function maxAffordableQuestions(budgetUsdc: string): number {
  const budget = Number.parseFloat(budgetUsdc);
  const sourceFinderPrice = Number.parseFloat(config.agents.sourceFinder.priceUsdc());
  const claimGraderPrice = Number.parseFloat(config.agents.claimGrader.priceUsdc());
  if (!Number.isFinite(budget) || sourceFinderPrice <= 0) return 1;
  const affordable = Math.floor((budget - claimGraderPrice) / sourceFinderPrice);
  return Math.min(3, Math.max(1, affordable));
}

async function planQuestions(request: DiligenceRequest): Promise<string[]> {
  const cap = maxAffordableQuestions(request.budget);

  if (request.focusAreas && request.focusAreas.length > 0) {
    return request.focusAreas.slice(0, cap).map((area) => `Regarding "${request.subject}": ${area}`);
  }

  const plan = await structuredComplete({
    system: PLANNER_SYSTEM_PROMPT,
    prompt: `Subject: ${request.subject}\n\nPropose at most ${cap} sub-question(s).`,
    schema: DiligencePlanSchema,
    allowWebSearch: false,
    maxOutputTokens: 2000,
  });
  return plan.questions.slice(0, cap);
}

function buildReport(
  request: DiligenceRequest,
  findings: ResearchFinding[],
  gaps: string[],
  grading: ClaimGraderOutput,
  audit: AuditEntry[],
): DiligenceReport {
  const supported = grading.verdicts.filter((v) => v.verdict === "supported");
  const contradicted = grading.verdicts.filter((v) => v.verdict === "contradicted");
  const unverifiable = grading.verdicts.filter((v) => v.verdict === "unverifiable");

  const lines: string[] = [
    `Due diligence on: ${request.subject}`,
    `${grading.verdicts.length} claim(s) independently verified - ${supported.length} supported, ${contradicted.length} contradicted, ${unverifiable.length} unverifiable.`,
  ];

  if (contradicted.length > 0) {
    lines.push("Contradicted claims that need attention:");
    for (const verdict of contradicted) {
      lines.push(`  - ${verdict.claim} (${verdict.rationale})`);
    }
  }
  if (grading.contradictions.length > 0) {
    lines.push(`Cross-claim contradictions detected: ${grading.contradictions.join("; ")}`);
  }
  if (gaps.length > 0) {
    lines.push(`Could not be verified from sources actually found: ${gaps.join("; ")}`);
  }

  return {
    subject: request.subject,
    summary: lines.join("\n"),
    findings,
    verdicts: grading.verdicts,
    contradictions: grading.contradictions,
    confidenceScore: grading.overallConfidence,
    audit,
    generatedAt: new Date().toISOString(),
  };
}

export interface WorkflowResult {
  report: DiligenceReport;
}

export async function runDiligenceWorkflow(request: DiligenceRequest, hirer: Hirer): Promise<WorkflowResult> {
  const questions = await planQuestions(request);
  logger.info("plan complete", { subject: request.subject, questionCount: questions.length });

  const audit: AuditEntry[] = [];

  const researchHires = await Promise.all(
    questions.map(async (question, index) => {
      const startedAt = new Date().toISOString();
      const hireResult = await hirer.hire<SourceFinderOutput>({
        serviceId: config.agents.sourceFinder.serviceId(),
        requirements: { question } satisfies ResearchRequest,
      });
      // The provider's own structured-output contract already constrains this
      // shape; parse it again here so a malformed delivery fails loudly
      // instead of silently propagating bad data into the report.
      const validated = SourceFinderOutputSchema.parse(hireResult.result);
      audit.push({
        subtaskId: `research-${index + 1}`,
        agentRole: "source-finder",
        serviceId: hireResult.serviceId,
        orderId: hireResult.orderId,
        costUsdc: hireResult.priceUsdc,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
      });
      return validated;
    }),
  );

  const allFindings = researchHires.flatMap((r) => r.findings);
  const allGaps = researchHires.flatMap((r) => r.gaps);

  if (allFindings.length === 0) {
    throw new Error("Every research hire came back with no findings - nothing to grade or report.");
  }

  const gradingStartedAt = new Date().toISOString();
  const gradingHire = await hirer.hire<ClaimGraderOutput>({
    serviceId: config.agents.claimGrader.serviceId(),
    requirements: { findings: allFindings } satisfies GradingRequest,
  });
  const grading = ClaimGraderOutputSchema.parse(gradingHire.result);
  audit.push({
    subtaskId: "grading",
    agentRole: "claim-grader",
    serviceId: gradingHire.serviceId,
    orderId: gradingHire.orderId,
    costUsdc: gradingHire.priceUsdc,
    startedAt: gradingStartedAt,
    completedAt: new Date().toISOString(),
    status: "completed",
  });

  const report = buildReport(request, allFindings, allGaps, grading, audit);
  return { report };
}
