import type { Article, CefrLevel, FavoriteWord, VocabularyIndexEntry } from "./types";

export type DefiniteArticle = Exclude<Article, null>;
export type ArticleQuizMode = "favorites" | "database";

export interface ArticleQuizQuestion {
  word: string;
  article: DefiniteArticle;
  meaning: string;
  reason: string;
  level: CefrLevel | null;
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
}: {
  mode: ArticleQuizMode;
  level: CefrLevel;
  favorites: FavoriteWord[];
  vocabulary: VocabularyIndexEntry[];
  limit?: number;
  random?: () => number;
}) {
  const questions: ArticleQuizQuestion[] = mode === "favorites"
    ? favorites.flatMap((item): ArticleQuizQuestion[] => item.article ? [{
        word: item.word,
        article: item.article,
        meaning: item.meaning,
        reason: articleReasonText(item.articleReason, item.article) ?? "-",
        level: item.level ?? null,
      }] : [])
    : vocabulary.flatMap((item): ArticleQuizQuestion[] => item.article && item.level === level ? [{
        word: item.word,
        article: item.article,
        meaning: item.meaning,
        reason: articleReasonText(item.articleReason, item.article) ?? "-",
        level: item.level,
      }] : []);

  const unique = new Map<string, ArticleQuizQuestion>();
  for (const question of questions) {
    const key = question.word.trim().toLocaleLowerCase("de-DE");
    if (!unique.has(key)) unique.set(key, question);
  }
  return shuffleItems(Array.from(unique.values()), random).slice(0, limit);
}

export function isCorrectArticleAnswer(question: ArticleQuizQuestion, answer: DefiniteArticle) {
  return question.article === answer;
}
