import {
  type HealthResponseBody,
  type RefineRequestBody,
  type RefineResponseBody,
  TARGETS,
  type Target,
} from "../../shared/api.js";

export const REQUEST_TIMEOUT_MS = 60_000;

/** User-facing (pt-BR) explanation of a failure, shown under "Não foi possível refinar o prompt." */
export class RefineError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

const DETAILS: Record<string, string> = {
  timeout: "O refinamento demorou demais. Tente novamente.",
  not_configured: "O backend não está configurado (verifique o .env).",
  rate_limited: "O provedor de IA está sobrecarregado. Tente em instantes.",
  auth: "O backend não conseguiu autenticar no provedor de IA.",
  text_too_long: "O texto selecionado é longo demais.",
  origin_not_allowed: "O backend não aceita requisições desta extensão (ALLOWED_ORIGINS).",
  invalid_response: "O backend retornou uma resposta inválida.",
};

export function isRefineResponse(v: unknown): v is RefineResponseBody {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.refinedPrompt === "string" &&
    o.refinedPrompt.trim().length > 0 &&
    o.refinedPrompt.length <= 40_000 &&
    TARGETS.includes(o.target as Target)
  );
}

export async function requestRefinement(
  endpoint: string,
  body: RefineRequestBody,
  signal: AbortSignal,
): Promise<RefineResponseBody> {
  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      signal,
    });
  } catch {
    if (signal.aborted) throw signal.reason instanceof RefineError ? signal.reason : new RefineError("aborted");
    throw new RefineError("network", `Backend indisponível em ${endpoint}. Verifique se o servidor está rodando.`);
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data as { error?: { code?: unknown } } | null)?.error?.code;
    const c = typeof code === "string" ? code : `http_${res.status}`;
    throw new RefineError(c, DETAILS[c]);
  }
  if (!isRefineResponse(data)) throw new RefineError("invalid_response", DETAILS.invalid_response);
  return data;
}

export function timeoutError(): RefineError {
  return new RefineError("timeout", DETAILS.timeout);
}

export async function checkHealth(endpoint: string): Promise<HealthResponseBody> {
  const res = await fetch(`${endpoint}/api/health`, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => null)) as HealthResponseBody | null;
  if (!res.ok || !data || (data.status !== "ok" && data.status !== "misconfigured")) {
    throw new Error(`HTTP ${res.status}`);
  }
  return data;
}
