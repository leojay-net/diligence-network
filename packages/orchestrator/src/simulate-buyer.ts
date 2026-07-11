/**
 * A standalone script that plays the buyer's role against Diligence Lead,
 * using the exact same CapAgentClient interface every other agent in this
 * network uses. Run this (with CAP_MODE=simulated, and the orchestrator,
 * Source Finder, and Claim Grader all running via `npm run dev:*`) to drive
 * one full report end-to-end and print the result.
 *
 * Usage: npx tsx src/simulate-buyer.ts "<subject to investigate>"
 */
import { config, createCapClient, createLogger, Hirer } from "@diligence-network/core";

const logger = createLogger("simulate-buyer");

async function main(): Promise<void> {
  const subject = process.argv.slice(2).join(" ") || "The CROO Agent Protocol itself";

  const client = createCapClient({
    sdkKey: config.agents.demoBuyer.sdkKey(),
    serviceId: config.agents.demoBuyer.serviceId(),
  });
  const stream = await client.connectWebSocket();
  const hirer = new Hirer(client, stream, logger);

  logger.info("hiring Diligence Lead", { subject });
  const start = Date.now();

  const { result } = await hirer.hire<{
    subject: string;
    summary: string;
    confidenceScore: number;
    audit: Array<{ agentRole: string; serviceId: string; costUsdc: string }>;
  }>({
    serviceId: config.agents.orchestrator.serviceId(),
    requirements: { subject, budget: config.agents.orchestrator.priceUsdc() },
    deliveryTimeoutMs: 5 * 60_000,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("\n=== Diligence report ===\n");
  console.log(result.summary);
  console.log(`\nConfidence: ${result.confidenceScore}`);
  console.log(`Sub-agents hired: ${result.audit.map((a) => `${a.agentRole} (${a.serviceId}, ${a.costUsdc} USDC)`).join(", ")}`);
  console.log(`\nDelivered in ${elapsed}s.`);

  stream.close();
  process.exit(0);
}

main().catch((err) => {
  logger.error("buyer simulation failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
