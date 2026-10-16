/**
 * Tiny stopword-based language guess used only by the quality gate to flag
 * (never block) a refined prompt whose language drifted from the original.
 */
const STOPWORDS: Record<string, string[]> = {
  pt: [
    "que",
    "não",
    "para",
    "com",
    "uma",
    "um",
    "os",
    "as",
    "do",
    "da",
    "dos",
    "das",
    "em",
    "é",
    "você",
    "isso",
    "esse",
    "essa",
    "como",
    "mais",
    "seu",
    "sua",
    "ao",
    "pelo",
    "pela",
    "também",
    "sem",
    "fala",
    "ta",
    "tá",
    "o",
    "e",
    "na",
    "nas",
    "nos",
    "ou",
    "pra",
    "à",
    "às",
  ],
  en: [
    "the",
    "and",
    "is",
    "are",
    "to",
    "of",
    "in",
    "that",
    "this",
    "with",
    "for",
    "you",
    "your",
    "it",
    "be",
    "on",
    "what",
    "how",
    "without",
    "please",
  ],
  es: [
    "que",
    "el",
    "la",
    "los",
    "las",
    "es",
    "para",
    "con",
    "una",
    "un",
    "del",
    "por",
    "como",
    "pero",
    "usted",
    "esto",
    "este",
    "sin",
    "también",
    "más",
  ],
};

export function guessLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (words.length < 4) return null;
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / words.length;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > second) {
      second = score;
    }
  }
  // Require a clear signal and a margin over the runner-up (pt/es share words).
  if (bestScore < 0.08 || bestScore - second < 0.03) return null;
  return best;
}
