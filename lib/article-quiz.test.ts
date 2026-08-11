import { describe, expect, it } from "vitest";
import type { FavoriteWord, VocabularyIndexEntry } from "./types";
import { articleReasonText, buildArticleQuizQuestions, isCorrectArticleAnswer } from "./article-quiz";

const favorites: FavoriteWord[] = [
  { word: "Haus", article: "das", meaning: "house", level: "A1", favoriteTypes: ["article"] },
  { word: "Zeitung", article: "die", meaning: "newspaper", level: "A2", favoriteTypes: ["meaning"] },
  { word: "lernen", article: null, meaning: "to learn", level: "A1", favoriteTypes: ["meaning"] },
  { word: "haus", article: "das", meaning: "duplicate house", level: "A1", favoriteTypes: ["meaning"] },
];

const vocabulary: VocabularyIndexEntry[] = [
  { word: "Apfel", article: "der", partOfSpeech: "Noun", level: "A1", meaning: "apple", articleReason: null },
  { word: "Schule", article: "die", partOfSpeech: "Noun", level: "A1", meaning: "school", articleReason: "-e로 끝나는 일부 명사는 die를 사용합니다." },
  { word: "Problem", article: "das", partOfSpeech: "Noun", level: "A2", meaning: "problem", articleReason: null },
  { word: "klein", article: null, partOfSpeech: "Adjective", level: "A1", meaning: "small", articleReason: null },
];

describe("buildArticleQuizQuestions", () => {
  it("uses only unique nouns from favorites in favorite mode", () => {
    const questions = buildArticleQuizQuestions({
      mode: "favorites",
      level: "A1",
      favorites,
      vocabulary,
      random: () => 0.5,
    });
    expect(questions).toHaveLength(2);
    expect(new Set(questions.map((question) => question.word.toLowerCase()))).toEqual(new Set(["haus", "zeitung"]));
  });

  it("filters database questions by selected CEFR level and article", () => {
    const questions = buildArticleQuizQuestions({
      mode: "database",
      level: "A1",
      favorites,
      vocabulary,
      random: () => 0.5,
    });
    expect(questions.map((question) => question.word).sort()).toEqual(["Apfel", "Schule"]);
    expect(questions.every((question) => question.level === "A1" && question.article)).toBe(true);
  });

  it("enforces the requested question limit", () => {
    const questions = buildArticleQuizQuestions({
      mode: "database",
      level: "A1",
      favorites,
      vocabulary,
      limit: 1,
      random: () => 0,
    });
    expect(questions).toHaveLength(1);
  });
});

describe("article quiz feedback", () => {
  it("evaluates article answers", () => {
    const [question] = buildArticleQuizQuestions({ mode: "database", level: "A2", favorites, vocabulary });
    expect(isCorrectArticleAnswer(question, "das")).toBe(true);
    expect(isCorrectArticleAnswer(question, "der")).toBe(false);
  });

  it("reduces absent or generic article explanations to a dash-ready null", () => {
    expect(articleReasonText(null, "der")).toBeNull();
    expect(articleReasonText("관사 der와 단어를 함께 외우세요.", "der")).toBeNull();
    expect(articleReasonText("-ung 접미사는 die를 사용합니다.", "die")).toBe("-ung 접미사는 die를 사용합니다.");
  });
});
