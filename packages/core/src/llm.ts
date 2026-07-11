import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger("llm");

export const MODEL = "claude-opus-4-8";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey() });
  }
  return client;
}

export interface StructuredCallOptions<T extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: T;
  /** Enable the server-side web search tool for research grounded in real sources. */
  allowWebSearch?: boolean;
  maxTokens?: number;
}

/**
 * A single structured request: adaptive thinking for reasoning depth, an
 * optional server-side web search tool for grounding, and a Zod schema that
 * constrains (and then validates) the final answer.
 *
 * Server-side tools cap themselves at 10 internal iterations and return
 * stop_reason "pause_turn" rather than erroring - this resumes automatically
 * by resending the conversation, exactly as the API expects.
 */
export async function structuredComplete<T extends z.ZodTypeAny>(
  options: StructuredCallOptions<T>,
): Promise<z.infer<T>> {
  const anthropic = getClient();
  const tools = options.allowWebSearch
    ? [{ type: "web_search_20260209" as const, name: "web_search" as const }]
    : undefined;

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: options.prompt }];

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: zodOutputFormat(options.schema),
      },
      tools,
      messages,
    });

    if (response.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: response.content }];
      logger.debug("resuming paused turn (server-tool iteration limit reached)", { attempt });
      continue;
    }

    if (response.stop_reason === "refusal") {
      throw new Error(
        "Model declined this request (safety refusal). The request as posed cannot be completed.",
      );
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    if (!textBlock) {
      throw new Error(`No text content in model response (stop_reason=${response.stop_reason})`);
    }

    const parsed = JSON.parse(textBlock.text);
    return options.schema.parse(parsed);
  }

  throw new Error("Exceeded resume attempts waiting on server-side web search iterations");
}
