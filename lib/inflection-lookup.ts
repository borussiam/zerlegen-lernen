import { capitalizeGermanToken, startsWithUppercaseGermanLetter, stripGermanToken } from "./german-tokenizer";
import type { InflectionCandidate, MorphologicalMetadata, ParseResult, SentenceLookupResult } from "./types";

function candidateKey(candidate: Pick<InflectionCandidate, "lemmaId" | "surfaceForm" | "source">) {
  return `${candidate.source}:${candidate.lemmaId}:${candidate.surfaceForm}`;
}

export function dedupeInflectionCandidates(candidates: InflectionCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function orderedSurfaceLookupTokens(token: string) {
  const cleanToken = stripGermanToken(token);
  const lowered = cleanToken.toLocaleLowerCase("de-DE");
  const capitalized = capitalizeGermanToken(lowered);
  const tokens: Array<{ value: string; exactCase: boolean; lowercaseFallback: boolean; capitalizedFallback: boolean }> = [
    { value: cleanToken, exactCase: true, lowercaseFallback: false, capitalizedFallback: false },
  ];
  if (startsWithUppercaseGermanLetter(cleanToken) && lowered !== cleanToken) {
    tokens.push({ value: lowered, exactCase: false, lowercaseFallback: true, capitalizedFallback: false });
  }
  if (capitalized !== cleanToken && capitalized !== lowered) {
    tokens.push({ value: capitalized, exactCase: false, lowercaseFallback: false, capitalizedFallback: true });
  }
  if (!startsWithUppercaseGermanLetter(cleanToken) && lowered !== cleanToken) {
    tokens.push({ value: lowered, exactCase: false, lowercaseFallback: true, capitalizedFallback: false });
  }
  return tokens.filter((item, index, items) => items.findIndex((candidate) => candidate.value === item.value) === index);
}

export function emptySurfaceLookup(surfaceForm: string): SentenceLookupResult {
  return {
    surfaceForm,
    token: stripGermanToken(surfaceForm).normalize("NFC"),
    candidates: [],
    relatedCandidates: [],
  };
}

export function candidateFromParseResult(
  surfaceForm: string,
  result: ParseResult,
  source: InflectionCandidate["source"] = "dictionary",
): InflectionCandidate {
  return {
    surfaceForm,
    lemmaId: `${result.partOfSpeech ?? "word"}:${result.article ?? "none"}:${result.word}`.toLocaleLowerCase("de-DE"),
    lemma: result.word,
    article: result.article,
    partOfSpeech: result.partOfSpeech,
    meaning: result.meanings[0] ?? "",
    dictionaryEntry: result,
    morphology: { partOfSpeech: morphologyPartOfSpeech(result.partOfSpeech) },
    exactCase: result.word === surfaceForm,
    source,
  };
}

function morphologyPartOfSpeech(partOfSpeech: string | null): MorphologicalMetadata["partOfSpeech"] {
  const normalized = partOfSpeech?.toLocaleLowerCase("en-US") ?? "";
  if (normalized.includes("noun")) return "noun";
  if (normalized.includes("verb")) return "verb";
  if (normalized.includes("adjective")) return "adjective";
  if (normalized.includes("adverb")) return "adverb";
  if (normalized.includes("pronoun")) return "pronoun";
  if (normalized.includes("preposition")) return "preposition";
  if (normalized.includes("conjunction")) return "conjunction";
  if (normalized.includes("particle")) return "particle";
  return "other";
}
