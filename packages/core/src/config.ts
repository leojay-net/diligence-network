import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader so each service can run with `node --env-file` on older
 * Node versions too. If a real .env file is present we parse it by hand
 * rather than pulling in a dependency for something this small.
 */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export type CapMode = "live" | "simulated";

/**
 * In CAP, price is a property of a pre-registered *service* (set once on the
 * CROO Dashboard when the agent is onboarded), not something negotiated
 * per-request. Each of our three agents owns exactly one service, so a
 * service ID doubles as that agent's address in the network - this is why
 * every "which agent do I hire" reference below is a serviceId, not a
 * separate agentId concept.
 */
export const config = {
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  capMode: (): CapMode => (optional("CAP_MODE", "simulated") === "live" ? "live" : "simulated"),
  croo: {
    apiUrl: () => optional("CROO_API_URL", "https://api.croo.network"),
    wsUrl: () => optional("CROO_WS_URL", "wss://api.croo.network/ws"),
  },
  agents: {
    orchestrator: {
      sdkKey: () => process.env.ORCHESTRATOR_SDK_KEY ?? "",
      serviceId: () => optional("ORCHESTRATOR_SERVICE_ID", "diligence-lead-v1"),
      priceUsdc: () => optional("ORCHESTRATOR_PRICE_USDC", "4.00"),
    },
    sourceFinder: {
      sdkKey: () => process.env.SOURCE_FINDER_SDK_KEY ?? "",
      serviceId: () => optional("SOURCE_FINDER_SERVICE_ID", "source-finder-v1"),
      priceUsdc: () => optional("SOURCE_FINDER_PRICE_USDC", "0.50"),
    },
    claimGrader: {
      sdkKey: () => process.env.CLAIM_GRADER_SDK_KEY ?? "",
      serviceId: () => optional("CLAIM_GRADER_SERVICE_ID", "claim-grader-v1"),
      priceUsdc: () => optional("CLAIM_GRADER_PRICE_USDC", "0.35"),
    },
  },
  dbPath: () => optional("DILIGENCE_DB_PATH", "./data/diligence.sqlite"),
  simDbPath: () => optional("CAP_SIM_DB_PATH", "./data/cap-sim.sqlite"),
  dashboardPort: () => Number(optional("DASHBOARD_PORT", "4400")),
};
