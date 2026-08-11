import { describe, expect, it } from "vitest";
import type { FavoriteWord, ParseResult, VocabularyIndexEntry } from "./types";
import { filterAndSortFavorites, inferDifficultyLevel, isAffixWord, matchVocabulary, vocabularyForRandom } from "./vocabulary";

const vocabulary: VocabularyIndexEntry[] = [
  { word: "Freundlichkeit", article: "die", partOfSpeech: "Noun", level: "B1", meaning: "kindness", articleReason: null },
  { word: "freundlich", article: null, partOfSpeech: "Adjective", level: "A2", meaning: "friendly", articleReason: null },
  { word: "unfreundlich", article: null, partOfSpeech: "Adjective", level: "B1", meaning: "unfriendly", articleReason: null },
  { word: "-keit", article: null, partOfSpeech: "Suffix", level: null, meaning: "suffix", articleReason: null },
];

function parsedWord(word: string, partOfSpeech: string, morphemeCount = 1): ParseResult {
  return {
    word,
    article: null,
    partOfSpeech,
    meanings: [word],
    examples: [{ sentence: word, translation: null, source: "generated" }],
    etymology: null,
    morphemes: Array.from({ length: morphemeCount }, (_, index) => ({
      text: `${word}${index}`,
      lookup: `${word}${index}`,
      targetUrl: "https://example.com",
      kind: "root",
      meaning: word,
    })),
    sourceUrl: "https://example.com",
    compoundHint: null,
    articleReason: null,
  };
}

function favorite(word: string, favoriteTypes: FavoriteWord["favoriteTypes"], addedAt: number): FavoriteWord {
  return { word, article: "die", meaning: word, favoriteTypes, addedAt };
}

describe("matchVocabulary", () => {
  it("matches case-insensitive substrings and prioritizes prefixes", () => {
    expect(matchVocabulary(vocabulary, "FREUND").map((entry) => entry.word)).toEqual([
      "freundlich",
      "Freundlichkeit",
      "unfreundlich",
    ]);
  });
});

describe("filterAndSortFavorites", () => {
  const favorites = [
    favorite("Zeitung", ["meaning"], 1),
    favorite("Apfel", ["article"], 3),
    favorite("Haus", ["meaning", "article"], 2),
  ];

  it("filters favorite types and sorts newest first", () => {
    expect(filterAndSortFavorites(favorites, "article", "recent").map((item) => item.word)).toEqual([
      "Apfel",
      "Haus",
    ]);
  });

  it("sorts German words alphabetically", () => {
    expect(filterAndSortFavorites(favorites, "all", "alphabetical").map((item) => item.word)).toEqual([
      "Apfel",
      "Haus",
      "Zeitung",
    ]);
  });
});

describe("vocabulary difficulty and random selection", () => {
  it("always treats prefixes and suffixes as unclassified", () => {
    expect(isAffixWord("-keit", "Suffix")).toBe(true);
    expect(inferDifficultyLevel(parsedWord("-keit", "Suffix"))).toBeNull();
  });

  it("infers a conservative level for newly parsed words", () => {
    expect(inferDifficultyLevel(parsedWord("neu", "Adjective"))).toBe("A2");
    expect(inferDifficultyLevel(parsedWord("Zusammensetzung", "Noun", 3))).toBe("B2");
  });

  it("filters random candidates by range and excludes affixes", () => {
    expect(vocabularyForRandom(vocabulary, "A1-B2").map((entry) => entry.word)).not.toContain("-keit");
    expect(vocabularyForRandom(vocabulary, "A1-A2").map((entry) => entry.word)).toEqual(["freundlich"]);
    expect(vocabularyForRandom(vocabulary, "B1").map((entry) => entry.word)).toEqual([
      "Freundlichkeit",
      "unfreundlich",
    ]);
  });
});
