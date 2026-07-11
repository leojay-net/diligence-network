type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? "info";

function log(level: Level, scope: string, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) => log("debug", scope, message, fields),
    info: (message: string, fields?: Record<string, unknown>) => log("info", scope, message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => log("warn", scope, message, fields),
    error: (message: string, fields?: Record<string, unknown>) => log("error", scope, message, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;
