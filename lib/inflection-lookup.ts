import { capitalizeGermanToken, startsWithUppercaseGermanLetter, stripGermanToken } from "./german-tokenizer";
import type { InflectionCandidate, MorphologicalMetadata, ParseResult, SentenceLookupResult } from "./types";

const STANDARD_GERMAN_ARTICLE_FORMS = new Set([
  "der", "die", "das", "des", "dem", "den",
  "ein", "eine", "eines", "einem", "einen", "einer",
]);

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

function normalized(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("de-DE");
}

function candidatePosText(candidate: InflectionCandidate) {
  return `${candidate.partOfSpeech ?? ""} ${candidate.morphology.partOfSpeech ?? ""}`.toLocaleLowerCase("en-US");
}

function isContraction(candidate: InflectionCandidate) {
  return candidate.morphology.contraction === true || typeof candidate.morphology.contraction === "object";
}

export function isContractionCandidate(candidate: InflectionCandidate) {
  return isContraction(candidate);
}

function isSingleToken(value: string) {
  return !/\s/u.test(value.trim());
}

function isMultiWord(value: string) {
  return /\s/u.test(value.trim());
}

function validDefinitionText(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== "사전에서 정의를 자동 추출하지 못했습니다.";
}

export function hasUsableCandidateDefinition(candidate: InflectionCandidate) {
  const meanings = candidate.dictionaryEntry?.meanings ?? (candidate.meaning ? [candidate.meaning] : []);
  return meanings.some(validDefinitionText);
}

export function isSingleTokenSurfaceMappedToPhraseLemma(candidate: InflectionCandidate) {
  return isSingleToken(candidate.surfaceForm) && isMultiWord(candidate.lemma);
}

function isArticleSurface(candidate: InflectionCandidate) {
  return STANDARD_GERMAN_ARTICLE_FORMS.has(normalized(candidate.surfaceForm));
}

function isNominalCandidate(candidate: InflectionCandidate) {
  const pos = candidatePosText(candidate);
  return /\b(?:noun|adjective)\b/.test(pos);
}

export function isArticleSurfaceMappedToNominalLemma(candidate: InflectionCandidate) {
  return isArticleSurface(candidate) && isNominalCandidate(candidate);
}

export function isValidLookupCandidate(candidate: InflectionCandidate) {
  return hasUsableCandidateDefinition(candidate)
    && !isSingleTokenSurfaceMappedToPhraseLemma(candidate)
    && !isArticleSurfaceMappedToNominalLemma(candidate);
}

function isNoun(candidate: InflectionCandidate) {
  const pos = candidatePosText(candidate);
  return candidate.article !== null || /\bnoun\b/.test(pos);
}

function isAffix(candidate: InflectionCandidate) {
  const pos = candidatePosText(candidate);
  return /\b(?:prefix|suffix|affix|infix|interfix|circumfix)\b/.test(pos)
    || candidate.lemma.startsWith("-")
    || candidate.lemma.endsWith("-");
}

function rawPosTier(candidate: InflectionCandidate) {
  const pos = candidatePosText(candidate);
  if (
    isContraction(candidate)
    || /\bpreposition\b/.test(pos)
    || /\b(?:article|determiner)\b/.test(pos)
    || /\bpronoun\b/.test(pos)
    || /\bconjunction\b/.test(pos)
  ) {
    return 1;
  }
  if (/\b(?:verb|participle|noun|adjective|adverb)\b/.test(pos)) return 2;
  if (/\b(?:particle|interjection)\b/.test(pos) || isAffix(candidate)) return 3;
  return 3;
}

function hasCoreFunctionalHomograph(candidate: InflectionCandidate, candidates: InflectionCandidate[]) {
  const candidateSurface = normalized(candidate.surfaceForm);
  const candidateLemma = normalized(candidate.lemma);
  return candidates.some((other) => (
    other !== candidate
    && rawPosTier(other) === 1
    && (
      normalized(other.surfaceForm) === candidateSurface
      || normalized(other.lemma) === candidateLemma
      || normalized(other.surfaceForm) === candidateLemma
    )
  ));
}

export function posTierForCandidate(candidate: InflectionCandidate, candidates: InflectionCandidate[] = [candidate]) {
  if (isNoun(candidate) && hasCoreFunctionalHomograph(candidate, candidates)) return 3;
  return rawPosTier(candidate);
}

export function rankInflectionCandidates(
  candidates: InflectionCandidate[],
  options: { sentenceInitial?: boolean; surfaceForm?: string } = {},
) {
  const originalSurface = options.surfaceForm ? stripGermanToken(options.surfaceForm).normalize("NFC") : null;
  return [...candidates].sort((left, right) => {
    const tierDifference = posTierForCandidate(left, candidates) - posTierForCandidate(right, candidates);
    if (tierDifference) return tierDifference;

    const exactDifference = Number(!left.exactCase) - Number(!right.exactCase);
    if (exactDifference) return exactDifference;

    if (originalSurface) {
      const leftLemmaExact = Number(normalized(left.lemma) !== normalized(originalSurface));
      const rightLemmaExact = Number(normalized(right.lemma) !== normalized(originalSurface));
      if (leftLemmaExact !== rightLemmaExact) return leftLemmaExact - rightLemmaExact;
    }

    return 0;
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
  if (normalized.includes("pronoun")) return "pronoun";
  if (normalized.includes("article")) return "article";
  if (normalized.includes("determiner")) return "determiner";
  if (normalized.includes("verb")) return "verb";
  if (normalized.includes("adjective")) return "adjective";
  if (normalized.includes("adverb")) return "adverb";
  if (normalized.includes("noun")) return "noun";
  if (normalized.includes("preposition")) return "preposition";
  if (normalized.includes("conjunction")) return "conjunction";
  if (normalized.includes("particle")) return "particle";
  return "other";
}
