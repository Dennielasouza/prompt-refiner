import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { ErrorResponseBody, HealthResponseBody, RefineResponseBody } from "../../shared/api.js";
import type { AppConfig } from "./config/env.js";
import { callCostUsd } from "./config/pricing.js";
import { refinePrompt } from "./engine/compiler.js";
import { COMPILER_VERSION } from "./engine/instruction.js";
import { DEPTHS, FORMATS, KINDS, MAX_INPUT_CHARS, REQUESTED_TARGETS, type RefineInput } from "./engine/types.js";
import { type CompilerProvider, ProviderError, type ProviderErrorKind, type TokenUsage } from "./providers/types.js";

const ERROR_STATUS: Record<ProviderErrorKind, number> = {
  timeout: 504,
  rate_limited: 503,
  auth: 503,
  refusal: 422,
  invalid_output: 502,
  upstream: 502,
};

const refineBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "target"],
  properties: {
    text: { type: "string" },
    target: { type: "string", enum: [...REQUESTED_TARGETS] },
    hostname: { type: "string", maxLength: 253, pattern: "^[A-Za-z0-9.-]*$" },
    language: { type: "string", maxLength: 35, pattern: "^[A-Za-z0-9-]*$" },
    depth: { type: "string", enum: [...DEPTHS] },
    format: { type: "string", enum: [...FORMATS] },
    kind: { type: "string", enum: [...KINDS] },
  },
} as const;

function errorBody(code: string, message: string): ErrorResponseBody {
  return { error: { code, message } };
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((rule) => (rule.endsWith("*") ? origin.startsWith(rule.slice(0, -1)) : origin === rule));
}

export function buildServer(
  config: AppConfig,
  provider: CompilerProvider | null,
  logger: FastifyServerOptions["logger"] = true,
): FastifyInstance {
  // Default request logging includes method/url only — never bodies.
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    // Strict validation: no type coercion, unknown fields are rejected (not silently dropped).
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  // JSON only. (Fastify parses text/plain by default.)
  app.removeContentTypeParser("text/plain");

  // CORS: the extension's service worker calls us from a chrome-extension:// origin.
  // Requests from any other browser origin (i.e. web pages) are rejected.
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) return;
    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      return reply.code(403).send(errorBody("origin_not_allowed", "Origem não permitida."));
    }
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
    if (req.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      reply.header("Access-Control-Max-Age", "600");
      return reply.code(204).send();
    }
  });

  app.setErrorHandler((err: { validation?: unknown; code?: string; statusCode?: number; message: string }, req, reply) => {
    if (err.validation) return reply.code(400).send(errorBody("invalid_request", err.message));
    if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(413).send(errorBody("too_large", "Requisição grande demais."));
    if (err.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.code(415).send(errorBody("unsupported_media_type", "Use Content-Type: application/json."));
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send(errorBody("bad_request", err.message));
    req.log.error({ code: err.code }, "unhandled error");
    return reply.code(500).send(errorBody("internal_error", "Erro interno."));
  });

  app.get("/api/health", async (): Promise<HealthResponseBody> => {
    if (!provider) {
      return { status: "misconfigured", provider: null, compilerVersion: COMPILER_VERSION, message: config.configError };
    }
    return { status: "ok", provider: provider.name, compilerVersion: COMPILER_VERSION };
  });

  app.post<{ Body: RefineInput }>("/api/refine", { schema: { body: refineBodySchema } }, async (req, reply) => {
    const { text, target, hostname, language, depth, kind } = req.body;
    const format = req.body.format ?? config.defaultFormat;
    if (!text.trim()) return reply.code(400).send(errorBody("empty_text", "O texto está vazio."));
    if (text.length > MAX_INPUT_CHARS) {
      return reply.code(413).send(errorBody("text_too_long", `O texto excede ${MAX_INPUT_CHARS} caracteres.`));
    }
    if (!provider) return reply.code(503).send(errorBody("not_configured", config.configError ?? "Backend sem provider."));

    const started = Date.now();
    let usage: TokenUsage | undefined;
    try {
      const result = await refinePrompt({ text, target, hostname, language, depth, format, kind }, provider, {
        timeoutMs: config.timeoutMs,
        onUsage: (u) => (usage = u),
      });
      // Metadata only — prompt contents are never logged.
      req.log.info(
        {
          target: result.target,
          depth: result.depth,
          format: result.format,
          kind: result.kind,
          taskType: result.taskType,
          complexity: result.complexity,
          inputChars: text.length,
          outputChars: result.refinedPrompt.length,
          warnings: result.warnings.length,
          ms: Date.now() - started,
          provider: config.provider,
          model: config.model,
          ...usage,
          costUsd: usage ? callCostUsd(config.provider, config.model, usage) : null,
        },
        "prompt refined",
      );
      const body: RefineResponseBody = {
        refinedPrompt: result.refinedPrompt,
        target: result.target,
        depth: result.depth,
        format: result.format,
        kind: result.kind,
        taskType: result.taskType,
        complexity: result.complexity,
        strategies: result.strategies,
        warnings: result.warnings,
      };
      return body;
    } catch (err) {
      if (err instanceof ProviderError) {
        // Failed calls may still have consumed tokens (e.g. truncated or invalid output).
        req.log.warn(
          {
            kind: err.kind,
            reason: err.message,
            ms: Date.now() - started,
            provider: config.provider,
            model: config.model,
            ...usage,
            costUsd: usage ? callCostUsd(config.provider, config.model, usage) : null,
          },
          "refine failed",
        );
        return reply.code(ERROR_STATUS[err.kind]).send(errorBody(err.kind, "Não foi possível refinar o prompt."));
      }
      throw err;
    }
  });

  return app;
}
