import type { Article, CefrLevel, FavoriteWord, VocabularyIndexEntry } from "./types";
import { createWordId, getStoredFavoriteTypes, isReviewDue } from "./spaced-repetition";

export type DefiniteArticle = Exclude<Article, null>;
export type ArticleQuizMode = "favorites" | "database";

export interface ArticleQuizQuestion {
  id: string;
  favoriteId?: string;
  word: string;
  article: DefiniteArticle;
  meaning: string;
  reason: string;
  level: CefrLevel | null;
  reviewDue: boolean;
}

export function articleReasonText(reason: string | null | undefined, article: Article) {
  const cleaned = reason
    ?.replace(/\s*영어 Wiktionary의 이 항목(?:도|은) [^.]+표기합니다\./g, "")
    .replace(/영어 Wiktionary의 독일어 명사 성 표기에 따라 [^.]+사용합니다\.\s*/g, "")
    .replace(/Wiktionary의 성 표기에 따라 [^.]+사용합니다\.\s*/g, "")
    .trim();
  if (!cleaned || !article || /뚜렷한|확실한 .*규칙이 없|관사 (?:der|die|das)와 단어를 함께/.test(cleaned)) return null;
  return cleaned;
}

export function shuffleItems<T>(items: T[], random: () => number = Math.random) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

export function buildArticleQuizQuestions({
  mode,
  level,
  favorites,
  vocabulary,
  limit = 8,
  random = Math.random,
  now = Date.now(),
}: {
  mode: ArticleQuizMode;
  level: CefrLevel;
  favorites: FavoriteWord[];
  vocabulary: VocabularyIndexEntry[];
  limit?: number;
  random?: () => number;
  now?: number;
}) {
  const inSelectedLevel = (item: FavoriteWord) => mode === "favorites" || item.level === level;
  const fromFavorite = (item: FavoriteWord, reviewDue: boolean): ArticleQuizQuestion => ({
    id: item.id,
    favoriteId: item.id,
    word: item.word,
    article: item.article!,
    meaning: item.meaning,
    reason: articleReasonText(item.articleReason, item.article) ?? "-",
    level: item.level ?? null,
    reviewDue,
  });
  const due = favorites.filter((item) => (
    Boolean(item.article) && inSelectedLevel(item) && isReviewDue(item, now)
  )).map((item) => fromFavorite(item, true));
  const active = favorites.filter((item) => (
    Boolean(item.article)
    && inSelectedLevel(item)
    && !item.mastery
    && getStoredFavoriteTypes(item).includes("article")
  )).map((item) => fromFavorite(item, false));

  const savedIds = new Set(favorites.map((item) => item.id));
  const database = mode === "database" ? vocabulary.flatMap((item): ArticleQuizQuestion[] => {
    if (!item.article || item.level !== level) return [];
    const id = createWordId(item.word, item.partOfSpeech);
    if (savedIds.has(id)) return [];
    return [{
      id,
      word: item.word,
      article: item.article,
      meaning: item.meaning,
      reason: articleReasonText(item.articleReason, item.article) ?? "-",
      level: item.level,
      reviewDue: false,
    }];
  }) : [];

  const questions = [
    ...shuffleItems(due, random),
    ...shuffleItems(active, random),
    ...shuffleItems(database, random),
  ];

  const unique = new Map<string, ArticleQuizQuestion>();
  for (const question of questions) {
    if (!unique.has(question.id)) unique.set(question.id, question);
  }
  return Array.from(unique.values()).slice(0, limit);
}

export function isCorrectArticleAnswer(question: ArticleQuizQuestion, answer: DefiniteArticle) {
  return question.article === answer;
}
