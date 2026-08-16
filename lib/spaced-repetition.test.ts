import { describe, expect, it } from "vitest";
import type { FavoriteWord } from "./types";
import {
  DAY_MS,
  activateUnknownType,
  applyReview,
  buildClozeWordPool,
  createWordId,
  dueMasteredWords,
  isReviewDue,
  markMastered,
  migrateWordbookState,
  recordArticleAnswer,
  removeMastery,
  reviewSucceeded,
  shouldSuggestMastery,
} from "./spaced-repetition";

const NOW = Date.UTC(2026, 7, 12, 0, 0, 0);

function favorite(overrides: Partial<FavoriteWord> = {}): FavoriteWord {
  const word = overrides.word ?? "Haus";
  const partOfSpeech = overrides.partOfSpeech ?? "Noun";
  return {
    id: createWordId(word, partOfSpeech),
    word,
    article: "das",
    meaning: "집",
    partOfSpeech,
    favoriteTypes: ["meaning", "article"],
    addedAt: NOW,
    ...overrides,
  };
}

describe("wordbook migration", () => {
  it("migrates raw arrays without losing flags or timestamps", () => {
    const state = migrateWordbookState([{
      word: "Haus",
      article: "das",
      meaning: "집",
      partOfSpeech: "Noun",
      favoriteTypes: ["article"],
      addedAt: 123,
    }], NOW);
    expect(state.version).toBe(2);
    expect(state.words[0]).toMatchObject({
      id: createWordId("Haus", "Noun"),
      favoriteTypes: ["article"],
      addedAt: 123,
    });
    expect(state.words[0].mastery).toBeUndefined();
  });

  it("defaults legacy active entries to meaning unknown", () => {
    const state = migrateWordbookState([{ word: "alt", article: null, meaning: "old" }], NOW);
    expect(state.words[0].favoriteTypes).toEqual(["meaning"]);
  });

  it("preserves mastered entries with empty flags in a v2 envelope", () => {
    const mastered = markMastered(favorite(), NOW);
    const state = migrateWordbookState({ version: 2, words: [mastered] }, NOW + DAY_MS);
    expect(state.words[0].mastery).toEqual(mastered.mastery);
    expect(state.words[0].favoriteTypes).toEqual([]);
  });

  it("consolidates capitalization and POS variants under one headword identity", () => {
    expect(createWordId("Recht", "Noun")).toBe(createWordId("recht", "Adjective"));
  });
});

describe("mastery transitions", () => {
  it("clears flags and remembers them when mastering", () => {
    const mastered = markMastered(favorite(), NOW);
    expect(mastered.favoriteTypes).toEqual([]);
    expect(mastered.mastery).toMatchObject({
      masteredAt: NOW,
      reviewStep: 0,
      nextReviewAt: NOW + DAY_MS,
      previousFavoriteTypes: ["meaning", "article"],
    });
  });

  it("restores previous flags when mastery is removed", () => {
    expect(removeMastery(markMastered(favorite(), NOW)).favoriteTypes).toEqual(["meaning", "article"]);
  });

  it("uses meaning as the fallback when previous flags are unavailable", () => {
    const mastered = markMastered(favorite(), NOW);
    mastered.mastery!.previousFavoriteTypes = [];
    expect(removeMastery(mastered).favoriteTypes).toEqual(["meaning"]);
  });

  it("turns a mastered word into only the explicitly selected unknown type", () => {
    const active = activateUnknownType(markMastered(favorite(), NOW), "article");
    expect(active.favoriteTypes).toEqual(["article"]);
    expect(active.mastery).toBeUndefined();
  });
});

describe("review scheduling", () => {
  it("advances through 1, 3, 7, and repeating 30-day intervals", () => {
    let word = markMastered(favorite(), NOW);
    expect(word.mastery!.nextReviewAt).toBe(NOW + DAY_MS);
    let clock = word.mastery!.nextReviewAt;
    for (const expectedDays of [3, 7, 30, 30]) {
      word = applyReview(word, { meaningKnown: true, articleKnown: true }, clock);
      expect(word.mastery!.nextReviewAt).toBe(clock + expectedDays * DAY_MS);
      clock = word.mastery!.nextReviewAt;
    }
    expect(word.mastery!.reviewStep).toBe(3);
  });

  it("treats the exact due instant as due and uses the injected clock", () => {
    const word = markMastered(favorite(), NOW);
    expect(isReviewDue(word, NOW + DAY_MS - 1)).toBe(false);
    expect(isReviewDue(word, NOW + DAY_MS)).toBe(true);
  });

  it("resets a failed review to one day without removing mastery", () => {
    let word = markMastered(favorite(), NOW);
    word = applyReview(word, { meaningKnown: true, articleKnown: true }, NOW + DAY_MS);
    word = applyReview(word, { meaningKnown: false, articleKnown: true }, NOW + 4 * DAY_MS);
    expect(word.mastery).toBeDefined();
    expect(word.mastery).toMatchObject({ reviewStep: 0, nextReviewAt: NOW + 5 * DAY_MS });
  });

  it("requires article knowledge only for words with articles", () => {
    expect(reviewSucceeded(favorite(), { meaningKnown: true, articleKnown: false })).toBe(false);
    const verb = favorite({ word: "lernen", article: null, partOfSpeech: "Verb" });
    const affix = favorite({ word: "-keit", article: null, partOfSpeech: "Suffix" });
    expect(reviewSucceeded(verb, { meaningKnown: true })).toBe(true);
    expect(reviewSucceeded(affix, { meaningKnown: true })).toBe(true);
  });
});

describe("practice and quiz pools", () => {
  it("orders active words before due mastered words and omits non-due mastery", () => {
    const active = favorite({ word: "Zeit", id: createWordId("Zeit", "Noun"), favoriteTypes: ["article"] });
    const due = markMastered(favorite({ word: "Baum", id: createWordId("Baum", "Noun") }), NOW - DAY_MS);
    const future = markMastered(favorite({ word: "Buch", id: createWordId("Buch", "Noun") }), NOW);
    expect(buildClozeWordPool([future, due, active], NOW).map((word) => word.word)).toEqual(["Zeit", "Baum"]);
    expect(dueMasteredWords([future, due], NOW)).toEqual([due]);
  });

  it("suggests but never automatically applies mastery after three correct article answers", () => {
    let word = favorite({ favoriteTypes: ["article"] });
    word = recordArticleAnswer(word, true, NOW);
    word = recordArticleAnswer(word, true, NOW + 1);
    word = recordArticleAnswer(word, true, NOW + 2);
    expect(shouldSuggestMastery(word)).toBe(true);
    expect(word.mastery).toBeUndefined();
    word = recordArticleAnswer(word, false, NOW + 3);
    expect(word.practice?.articleCorrectStreak).toBe(0);
  });
});
