// Lightweight character-class language detector used by the
// language-drift eval. Lives in its own side-effect-free module so
// the unit tests can import it without also loading the live model
// suite in `language.eval.ts` — that file declares `describe(...)`
// blocks gated on ANTHROPIC_API_KEY, and we don't want a developer
// who happens to have the key in their environment to accidentally
// hit the network during a normal `pnpm test` run.
//
// Heuristic:
//   - Count Spanish-only diacritics (ñ, ¿, ¡, accented vowels, ü).
//     Each diacritic counts as 2 because they almost never appear in
//     English text.
//   - Count Spanish stop-words (el, la, de, que, ...) and English
//     stop-words (the, and, of, ...) separately. Each match is 1.
//   - Whichever bucket has more total weight wins. Ties → "unknown",
//     which fails any expect() that demands a specific language.
//
// Zero deps so the eval doesn't pull in `franc` (~50 KB of trigram
// tables) just to distinguish English from Spanish on 50-500 token
// outputs.

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "de", "del", "al", "que", "en", "y",
  "es", "un", "una", "unos", "unas", "para", "con", "por", "su",
  "como", "se", "lo", "le", "te", "tu", "mi", "más", "pero", "si",
  "no", "sí", "ya", "ha", "han", "hay", "ser", "estar", "tiene",
  "tienes", "puedes", "puede", "podemos", "desde", "sobre", "hola",
  "gracias", "ayuda", "cómo", "qué", "dónde", "cuándo", "porque",
  "este", "esta", "estos", "estas", "ese", "esa", "eso", "también",
  "muy", "donde", "cuando", "todos", "todas", "todo", "toda",
]);

const ENGLISH_STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "is", "you", "that", "it", "for",
  "on", "are", "with", "as", "be", "from", "or", "at", "by", "this",
  "an", "have", "not", "but", "they", "we", "your", "can", "how",
  "what", "where", "when", "help", "hi", "hello", "please", "i",
  "will", "would", "should", "could", "do", "does", "did", "has",
  "had", "if", "then", "than", "so", "use", "used", "using", "click",
  "open", "page", "screen", "menu", "tap", "see",
]);

export function detectLanguage(text: string): "en" | "es" | "unknown" {
  const lower = text.toLowerCase();
  // Spanish-only diacritics. Plain `é` etc. occasionally show up in
  // English (loanwords like "café") but their density in real
  // Spanish output is ~10-50× higher, and we weight each x2.
  const spanishChars = (lower.match(/[ñáéíóúü¿¡]/g) ?? []).length;
  // Tokenize by any non-letter (Unicode-aware so we keep accented
  // characters intact for the stop-word match).
  const tokens = lower.split(/[^\p{L}]+/u).filter(Boolean);
  let es = spanishChars * 2;
  let en = 0;
  for (const t of tokens) {
    if (SPANISH_STOPWORDS.has(t)) es++;
    if (ENGLISH_STOPWORDS.has(t)) en++;
  }
  if (es === 0 && en === 0) return "unknown";
  if (es === en) return "unknown";
  return es > en ? "es" : "en";
}
