import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, createLogger, DiligenceDB } from "@diligence-network/core";

const logger = createLogger("dashboard");
const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(here, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(path: string): Promise<{ body: Buffer; contentType: string } | undefined> {
  const safePath = path === "/" ? "/index.html" : path;
  if (safePath.includes("..")) return undefined;
  try {
    const body = await readFile(join(publicDir, safePath));
    return { body, contentType: MIME[extname(safePath)] ?? "application/octet-stream" };
  } catch {
    return undefined;
  }
}

function main(): void {
  const db = new DiligenceDB(config.dbPath());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/orders") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(db.listOrders()));
      return;
    }

    if (url.pathname === "/api/reports") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(db.listReports()));
      return;
    }

    if (url.pathname.startsWith("/api/reports/")) {
      const id = url.pathname.slice("/api/reports/".length);
      const report = db.getReport(id);
      if (!report) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(report));
      return;
    }

    if (url.pathname === "/api/audit") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(db.listAuditEntries()));
      return;
    }

    const asset = await serveStatic(url.pathname);
    if (asset) {
      res.writeHead(200, { "Content-Type": asset.contentType });
      res.end(asset.body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  const port = config.dashboardPort();
  server.listen(port, () => {
    logger.info(`dashboard listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    logger.info("shutting down");
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
