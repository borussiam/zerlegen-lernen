import { describe, expect, it } from "vitest";
import type { FavoriteWord, VocabularyIndexEntry } from "./types";
import { filterAndSortFavorites, matchVocabulary } from "./vocabulary";

const vocabulary: VocabularyIndexEntry[] = [
  { word: "Freundlichkeit", article: "die", partOfSpeech: "Noun", level: "B1", meaning: "kindness", articleReason: null },
  { word: "freundlich", article: null, partOfSpeech: "Adjective", level: "A2", meaning: "friendly", articleReason: null },
  { word: "unfreundlich", article: null, partOfSpeech: "Adjective", level: "B1", meaning: "unfriendly", articleReason: null },
];

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
