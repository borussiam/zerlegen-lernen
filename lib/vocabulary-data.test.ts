import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ParseResult, VocabularyIndexEntry } from "./types";
import { isAffixWord, vocabularyForRandom } from "./vocabulary";

interface Dataset {
  meta: { count: number; levels: Record<string, number> };
  words: ParseResult[];
}

const dataset = JSON.parse(readFileSync(
  path.join(process.cwd(), "public", "data", "pre-parsed-words.json"),
  "utf8",
)) as Dataset;

const vocabulary: VocabularyIndexEntry[] = dataset.words.map((word) => ({
  word: word.word,
  article: word.article,
  partOfSpeech: word.partOfSpeech,
  level: word.level ?? null,
  meaning: word.meanings[0] ?? "",
  articleReason: word.articleReason,
}));

describe("pre-parsed vocabulary integrity", () => {
  it("keeps metadata counts synchronized with stored words", () => {
    expect(dataset.meta.count).toBe(dataset.words.length);
    const actualCounts = dataset.words.reduce<Record<string, number>>((counts, word) => {
      const key = word.level ?? "unclassified";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    expect(dataset.meta.levels).toEqual(actualCounts);
  });

  it("provides definitions, examples, and decomposition data for every entry", () => {
    expect(dataset.words.every((word) => word.meanings.length > 0)).toBe(true);
    expect(dataset.words.every((word) => word.examples.length > 0)).toBe(true);
    expect(dataset.words.every((word) => word.morphemes.length > 0)).toBe(true);
  });

  it("keeps all prefixes and suffixes unclassified and outside random pools", () => {
    const affixes = dataset.words.filter((word) => isAffixWord(word.word, word.partOfSpeech));
    expect(affixes).toHaveLength(52);
    expect(affixes.every((word) => word.level == null)).toBe(true);
    const randomPool = vocabularyForRandom(vocabulary, "A1-B2");
    expect(randomPool.some((word) => isAffixWord(word.word, word.partOfSpeech))).toBe(false);
  });

  it("retains distinct homographs by spelling and part of speech", () => {
    const keys = dataset.words.map((word) => `${word.word.normalize("NFC")}:${word.partOfSpeech ?? "unknown"}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
