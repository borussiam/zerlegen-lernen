import type { FavoriteType, FavoriteWord, ReviewStep, WordbookState } from "./types";
import { headwordKeyFor } from "./dictionary-entry";

export const DAY_MS = 24 * 60 * 60 * 1_000;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 30] as const;

export interface ReviewAssessment {
  meaningKnown: boolean;
  articleKnown?: boolean | null;
}

function uniqueFavoriteTypes(value: unknown): FavoriteType[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((type): type is FavoriteType => type === "meaning" || type === "article")));
}

export function createWordId(word: string, partOfSpeech: string | null | undefined) {
  const spelling = word.trim().normalize("NFC");
  if (spelling.startsWith("-") || spelling.endsWith("-") || /^(?:prefix|suffix|affix)$/i.test(partOfSpeech ?? "")) {
    return `${encodeURIComponent(spelling)}::${encodeURIComponent(partOfSpeech?.trim().toLocaleLowerCase("de-DE") || "unknown")}`;
  }
  return `headword::${encodeURIComponent(headwordKeyFor(spelling))}`;
}

export function isMastered(word: FavoriteWord) {
  return Boolean(word.mastery);
}

export function isReviewDue(word: FavoriteWord, now: number) {
  return Boolean(word.mastery && word.mastery.nextReviewAt <= now);
}

export function requiresArticleAssessment(word: FavoriteWord) {
  return Boolean(word.article);
}

export function reviewSucceeded(word: FavoriteWord, assessment: ReviewAssessment) {
  return assessment.meaningKnown
    && (!requiresArticleAssessment(word) || assessment.articleKnown === true);
}

export function markMastered(word: FavoriteWord, now: number): FavoriteWord {
  if (word.mastery) return word;
  const previousFavoriteTypes = getStoredFavoriteTypes(word);
  return {
    ...word,
    favoriteTypes: [],
    mastery: {
      masteredAt: now,
      reviewStep: 0,
      nextReviewAt: now + REVIEW_INTERVAL_DAYS[0] * DAY_MS,
      previousFavoriteTypes,
    },
  };
}

export function removeMastery(word: FavoriteWord): FavoriteWord {
  if (!word.mastery) return word;
  const restored = word.mastery.previousFavoriteTypes.length
    ? word.mastery.previousFavoriteTypes
    : ["meaning" as const];
  const activeWord = { ...word };
  delete activeWord.mastery;
  return { ...activeWord, favoriteTypes: restored };
}

export function activateUnknownType(word: FavoriteWord, type: FavoriteType): FavoriteWord {
  if (word.mastery) {
    const activeWord = { ...word };
    delete activeWord.mastery;
    return { ...activeWord, favoriteTypes: [type] };
  }
  const types = getStoredFavoriteTypes(word);
  return types.includes(type) ? word : { ...word, favoriteTypes: [...types, type] };
}

export function applyReview(
  word: FavoriteWord,
  assessment: ReviewAssessment,
  now: number,
): FavoriteWord {
  if (!word.mastery) return word;
  const succeeded = reviewSucceeded(word, assessment);
  const reviewStep: ReviewStep = succeeded
    ? Math.min(3, word.mastery.reviewStep + 1) as ReviewStep
    : 0;
  return {
    ...word,
    favoriteTypes: [],
    mastery: {
      ...word.mastery,
      reviewStep,
      nextReviewAt: now + REVIEW_INTERVAL_DAYS[reviewStep] * DAY_MS,
      lastReviewedAt: now,
      lastMeaningKnown: assessment.meaningKnown,
      lastArticleKnown: requiresArticleAssessment(word) ? assessment.articleKnown === true : null,
    },
  };
}

export function recordArticleAnswer(word: FavoriteWord, correct: boolean, now: number): FavoriteWord {
  if (word.mastery) return word;
  const types = getStoredFavoriteTypes(word);
  if (types.length !== 1 || types[0] !== "article") return word;
  return {
    ...word,
    practice: {
      articleCorrectStreak: correct ? (word.practice?.articleCorrectStreak ?? 0) + 1 : 0,
      lastArticleAnsweredAt: now,
    },
  };
}

