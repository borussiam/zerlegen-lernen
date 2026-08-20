import { addLearnerInflectionFromWiktionary } from "./learner-inflections";
import type { RuntimeVocabularyStore } from "./runtime-vocabulary-store";
import type { MorphologicalMetadata } from "./types";
import { parseCanonicalGermanWordWithInflections } from "./wiktionary";

function surfaceKey(surfaceForm: string, morphology: MorphologicalMetadata) {
  return `${surfaceForm.normalize("NFC")}\n${JSON.stringify(morphology)}`;
}

function mergeSurfaceForms(
  surfaces: Array<{ surfaceForm: string; morphology: MorphologicalMetadata }>,
  requestedSurfaces: Array<{ surfaceForm: string; morphology: MorphologicalMetadata }>,
) {
  const merged = new Map<string, { surfaceForm: string; morphology: MorphologicalMetadata }>();
  for (const item of [...surfaces, ...requestedSurfaces]) {
    const surfaceForm = item.surfaceForm.trim().normalize("NFC");
    if (!surfaceForm) continue;
    merged.set(surfaceKey(surfaceForm, item.morphology), { surfaceForm, morphology: item.morphology });
  }
  return Array.from(merged.values());
}

export async function ingestGermanWiktionaryEntry(input: string, store: RuntimeVocabularyStore) {
  const parsed = await parseCanonicalGermanWordWithInflections(input);
  const result = addLearnerInflectionFromWiktionary(parsed.result, parsed.inflections);
  const surfaceForms = mergeSurfaceForms(parsed.inflections, parsed.requestedSurfaceForms);

  await store.upsert(result);
  await store.upsertLemma(result, surfaceForms);

  return {
    result,
    surfaceForms,
    requestedResult: parsed.requestedResult,
    requestedSurfaceForms: parsed.requestedSurfaceForms,
  };
}
