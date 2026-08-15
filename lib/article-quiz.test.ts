import { describe, expect, it } from "vitest";
import type { FavoriteWord, VocabularyIndexEntry } from "./types";
import { articleReasonText, buildArticleQuizQuestions, isCorrectArticleAnswer } from "./article-quiz";
import { DAY_MS, createWordId, markMastered } from "./spaced-repetition";

const NOW = 1_000_000;

const favorites: FavoriteWord[] = [
  { id: createWordId("Haus", "Noun"), word: "Haus", article: "das", meaning: "house", partOfSpeech: "Noun", level: "A1", favoriteTypes: ["article"] },
  { id: createWordId("Zeitung", "Noun"), word: "Zeitung", article: "die", meaning: "newspaper", partOfSpeech: "Noun", level: "A2", favoriteTypes: ["meaning"] },
  { id: createWordId("lernen", "Verb"), word: "lernen", article: null, meaning: "to learn", partOfSpeech: "Verb", level: "A1", favoriteTypes: ["meaning"] },
  { id: createWordId("haus", "Noun"), word: "haus", article: "das", meaning: "duplicate house", partOfSpeech: "Noun", level: "A1", favoriteTypes: ["meaning"] },
];

const vocabulary: VocabularyIndexEntry[] = [
  { word: "Apfel", article: "der", partOfSpeech: "Noun", level: "A1", meaning: "apple", articleReason: null },
  { word: "Schule", article: "die", partOfSpeech: "Noun", level: "A1", meaning: "school", articleReason: "-e로 끝나는 일부 명사는 die를 사용합니다." },
  { word: "Problem", article: "das", partOfSpeech: "Noun", level: "A2", meaning: "problem", articleReason: null },
  { word: "klein", article: null, partOfSpeech: "Adjective", level: "A1", meaning: "small", articleReason: null },
];

describe("buildArticleQuizQuestions", () => {
  it("uses active article-unknown words from favorites", () => {
    const questions = buildArticleQuizQuestions({
      mode: "favorites",
      level: "A1",
      favorites,
      vocabulary,
      random: () => 0.5,
    });
    expect(questions.map((question) => question.word)).toEqual(["Haus"]);
  });

  it("prioritizes due mastery, then active article-unknown words, and omits future mastery", () => {
    const due = markMastered({ ...favorites[1], level: "A1" }, NOW - DAY_MS);
    const future = markMastered({
      ...favorites[0],
      id: createWordId("Buch", "Noun"),
      word: "Buch",
    }, NOW);
    const questions = buildArticleQuizQuestions({
      mode: "favorites",
      level: "A1",
      favorites: [favorites[0], due, future],
      vocabulary,
      now: NOW,
      random: () => 0.5,
    });
    expect(questions.map((question) => question.word)).toEqual(["Zeitung", "Haus"]);
    expect(questions[0].reviewDue).toBe(true);
  });

  it("does not leak a non-due mastered word back through the database pool", () => {
    const futureSchool = markMastered({
      id: createWordId("Schule", "Noun"),
      word: "Schule",
      article: "die",
      meaning: "school",
      partOfSpeech: "Noun",
      level: "A1",
      favoriteTypes: ["article"],
    }, NOW);
    const questions = buildArticleQuizQuestions({
      mode: "database",
      level: "A1",
      favorites: [futureSchool],
      vocabulary,
      now: NOW,
      random: () => 0.5,
    });
    expect(questions.map((question) => question.word)).not.toContain("Schule");
  });

  it("filters database questions by selected CEFR level and article", () => {
    const questions = buildArticleQuizQuestions({
      mode: "database",
      level: "A1",
      favorites,
      vocabulary,
      random: () => 0.5,
    });
    expect(questions.map((question) => question.word).sort()).toEqual(["Apfel", "Haus", "Schule"]);
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
