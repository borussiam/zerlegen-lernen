import type { CefrLevel, FavoriteType, FavoriteWord, ParseResult, VocabularyIndexEntry } from "./types";
import { createWordId, getStoredFavoriteTypes } from "./spaced-repetition";

export type FavoriteFilter = "all" | FavoriteType;
export type FavoriteSort = "recent" | "alphabetical" | "review";
export type MasteryScope = "active" | "include" | "mastered";
export type RandomLevelRange = "A1-B2" | "A1-A2" | "B1-B2" | CefrLevel;

const LEVEL_ORDER: Record<CefrLevel, number> = {
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
};

const RANGE_BOUNDS: Record<RandomLevelRange, readonly [CefrLevel, CefrLevel]> = {
  "A1-B2": ["A1", "B2"],
  "A1-A2": ["A1", "A2"],
  "B1-B2": ["B1", "B2"],
  A1: ["A1", "A1"],
  A2: ["A2", "A2"],
  B1: ["B1", "B1"],
  B2: ["B2", "B2"],
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("de-DE");
}

export function isAffixWord(word: string, partOfSpeech: string | null | undefined) {
  return word.startsWith("-")
    || word.endsWith("-")
    || /^(?:prefix|suffix|affix)$/i.test(partOfSpeech ?? "");
}

export function inferDifficultyLevel(
  result: ParseResult,
  knownComponentLevels: CefrLevel[] = [],
): CefrLevel | null {
  if (isAffixWord(result.word, result.partOfSpeech)) return null;

  const letterCount = Array.from(result.word).filter((character) => /\p{L}/u.test(character)).length;
  let inferred: CefrLevel = letterCount <= 6 ? "A2" : letterCount <= 10 ? "B1" : "B2";

  if (result.morphemes.length >= 2 && LEVEL_ORDER[inferred] < LEVEL_ORDER.B1) inferred = "B1";
  if (result.morphemes.length >= 3) inferred = "B2";

  for (const level of knownComponentLevels) {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[inferred]) inferred = level;
  }
  return inferred;
}

export function vocabularyForRandom(
  vocabulary: VocabularyIndexEntry[],
  range: RandomLevelRange,
  favorites: FavoriteWord[] = [],
) {
  const [minimum, maximum] = RANGE_BOUNDS[range];
  const minimumRank = LEVEL_ORDER[minimum];
  const maximumRank = LEVEL_ORDER[maximum];
  const masteredIds = new Set(favorites.filter((word) => word.mastery).map((word) => word.id));
  return vocabulary.filter((entry) => (
    entry.level !== null
    && !isAffixWord(entry.word, entry.partOfSpeech)
    && !masteredIds.has(createWordId(entry.word, entry.partOfSpeech))
    && LEVEL_ORDER[entry.level] >= minimumRank
    && LEVEL_ORDER[entry.level] <= maximumRank
  ));
}

export function getFavoriteTypes(item: FavoriteWord): FavoriteType[] {
  return getStoredFavoriteTypes(item);
}

export function matchVocabulary(
  vocabulary: VocabularyIndexEntry[],
  query: string,
  limit = 8,
) {
  const needle = normalized(query);
  if (!needle) return [];

  return vocabulary
    .filter((entry) => normalized(entry.word).includes(needle))
    .sort((left, right) => {
      const leftWord = normalized(left.word);
      const rightWord = normalized(right.word);
      const prefixDifference = Number(!leftWord.startsWith(needle)) - Number(!rightWord.startsWith(needle));
      return prefixDifference || left.word.localeCompare(right.word, "de", { sensitivity: "base" });
    })
    .slice(0, limit);
}

export function filterAndSortFavorites(
  favorites: FavoriteWord[],
  filter: FavoriteFilter,
  sort: FavoriteSort,
  masteryScope: MasteryScope = "active",
) {
  return favorites
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (masteryScope === "active" && item.mastery) return false;
      if (masteryScope === "mastered" && !item.mastery) return false;
      return filter === "all" || getFavoriteTypes(item).includes(filter);
    })
    .sort((left, right) => {
      if (sort === "review") {
        const leftReview = left.item.mastery?.nextReviewAt ?? Number.POSITIVE_INFINITY;
        const rightReview = right.item.mastery?.nextReviewAt ?? Number.POSITIVE_INFINITY;
        return leftReview - rightReview;
      }
      if (sort === "alphabetical") {
        return left.item.word.localeCompare(right.item.word, "de", { sensitivity: "base" });
      }
      const leftAddedAt = left.item.addedAt ?? left.index;
      const rightAddedAt = right.item.addedAt ?? right.index;
      return rightAddedAt - leftAddedAt;
    })
    .map(({ item }) => item);
}
