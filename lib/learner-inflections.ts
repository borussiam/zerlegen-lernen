import type { LearnerInflectionSummary } from "./types";
import type { WiktionaryInflectionSurface } from "./wiktionary-inflections";

function firstSurface(
  surfaces: WiktionaryInflectionSurface[],
  predicate: (surface: WiktionaryInflectionSurface) => boolean,
) {
  return surfaces.find(predicate)?.surfaceForm;
}

function isMeaningfulForm(form: string | undefined) {
  return Boolean(form && form !== "—");
}

export function getLearnerInflectionSummaryFromWiktionary(
  word: string,
  partOfSpeech: string | null | undefined,
  surfaces: WiktionaryInflectionSurface[],
): LearnerInflectionSummary | null {
  const normalizedPos = partOfSpeech?.toLocaleLowerCase("en-US") ?? "";
  if (normalizedPos.includes("adjective")) {
    const adjectiveSurfaces = surfaces.filter((surface) => surface.morphology.partOfSpeech === "adjective");
    const gradable = adjectiveSurfaces.every((surface) => surface.morphology.gradable !== false);
    const comparative = gradable ? firstSurface(adjectiveSurfaces, (surface) => surface.morphology.degree === "comparative") : undefined;
    const superlative = gradable ? firstSurface(adjectiveSurfaces, (surface) => surface.morphology.degree === "superlative") : undefined;
    if (!gradable || comparative || superlative) {
      return {
        kind: "adjective",
        positive: word,
        comparative,
        superlative,
        gradable,
      };
    }
    return null;
  }

  if (!normalizedPos.includes("verb")) return null;
  const verbSurfaces = surfaces.filter((surface) => surface.morphology.partOfSpeech === "verb");
  const present = {
    ich: firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "present" && surface.morphology.person === "1" && surface.morphology.number === "singular") ?? "—",
    du: firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "present" && surface.morphology.person === "2" && surface.morphology.number === "singular") ?? "—",
    erSieEs: firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "present" && surface.morphology.person === "3" && surface.morphology.number === "singular") ?? "—",
    wir: firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "present" && surface.morphology.person === "1" && surface.morphology.number === "plural") ?? "—",
    ihr: firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "present" && surface.morphology.person === "2" && surface.morphology.number === "plural") ?? "—",
    sieSie: firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "present" && surface.morphology.person === "3" && surface.morphology.number === "plural") ?? "—",
  };
  const preteriteThirdPerson = firstSurface(verbSurfaces, (surface) => (
    surface.morphology.tense === "preterite"
    && surface.morphology.mood !== "subjunctive-ii"
    && (surface.morphology.person === undefined || surface.morphology.person === "3")
  ));
  const pastParticiple = firstSurface(verbSurfaces, (surface) => surface.morphology.tense === "past-participle");
  const auxiliary = verbSurfaces.find((surface) => surface.morphology.auxiliary)?.morphology.auxiliary;

  if (
    !isMeaningfulForm(preteriteThirdPerson)
    && !isMeaningfulForm(pastParticiple)
    && !Object.values(present).some(isMeaningfulForm)
  ) return null;

  return {
    kind: "verb",
    infinitive: word,
    preteriteThirdPerson,
    pastParticiple,
    auxiliary,
    present,
    imperative: {
      du: firstSurface(verbSurfaces, (surface) => surface.morphology.mood === "imperative" && surface.morphology.person === "2" && surface.morphology.number === "singular") ?? "—",
      ihr: firstSurface(verbSurfaces, (surface) => surface.morphology.mood === "imperative" && surface.morphology.person === "2" && surface.morphology.number === "plural") ?? "—",
      sie: firstSurface(verbSurfaces, (surface) => surface.morphology.mood === "imperative" && surface.surfaceForm.includes("Sie")) ?? "—",
    },
  };
}

export function addLearnerInflectionFromWiktionary<T extends { word: string; partOfSpeech?: string | null; learnerInflection?: LearnerInflectionSummary }>(
  result: T,
  surfaces: WiktionaryInflectionSurface[],
): T {
  if (result.learnerInflection) return result;
  const learnerInflection = getLearnerInflectionSummaryFromWiktionary(result.word, result.partOfSpeech, surfaces);
  return learnerInflection ? { ...result, learnerInflection } : result;
}

export function addLearnerInflection<T extends { word: string; partOfSpeech?: string | null; learnerInflection?: LearnerInflectionSummary }>(
  result: T,
): T {
  return result;
}
