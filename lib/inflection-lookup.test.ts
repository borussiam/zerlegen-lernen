import { describe, expect, it } from "vitest";
import { candidateFromParseResult, dedupeInflectionCandidates, isValidLookupCandidate, orderedSurfaceLookupTokens, rankInflectionCandidates } from "./inflection-lookup";
import type { InflectionCandidate } from "./types";
import type { ParseResult } from "./types";

function candidate(overrides: Partial<InflectionCandidate>): InflectionCandidate {
  return {
    surfaceForm: "am",
    lemmaId: "word:none:placeholder",
    lemma: "placeholder",
    article: null,
    partOfSpeech: "Particle",
    meaning: "placeholder",
    morphology: { partOfSpeech: "particle" },
    exactCase: true,
    source: "wiktionary-inflection",
    ...overrides,
  };
}

describe("inflection lookup helpers", () => {
  it("orders exact and case fallback tokens without static dictionary lookups", () => {
    expect(orderedSurfaceLookupTokens("Lehrer").map((item) => item.value)).toEqual(["Lehrer", "lehrer"]);
    expect(orderedSurfaceLookupTokens("lehrer").map((item) => item.value)).toEqual(["lehrer", "Lehrer"]);
  });

  it("deduplicates repeated DB surface candidates by lemma and source", () => {
    const repeated: InflectionCandidate = {
      surfaceForm: "lernt",
      lemmaId: "verb:none:lernen",
      lemma: "lernen",
      article: null,
      partOfSpeech: "Verb",
      meaning: "to learn",
      morphology: { partOfSpeech: "verb", tense: "present" },
      exactCase: true,
      source: "wiktionary-inflection",
    };
    expect(dedupeInflectionCandidates([repeated, { ...repeated }])).toEqual([repeated]);
  });

  it("ranks preposition contractions over particle homographs while preserving both", () => {
    const contraction = candidate({
      lemmaId: "preposition:none:an",
      lemma: "an",
      partOfSpeech: "Preposition",
      morphology: {
        partOfSpeech: "preposition",
        contraction: true,
        preposition: "an",
        article: "dem",
        case: "Dativ",
      },
    });
    const particle = candidate({
      lemmaId: "particle:none:am",
      lemma: "am",
      partOfSpeech: "Particle",
      morphology: { partOfSpeech: "particle" },
    });

    expect(rankInflectionCandidates([particle, contraction], { surfaceForm: "am" }))
      .toEqual([contraction, particle]);
  });

  it("ranks sentence-initial lowercase pronouns over exact nominalized nouns", () => {
    const nominalization = candidate({
      surfaceForm: "Ich",
      lemmaId: "noun:das:ich",
      lemma: "Ich",
      article: "das",
      partOfSpeech: "Noun",
      morphology: { partOfSpeech: "noun" },
      exactCase: true,
    });
    const pronoun = candidate({
      surfaceForm: "ich",
      lemmaId: "pronoun:none:ich",
      lemma: "ich",
      partOfSpeech: "Pronoun",
      morphology: { partOfSpeech: "pronoun" },
      exactCase: false,
    });

    expect(rankInflectionCandidates([nominalization, pronoun], { surfaceForm: "Ich", sentenceInitial: true }))
      .toEqual([pronoun, nominalization]);
  });

  it("ranks lowercased articles over exact nominal candidates", () => {
    const nominal = candidate({
      surfaceForm: "Der",
      lemmaId: "noun:der:kranker",
      lemma: "Kranker",
      article: "der",
      partOfSpeech: "Noun",
      morphology: { partOfSpeech: "noun" },
      exactCase: true,
    });
    const article = candidate({
      surfaceForm: "der",
      lemmaId: "article:none:der",
      lemma: "der",
      partOfSpeech: "Article",
      morphology: { partOfSpeech: "article" },
      exactCase: false,
    });

    expect(rankInflectionCandidates([nominal, article], { surfaceForm: "Der", sentenceInitial: true }))
      .toEqual([article, nominal]);
  });

  it("rejects standard article surfaces mapped to nominal lemmas", () => {
    expect(isValidLookupCandidate(candidate({
      surfaceForm: "der",
      lemma: "Kranker",
      article: "der",
      partOfSpeech: "Noun",
      morphology: { partOfSpeech: "noun" },
      meaning: "sick person",
    }))).toBe(false);
  });

  it("keeps standard capitalized nouns ahead of lowercase open-class fallbacks", () => {
    const noun = candidate({
      surfaceForm: "Lernen",
      lemmaId: "noun:das:lernen",
      lemma: "Lernen",
      article: "das",
      partOfSpeech: "Noun",
      morphology: { partOfSpeech: "noun" },
      exactCase: true,
    });
    const verb = candidate({
      surfaceForm: "lernen",
      lemmaId: "verb:none:lernen",
      lemma: "lernen",
      partOfSpeech: "Verb",
      morphology: { partOfSpeech: "verb" },
      exactCase: false,
    });

    expect(rankInflectionCandidates([verb, noun], { surfaceForm: "Lernen", sentenceInitial: true }))
      .toEqual([noun, verb]);
  });

  it("classifies pronouns before the noun substring fallback", () => {
    const result: ParseResult = {
      word: "ich",
      article: null,
      partOfSpeech: "Pronoun",
      meanings: ["I"],
      examples: [],
      etymology: null,
      morphemes: [],
      sourceUrl: "",
      compoundHint: null,
      articleReason: null,
    };

    expect(candidateFromParseResult("ich", result).morphology.partOfSpeech).toBe("pronoun");
  });

  it("classifies article lemmas as article morphology", () => {
    const result: ParseResult = {
      word: "der",
      article: null,
      partOfSpeech: "Article",
      meanings: ["the"],
      examples: [],
      etymology: null,
      morphemes: [],
      sourceUrl: "",
      compoundHint: null,
      articleReason: null,
    };

    expect(candidateFromParseResult("der", result).morphology.partOfSpeech).toBe("article");
  });

  it("rejects unresolved ghost candidates and single-token mappings to phrase lemmas", () => {
    expect(isValidLookupCandidate(candidate({
      lemma: "bestes Wissen und Gewissen",
      meaning: "사전에서 정의를 자동 추출하지 못했습니다.",
      dictionaryEntry: {
        word: "bestes Wissen und Gewissen",
        article: null,
        partOfSpeech: "Preposition",
        meanings: ["사전에서 정의를 자동 추출하지 못했습니다."],
        examples: [],
        etymology: null,
        morphemes: [],
        sourceUrl: "",
        compoundHint: null,
        articleReason: null,
      },
    }))).toBe(false);

    expect(isValidLookupCandidate(candidate({
      surfaceForm: "nach",
      lemma: "nach bestem Wissen und Gewissen",
      meaning: "to the best of one's knowledge and belief",
      dictionaryEntry: {
        word: "nach bestem Wissen und Gewissen",
        article: null,
        partOfSpeech: "Preposition",
        meanings: ["to the best of one's knowledge and belief"],
        examples: [],
        etymology: null,
        morphemes: [],
        sourceUrl: "",
        compoundHint: null,
        articleReason: null,
      },
    }))).toBe(false);
  });
});
