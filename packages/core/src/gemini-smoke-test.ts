import { z } from "zod";
import { structuredComplete } from "./llm.js";

async function main() {
  console.log("--- structured output only ---");
  const plain = await structuredComplete({
    system: "Answer plainly.",
    prompt: "Name the capital of France and its approximate population.",
    schema: z.object({ capital: z.string(), approxPopulation: z.number() }),
    allowWebSearch: false,
  });
  console.log(plain);

  console.log("--- structured output + web search grounding ---");
  const grounded = await structuredComplete({
    system: "You are a research assistant. Use web search to answer with a real, current source.",
    prompt: "What is the current price of Bitcoin in USD, roughly? Cite the source URL.",
    schema: z.object({
      approxPriceUsd: z.number(),
      sourceUrl: z.string(),
    }),
    allowWebSearch: true,
  });
  console.log(grounded);

  console.log("PASS");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
