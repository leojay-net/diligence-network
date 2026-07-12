import { FinishReason, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger("llm");

/**
 * Gemini 3.5 Flash is the cheapest current-generation model that supports
 * combining Structured Outputs with the built-in Google Search grounding
 * tool in a single call - Gemini 2.x models reject that combination outright.
 * Since Source Finder needs both at once, and Claim Grader shares the same
 * call path for consistency, this is the one model every agent in this
 * network uses.
 */
export const MODEL = "gemini-3.5-flash";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: config.geminiApiKey() });
  }
  return client;
}

export interface StructuredCallOptions<T extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: T;
  /** Enable Gemini's built-in Google Search grounding tool for research grounded in real sources. */
  allowWebSearch?: boolean;
  maxOutputTokens?: number;
}

/**
 * A single structured request: automatic thinking for reasoning depth, an
 * optional Google Search grounding tool, and a Zod schema that constrains
 * (via responseJsonSchema) and then validates the final answer. One
 * definition drives both, so the shape the model is constrained to and the
 * shape the rest of the system trusts can never drift apart.
 */
export async function structuredComplete<T extends z.ZodTypeAny>(
  options: StructuredCallOptions<T>,
): Promise<z.infer<T>> {
  const genai = getClient();

  const response = await genai.models.generateContent({
    model: MODEL,
    contents: options.prompt,
    config: {
      systemInstruction: options.system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(options.schema),
      tools: options.allowWebSearch ? [{ googleSearch: {} }] : undefined,
      thinkingConfig: { thinkingBudget: -1 }, // -1 = automatic, model decides how much to think
      maxOutputTokens: options.maxOutputTokens ?? 8000,
    },
  });

  const candidate = response.candidates?.[0];
  if (!candidate) {
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no candidates${blockReason ? ` (blocked: ${blockReason})` : ""}`);
  }
  if (
    candidate.finishReason &&
    candidate.finishReason !== FinishReason.STOP &&
    candidate.finishReason !== FinishReason.MAX_TOKENS
  ) {
    throw new Error(`Gemini stopped before finishing: ${candidate.finishReason}`);
  }

  const text = response.text;
  if (!text) {
    throw new Error("Gemini response contained no text content");
  }

  logger.debug("structured completion", { model: MODEL, finishReason: candidate.finishReason });

  const parsed = JSON.parse(text);
  return options.schema.parse(parsed);
}
