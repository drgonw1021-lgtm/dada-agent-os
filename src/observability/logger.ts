import pino from "pino";

const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "production"
    ? undefined  // JSON to stdout in production
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
});

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function adapt(inner: pino.Logger): Logger {
  return {
    debug: (msg, ctx) => inner.debug(ctx || {}, msg),
    info: (msg, ctx) => inner.info(ctx || {}, msg),
    warn: (msg, ctx) => inner.warn(ctx || {}, msg),
    error: (msg, ctx) => inner.error(ctx || {}, msg),
    child: (bindings) => adapt(inner.child(bindings)),
  };
}

export function createLogger(name: string): Logger {
  return adapt(rootLogger.child({ component: name }));
}

export { rootLogger };