export function shouldSuggestMastery(word: FavoriteWord) {
  const types = getStoredFavoriteTypes(word);
  return !word.mastery
    && types.length === 1
    && types[0] === "article"
    && (word.practice?.articleCorrectStreak ?? 0) >= 3;
}

export function dueMasteredWords(words: FavoriteWord[], now: number) {
  return words
    .filter((word) => isReviewDue(word, now))
    .sort((left, right) => left.mastery!.nextReviewAt - right.mastery!.nextReviewAt);
}

export function nextUpcomingReviewAt(words: FavoriteWord[], now: number) {
  const upcoming = words
    .flatMap((word) => word.mastery && word.mastery.nextReviewAt > now ? [word.mastery.nextReviewAt] : []);
  return upcoming.length ? Math.min(...upcoming) : null;
}

export function buildClozeWordPool(words: FavoriteWord[], now: number) {
  const active = words.filter((word) => !word.mastery && getStoredFavoriteTypes(word).length > 0);
  return [...active, ...dueMasteredWords(words, now)];
}

export function getStoredFavoriteTypes(word: Pick<FavoriteWord, "favoriteTypes" | "mastery">): FavoriteType[] {
  if (word.mastery) return [];
  const types = uniqueFavoriteTypes(word.favoriteTypes);
  return types.length ? types : ["meaning"];
}

function isFavoriteWordLike(value: unknown): value is Omit<FavoriteWord, "id"> & { id?: string } {
  if (!value || typeof value !== "object") return false;
  const word = value as Partial<FavoriteWord>;
  return typeof word.word === "string" && typeof word.meaning === "string";
}

function migrateWord(
  word: Omit<FavoriteWord, "id"> & { id?: string },
  fallbackAddedAt: number,
): FavoriteWord {
  const mastery = word.mastery && typeof word.mastery === "object"
    ? {
        ...word.mastery,
        reviewStep: ([0, 1, 2, 3].includes(word.mastery.reviewStep) ? word.mastery.reviewStep : 0) as ReviewStep,
        previousFavoriteTypes: uniqueFavoriteTypes(word.mastery.previousFavoriteTypes),
      }
    : undefined;
  return {
    ...word,
    id: createWordId(word.word, word.partOfSpeech),
    headwordKey: word.headwordKey ?? headwordKeyFor(word.word),
    favoriteTypes: mastery ? [] : getStoredFavoriteTypes({ favoriteTypes: word.favoriteTypes }),
    addedAt: word.addedAt ?? fallbackAddedAt,
    mastery,
  };
}

function mergeFavoriteWords(left: FavoriteWord, right: FavoriteWord): FavoriteWord {
  const favoriteTypes = Array.from(new Set([...getStoredFavoriteTypes(left), ...getStoredFavoriteTypes(right)]));
  const variants = [...(left.variants ?? []), ...(right.variants ?? [])];
  const decompositionOptions = [...(left.decompositionOptions ?? []), ...(right.decompositionOptions ?? [])];
  const nounSource = left.article ? left : right.article ? right : left;
  return {
    ...nounSource,
    id: left.id,
    word: nounSource.word,
    meaning: [left.meaning, right.meaning].filter(Boolean).join(" / "),
    favoriteTypes,
    addedAt: Math.min(left.addedAt ?? Number.POSITIVE_INFINITY, right.addedAt ?? Number.POSITIVE_INFINITY),
    mastery: left.mastery ?? right.mastery,
    practice: left.practice ?? right.practice,
    variants: variants.length ? variants : undefined,
    decompositionOptions: decompositionOptions.length ? decompositionOptions : undefined,
  };
}

export function migrateWordbookState(value: unknown, now: number): WordbookState {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && (value as { version?: unknown }).version === 2
      && Array.isArray((value as { words?: unknown }).words)
      ? (value as { words: unknown[] }).words
      : [];
  const valid = candidates.filter(isFavoriteWordLike);
  const words = valid.map((word, index) => migrateWord(word, now - ((valid.length - index) * 1_000)));
  const merged = new Map<string, FavoriteWord>();
  for (const word of words) {
    const existing = merged.get(word.id);
    merged.set(word.id, existing ? mergeFavoriteWords(existing, word) : word);
  }
  return {
    version: 2,
    words: Array.from(merged.values()),
  };
}
