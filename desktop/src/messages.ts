/**
 * pt-BR explanations shown under "Não foi possível refinar o prompt.".
 * KEEP IN SYNC with RefineCore.backendErrorDetails in desktop/helper/RefineCore.swift
 * (the Swift unit tests compare both tables).
 */
export const BACKEND_ERROR_DETAILS: Record<string, string> = {
  not_configured: "O backend não está configurado (verifique o .env).",
  timeout: "O modelo demorou demais para responder. Tente novamente.",
  rate_limited: "O provedor de IA está sobrecarregado. Tente em instantes.",
  auth: "O backend não conseguiu autenticar no provedor de IA (verifique a chave de API).",
  refusal: "O modelo se recusou a refinar este texto.",
  invalid_output: "O modelo retornou uma resposta inválida. Tente novamente.",
  upstream: "Falha ao falar com o provedor de IA. Tente novamente.",
  text_too_long: "A seleção é longa demais.",
  empty_text: "A seleção está vazia.",
  origin_not_allowed: "O backend recusou a requisição (origem não permitida).",
  internal_error: "Erro interno do backend (veja o log do servidor).",
};

export const FAILED = "Não foi possível refinar o prompt.";
export const SELECT_PROMPT = "Selecione o prompt que deseja refinar.";

/** 12000 → "12.000" (same as RefineCore.formatCount). */
export const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function backendErrorDetail(code: string | undefined, status: number): string {
  return (code && BACKEND_ERROR_DETAILS[code]) || `O backend respondeu com erro ${code ?? `HTTP ${status}`}.`;
}

export const unavailableDetail = (endpoint: string) => `Backend indisponível em ${endpoint}.`;
export const timeoutDetail = (seconds: number) => `Tempo esgotado: o backend não respondeu em ${seconds} s.`;
export const invalidResponseDetail = "O backend retornou uma resposta inválida.";
export const tooLongDetail = (count: number, max: number) =>
  `A seleção tem ${formatCount(count)} caracteres; o limite é ${formatCount(max)}.`;
