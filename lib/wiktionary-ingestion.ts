import { addLearnerInflectionFromWiktionary } from "./learner-inflections";
import { getPrepositionContractionSurfaceForms } from "./preposition-contractions";
import type { RuntimeVocabularyStore } from "./runtime-vocabulary-store";
import type { MorphologicalMetadata } from "./types";
import { parseCanonicalGermanWordWithInflections } from "./wiktionary";

function surfaceKey(surfaceForm: string, morphology: MorphologicalMetadata) {
  return `${surfaceForm.normalize("NFC")}\n${JSON.stringify(morphology)}`;
}

function mergeSurfaceForms(
  surfaces: Array<{ surfaceForm: string; morphology: MorphologicalMetadata }>,
  requestedSurfaces: Array<{ surfaceForm: string; morphology: MorphologicalMetadata }>,
  lemma: string,
) {
  const merged = new Map<string, { surfaceForm: string; morphology: MorphologicalMetadata }>();
  const lemmaIsPhrase = /\s/u.test(lemma.trim());
  for (const item of [...surfaces, ...requestedSurfaces]) {
    const surfaceForm = item.surfaceForm.trim().normalize("NFC");
    if (!surfaceForm) continue;
    if (lemmaIsPhrase && !/\s/u.test(surfaceForm)) continue;
    merged.set(surfaceKey(surfaceForm, item.morphology), { surfaceForm, morphology: item.morphology });
  }
  return Array.from(merged.values());
}

export async function ingestGermanWiktionaryEntry(input: string, store: RuntimeVocabularyStore) {
  const parsed = await parseCanonicalGermanWordWithInflections(input);
  const result = addLearnerInflectionFromWiktionary(parsed.result, parsed.inflections);
  const surfaceForms = mergeSurfaceForms(
    [...parsed.inflections, ...getPrepositionContractionSurfaceForms(result.word)],
    parsed.requestedSurfaceForms,
    result.word,
  );

  await store.upsert(result);
  await store.upsertLemma(result, surfaceForms);

  return {
    result,
    surfaceForms,
    requestedResult: parsed.requestedResult,
    requestedSurfaceForms: parsed.requestedSurfaceForms,
  };
}
