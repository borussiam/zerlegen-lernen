import { describe, expect, it } from "vitest";
import { dedupeInflectionCandidates, orderedSurfaceLookupTokens } from "./inflection-lookup";
import type { InflectionCandidate } from "./types";

describe("inflection lookup helpers", () => {
  it("orders exact and case fallback tokens without static dictionary lookups", () => {
    expect(orderedSurfaceLookupTokens("Lehrer").map((item) => item.value)).toEqual(["Lehrer", "lehrer"]);
    expect(orderedSurfaceLookupTokens("lehrer").map((item) => item.value)).toEqual(["lehrer", "Lehrer"]);
  });

  it("deduplicates repeated DB surface candidates by lemma and source", () => {
    const candidate: InflectionCandidate = {
      surfaceForm: "lernt",
      lemmaId: "verb:none:lernen",
      lemma: "lernen",
      article: null,
      partOfSpeech: "Verb",
      meaning: "to learn",
      morphology: { partOfSpeech: "verb", tense: "present" },
      exactCase: true,
      source: "wiktionary-inflection",
    };
    expect(dedupeInflectionCandidates([candidate, { ...candidate }])).toEqual([candidate]);
  });
});
