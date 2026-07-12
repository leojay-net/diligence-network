import { z } from "zod";

/**
 * Zod schemas double as the JSON Schema fed to Gemini's structured-output
 * config (via z.toJSONSchema) and as the runtime validator for the parsed
 * response - one definition, so the type the model is constrained to and the
 * type the rest of the system trusts can never drift apart.
 */

export const CitationSchema = z.object({
  url: z.string().describe("The exact source URL, taken from a web_search result - never invented."),
  title: z.string().describe("The page or document title."),
  supports: z.string().describe("The specific fact or quote from this source that backs the claim."),
});

export const ResearchFindingSchema = z.object({
  claim: z.string().describe("One specific, checkable factual claim relevant to the question."),
  citations: z.array(CitationSchema).min(1).describe("At least one real source backing this claim."),
  confidence: z.number().min(0).max(1).describe("This model's own confidence that the claim is accurate."),
});

export const SourceFinderOutputSchema = z.object({
  question: z.string(),
  findings: z.array(ResearchFindingSchema),
  gaps: z
    .array(z.string())
    .describe("Sub-questions that could not be answered from sources actually found."),
});

export const VerdictEnum = z.enum(["supported", "contradicted", "unverifiable"]);

export const ClaimVerdictSchema = z.object({
  claim: z.string(),
  verdict: VerdictEnum,
  confidence: z.number().min(0).max(1),
  rationale: z.string().describe("Why this verdict, referencing the specific evidence weighed."),
  citedEvidence: z
    .array(z.string())
    .describe("URLs from the supplied evidence that this verdict actually relied on."),
});

export const ClaimGraderOutputSchema = z.object({
  verdicts: z.array(ClaimVerdictSchema),
  contradictions: z
    .array(z.string())
    .describe("Plain-language description of any claims that conflict with one another."),
  overallConfidence: z.number().min(0).max(1),
});

// --- Wire-level request shapes: what goes into the CAP `requirements` string
// when one agent hires another. Kept separate from the output schemas above
// since a request is plain input, not something a model is constrained to
// produce. ---

export const DiligenceRequestSchema = z.object({
  subject: z.string().describe("Free-text description of what the buyer wants investigated."),
  focusAreas: z
    .array(z.string())
    .max(3)
    .optional()
    .describe("Optional: narrows the investigation into up to 3 specific angles."),
  budget: z.string().describe("Buyer's total budget for the whole report, in USDC, as a decimal string."),
});

export const ResearchRequestSchema = z.object({
  question: z.string(),
});

export const GradingRequestSchema = z.object({
  findings: z.array(ResearchFindingSchema).min(1),
});

export const DiligencePlanSchema = z.object({
  questions: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "Independently researchable sub-questions covering whichever risk angles matter most for this subject (e.g. team, tokenomics, security, legal, market) - do not force all of them if fewer are relevant.",
    ),
});

export type DiligenceRequest = z.infer<typeof DiligenceRequestSchema>;
export type DiligencePlan = z.infer<typeof DiligencePlanSchema>;
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;
export type GradingRequest = z.infer<typeof GradingRequestSchema>;

export type Citation = z.infer<typeof CitationSchema>;
export type ResearchFinding = z.infer<typeof ResearchFindingSchema>;
export type SourceFinderOutput = z.infer<typeof SourceFinderOutputSchema>;
export type Verdict = z.infer<typeof VerdictEnum>;
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;
export type ClaimGraderOutput = z.infer<typeof ClaimGraderOutputSchema>;
