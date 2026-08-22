import { describe, expect, it } from "vitest";
import { getPrepositionContractionSurfaceForms, PREPOSITION_CONTRACTIONS } from "./preposition-contractions";

describe("preposition contractions", () => {
  it("defines the complete contraction matrix", () => {
    expect(PREPOSITION_CONTRACTIONS.map((item) => [item.surfaceForm, item.preposition])).toEqual([
      ["am", "an"],
      ["im", "in"],
      ["vom", "von"],
      ["beim", "bei"],
      ["zum", "zu"],
      ["vorm", "vor"],
      ["hinterm", "hinter"],
      ["unterm", "unter"],
      ["überm", "über"],
      ["aufm", "auf"],
      ["zur", "zu"],
      ["ins", "in"],
      ["ans", "an"],
      ["aufs", "auf"],
      ["fürs", "für"],
      ["ums", "um"],
      ["durchs", "durch"],
      ["vors", "vor"],
      ["hinters", "hinter"],
      ["unters", "unter"],
      ["übers", "über"],
      ["nebens", "neben"],
      ["zwischens", "zwischen"],
    ]);
  });

  it("returns structured contraction metadata for parent prepositions", () => {
    expect(getPrepositionContractionSurfaceForms("zu")).toEqual([
      {
        surfaceForm: "zum",
        morphology: {
          partOfSpeech: "preposition",
          contraction: true,
          preposition: "zu",
          article: "dem",
          case: "Dativ",
        },
      },
      {
        surfaceForm: "zur",
        morphology: {
          partOfSpeech: "preposition",
          contraction: true,
          preposition: "zu",
          article: "der",
          case: "Dativ",
        },
      },
    ]);
  });
});
