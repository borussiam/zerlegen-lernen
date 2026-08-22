import type { MorphologicalMetadata } from "./types";

export interface PrepositionContraction {
  surfaceForm: string;
  preposition: string;
  article: "dem" | "der" | "das";
  case: "Dativ" | "Akkusativ";
}

export const PREPOSITION_CONTRACTIONS: readonly PrepositionContraction[] = [
  { surfaceForm: "am", preposition: "an", article: "dem", case: "Dativ" },
  { surfaceForm: "im", preposition: "in", article: "dem", case: "Dativ" },
  { surfaceForm: "vom", preposition: "von", article: "dem", case: "Dativ" },
  { surfaceForm: "beim", preposition: "bei", article: "dem", case: "Dativ" },
  { surfaceForm: "zum", preposition: "zu", article: "dem", case: "Dativ" },
  { surfaceForm: "vorm", preposition: "vor", article: "dem", case: "Dativ" },
  { surfaceForm: "hinterm", preposition: "hinter", article: "dem", case: "Dativ" },
  { surfaceForm: "unterm", preposition: "unter", article: "dem", case: "Dativ" },
  { surfaceForm: "überm", preposition: "über", article: "dem", case: "Dativ" },
  { surfaceForm: "aufm", preposition: "auf", article: "dem", case: "Dativ" },
  { surfaceForm: "zur", preposition: "zu", article: "der", case: "Dativ" },
  { surfaceForm: "ins", preposition: "in", article: "das", case: "Akkusativ" },
  { surfaceForm: "ans", preposition: "an", article: "das", case: "Akkusativ" },
  { surfaceForm: "aufs", preposition: "auf", article: "das", case: "Akkusativ" },
  { surfaceForm: "fürs", preposition: "für", article: "das", case: "Akkusativ" },
  { surfaceForm: "ums", preposition: "um", article: "das", case: "Akkusativ" },
  { surfaceForm: "durchs", preposition: "durch", article: "das", case: "Akkusativ" },
  { surfaceForm: "vors", preposition: "vor", article: "das", case: "Akkusativ" },
  { surfaceForm: "hinters", preposition: "hinter", article: "das", case: "Akkusativ" },
  { surfaceForm: "unters", preposition: "unter", article: "das", case: "Akkusativ" },
  { surfaceForm: "übers", preposition: "über", article: "das", case: "Akkusativ" },
  { surfaceForm: "nebens", preposition: "neben", article: "das", case: "Akkusativ" },
  { surfaceForm: "zwischens", preposition: "zwischen", article: "das", case: "Akkusativ" },
] as const;

export const PREPOSITION_CONTRACTION_LEMMAS = Array.from(
  new Set(PREPOSITION_CONTRACTIONS.map((item) => item.preposition)),
);

export function contractionMorphology(contraction: PrepositionContraction): MorphologicalMetadata {
  return {
    partOfSpeech: "preposition",
    contraction: true,
    preposition: contraction.preposition,
    article: contraction.article,
    case: contraction.case,
  };
}

export function getPrepositionContractionSurfaceForms(preposition: string) {
  const normalized = preposition.trim().normalize("NFC").toLocaleLowerCase("de-DE");
  return PREPOSITION_CONTRACTIONS
    .filter((item) => item.preposition.toLocaleLowerCase("de-DE") === normalized)
    .map((item) => ({
      surfaceForm: item.surfaceForm,
      morphology: contractionMorphology(item),
    }));
}

