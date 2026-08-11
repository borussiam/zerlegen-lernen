import type { FavoriteType, FavoriteWord, VocabularyIndexEntry } from "./types";

export type FavoriteFilter = "all" | FavoriteType;
export type FavoriteSort = "recent" | "alphabetical";

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("de-DE");
}

export function getFavoriteTypes(item: FavoriteWord): FavoriteType[] {
  return item.favoriteTypes?.length ? item.favoriteTypes : ["meaning"];
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
) {
  return favorites
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => filter === "all" || getFavoriteTypes(item).includes(filter))
    .sort((left, right) => {
      if (sort === "alphabetical") {
        return left.item.word.localeCompare(right.item.word, "de", { sensitivity: "base" });
      }
      const leftAddedAt = left.item.addedAt ?? left.index;
      const rightAddedAt = right.item.addedAt ?? right.index;
      return rightAddedAt - leftAddedAt;
    })
    .map(({ item }) => item);
}
