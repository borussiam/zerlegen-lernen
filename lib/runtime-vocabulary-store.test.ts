import { describe, expect, it } from "vitest";
import type { ParseResult } from "./types";
import { createRuntimeVocabularyStore, normalizeRuntimeWord } from "./runtime-vocabulary-store";

const result: ParseResult = {
  word: "Lampe",
  article: "die",
  partOfSpeech: "Noun",
  meanings: ["lamp"],
  examples: [{ sentence: "Die Lampe leuchtet.", translation: "램프가 빛난다.", source: "wiktionary" }],
  etymology: null,
  morphemes: [{ text: "Lampe", lookup: "Lampe", targetUrl: "https://en.wiktionary.org/wiki/Lampe#German", kind: "root", meaning: "lamp" }],
  sourceUrl: "https://en.wiktionary.org/wiki/Lampe#German",
  compoundHint: null,
  articleReason: null,
  level: "A2",
};

describe("runtime vocabulary store", () => {
  it("normalizes whitespace and Unicode before persistence", () => {
    expect(normalizeRuntimeWord("  La\u006Dpe  ")).toBe("Lampe");
    expect(normalizeRuntimeWord("„Lampe,“")).toBe("Lampe");
  });

  it("looks up German case candidates and validates stored JSON", async () => {
    const calls: Array<{ statement: string; parameters?: readonly unknown[] }> = [];
    const store = createRuntimeVocabularyStore(async (statement, parameters) => {
      calls.push({ statement, parameters });
      return [{ result }];
    });

    await expect(store.find("lampe")).resolves.toEqual(result);
    expect(calls[0]?.parameters?.[0]).toEqual(["lampe", "Lampe"]);
    expect(calls[0]?.parameters?.[1]).toBe("lampe");
  });

  it("skips malformed rows when listing runtime words", async () => {
    const store = createRuntimeVocabularyStore(async () => [
      { result },
      { result: { word: "broken" } },
      { unexpected: result },
    ]);

    await expect(store.list()).resolves.toEqual([result]);
  });

  it("upserts the full parse result under its canonical NFC spelling", async () => {
    const calls: Array<{ statement: string; parameters?: readonly unknown[] }> = [];
    const store = createRuntimeVocabularyStore(async (statement, parameters) => {
      calls.push({ statement, parameters });
      return [];
    });

    await store.upsert(result);
    expect(calls[0]?.statement).toContain("on conflict (normalized_word) do update");
    expect(calls[0]?.parameters).toEqual(["Lampe", "Lampe", JSON.stringify(result), "lampe", "Noun", "die"]);
  });

  it("looks up inflection surfaces with strict surface_form equality", async () => {
    const calls: Array<{ statement: string; parameters?: readonly unknown[] }> = [];
    const store = createRuntimeVocabularyStore(async (statement, parameters) => {
      calls.push({ statement, parameters });
      return [];
    });

    await store.lookupInflections("mir");

    expect(calls[0]?.statement).toContain("where inflection_surface_forms.surface_form = $1");
    expect(calls[0]?.statement).not.toContain("inflection_surface_forms.surface_key = $2");
    expect(calls[0]?.statement).toContain("lemmas.headword !~ '(^-|-$)'");
  });
});
