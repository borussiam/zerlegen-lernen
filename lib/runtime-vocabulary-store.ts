import { neon } from "@neondatabase/serverless";
import { headwordKeyFor } from "./dictionary-entry";
import { getGermanCaseCandidates } from "./german-word";
import { candidateFromParseResult, rankInflectionCandidates } from "./inflection-lookup";
import { stripGermanToken } from "./german-tokenizer";
import type { CefrLevel, InflectionCandidate, MorphologicalMetadata, ParseResult } from "./types";

export type RuntimeVocabularyQuery = (
  statement: string,
  parameters?: readonly unknown[],
) => Promise<unknown[]>;

interface RuntimeWordRow {
  result: unknown;
}

interface InflectionRow {
  surface_form?: unknown;
  lemma_id?: unknown;
  morphology?: unknown;
  exact_case?: unknown;
  source?: unknown;
  result?: unknown;
  headword?: unknown;
  article?: unknown;
  part_of_speech?: unknown;
}

interface LemmaRow {
  headword?: unknown;
  article?: unknown;
  part_of_speech?: unknown;
  result?: unknown;
  exact_case?: unknown;
}

function isCefrLevel(value: unknown): value is CefrLevel {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2";
}

export function isStoredParseResult(value: unknown): value is ParseResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<ParseResult>;
  return typeof result.word === "string"
    && (result.article === null || result.article === "der" || result.article === "die" || result.article === "das")
    && (result.partOfSpeech === null || typeof result.partOfSpeech === "string")
    && Array.isArray(result.meanings)
    && result.meanings.every((meaning) => typeof meaning === "string")
    && Array.isArray(result.examples)
    && Array.isArray(result.morphemes)
    && typeof result.sourceUrl === "string"
    && (result.level === undefined || result.level === null || isCefrLevel(result.level));
}

function parseStoredResult(value: unknown) {
  if (typeof value !== "string") return isStoredParseResult(value) ? value : null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isStoredParseResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowResult(row: unknown) {
  if (typeof row !== "object" || row === null || !("result" in row)) return null;
  return parseStoredResult((row as RuntimeWordRow).result);
}

function parseMorphology(value: unknown): MorphologicalMetadata {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") return { partOfSpeech: "other" };
  const partOfSpeech = (parsed as Partial<MorphologicalMetadata>).partOfSpeech;
  return {
    ...(parsed as Partial<MorphologicalMetadata>),
    partOfSpeech: typeof partOfSpeech === "string" ? partOfSpeech : "other",
  } as MorphologicalMetadata;
}

function articleValue(value: unknown) {
  return value === "der" || value === "die" || value === "das" ? value : null;
}

function inflectionCandidateFromRow(row: unknown): InflectionCandidate | null {
  if (typeof row !== "object" || row === null) return null;
  const item = row as InflectionRow;
  const surfaceForm = typeof item.surface_form === "string" ? item.surface_form : "";
  const lemmaId = typeof item.lemma_id === "string" ? item.lemma_id : "";
  const result = parseStoredResult(item.result);
  const lemma = result?.word ?? (typeof item.headword === "string" ? item.headword : "");
  if (!surfaceForm || !lemmaId || !lemma) return null;
  return {
    surfaceForm,
    lemmaId,
    lemma,
    article: result?.article ?? articleValue(item.article),
    partOfSpeech: result?.partOfSpeech ?? (typeof item.part_of_speech === "string" ? item.part_of_speech : null),
    meaning: result?.meanings[0] ?? "",
    dictionaryEntry: result ?? undefined,
    morphology: parseMorphology(item.morphology),
    exactCase: item.exact_case === true,
    source: item.source === "wiktionary-inflection" ? "wiktionary-inflection" : "surface-map",
  };
}

function lemmaCandidateFromRow(row: unknown, surfaceForm: string): InflectionCandidate | null {
  if (typeof row !== "object" || row === null) return null;
  const item = row as LemmaRow;
  const result = parseStoredResult(item.result);
  const lemma = result?.word ?? (typeof item.headword === "string" ? item.headword : "");
  if (!lemma) return null;
  return candidateFromParseResult(surfaceForm, {
    word: lemma,
    article: result?.article ?? articleValue(item.article),
    partOfSpeech: result?.partOfSpeech ?? (typeof item.part_of_speech === "string" ? item.part_of_speech : null),
    meanings: result?.meanings ?? [""],
    examples: result?.examples ?? [],
    etymology: result?.etymology ?? null,
    morphemes: result?.morphemes ?? [],
    sourceUrl: result?.sourceUrl ?? "",
    compoundHint: result?.compoundHint ?? null,
    articleReason: result?.articleReason ?? null,
    level: result?.level,
    headwordKey: result?.headwordKey,
    displayHeadword: result?.displayHeadword,
    variants: result?.variants,
    decompositionOptions: result?.decompositionOptions,
    learnerInflection: result?.learnerInflection,
  }, "lemma");
}

export function normalizeRuntimeWord(word: string) {
  return stripGermanToken(word).trim().normalize("NFC");
}

function prioritizeInflectionRows(candidates: InflectionCandidate[], sentenceInitial = false) {
  return rankInflectionCandidates(candidates, { sentenceInitial });
}

export function createRuntimeVocabularyStore(query: RuntimeVocabularyQuery) {
  return {
    async find(input: string) {
      const candidates = getGermanCaseCandidates(normalizeRuntimeWord(input));
      const headwordKey = headwordKeyFor(input);
      const rows = await query(
        "select result from runtime_words where normalized_word = any($1::text[]) or headword_key = $2 order by updated_at desc",
        [candidates, headwordKey],
      );
      return rows.length ? rowResult(rows[0]) : null;
    },

    async list() {
      const rows = await query("select result from runtime_words order by updated_at desc");
      return rows.flatMap((row): ParseResult[] => {
        const result = rowResult(row);
        return result ? [result] : [];
      });
    },

    async upsert(result: ParseResult) {
      await query(
        `insert into runtime_words (normalized_word, word, result, headword_key, part_of_speech, article)
         values ($1, $2, $3::jsonb, $4, $5, $6)
         on conflict (normalized_word) do update
         set word = excluded.word,
             result = excluded.result,
             headword_key = excluded.headword_key,
             part_of_speech = excluded.part_of_speech,
             article = excluded.article,
             updated_at = now()`,
        [
          normalizeRuntimeWord(result.word),
          result.word,
          JSON.stringify(result),
          headwordKeyFor(result.word),
          result.partOfSpeech,
          result.article,
        ],
      );
    },

    async lookupInflections(surfaceForm: string, options: { exactOnly?: boolean; sentenceInitial?: boolean } = {}) {
      const normalized = normalizeRuntimeWord(surfaceForm);
      const lower = normalized.toLocaleLowerCase("de-DE");
      const rows = await query(
        `select
           inflection_surface_forms.surface_form,
           inflection_surface_forms.lemma_id,
           inflection_surface_forms.morphology,
           inflection_surface_forms.source,
           inflection_surface_forms.surface_form = $1 as exact_case,
           lemmas.headword,
           lemmas.article,
           lemmas.part_of_speech,
           lemmas.result
         from inflection_surface_forms
         join lemmas on lemmas.lemma_id = inflection_surface_forms.lemma_id
         where inflection_surface_forms.surface_form = $1
         order by exact_case desc,
           case
             when $3::boolean = true
              and lemmas.article is null
              and coalesce(lemmas.part_of_speech, '') !~* '\\mnoun\\M'
             then 0
             else 1
           end,
           case
             when lemmas.headword = $1 then 0
             when lemmas.headword_key = $2 and lemmas.headword !~ '(^-|-$)' then 1
             when lemmas.headword ~ '(^-|-$)' then 3
             else 2
           end,
           inflection_surface_forms.updated_at desc
         limit 12`,
        [normalized, lower, options.sentenceInitial === true],
      );
      return prioritizeInflectionRows(rows.flatMap((row): InflectionCandidate[] => {
        const candidate = inflectionCandidateFromRow(row);
        return candidate ? [candidate] : [];
      }), options.sentenceInitial);
    },

    async lookupLemmas(surfaceForm: string, options: { sentenceInitial?: boolean } = {}) {
      const normalized = normalizeRuntimeWord(surfaceForm);
      const rows = await query(
        `select
           headword,
           article,
           part_of_speech,
           result,
           headword = $1 as exact_case
         from lemmas
         where headword = $1
         order by exact_case desc,
           updated_at desc
         limit 12`,
        [normalized],
      );
      return prioritizeInflectionRows(rows.flatMap((row): InflectionCandidate[] => {
        const candidate = lemmaCandidateFromRow(row, normalized);
        return candidate ? [candidate] : [];
      }), options.sentenceInitial);
    },

    async upsertLemma(result: ParseResult, surfaceForms: Array<{ surfaceForm: string; morphology: MorphologicalMetadata }>) {
      const lemmaId = `${result.partOfSpeech ?? "word"}:${result.article ?? "none"}:${result.word}`.toLocaleLowerCase("de-DE");
      await query(
        `insert into lemmas (lemma_id, headword, headword_key, part_of_speech, article, result)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict (lemma_id) do update
         set headword = excluded.headword,
             headword_key = excluded.headword_key,
             part_of_speech = excluded.part_of_speech,
             article = excluded.article,
             result = excluded.result,
             updated_at = now()`,
        [lemmaId, result.word, headwordKeyFor(result.word), result.partOfSpeech, result.article, JSON.stringify(result)],
      );

      await query(
        "delete from inflection_surface_forms where lemma_id = $1 and source = 'wiktionary-inflection'",
        [lemmaId],
      );

      await Promise.all(surfaceForms.map((item) => query(
        `insert into inflection_surface_forms (surface_form, lemma_id, morphology, source)
         values ($1, $2, $3::jsonb, 'wiktionary-inflection')
         on conflict (surface_form, lemma_id, morphology) do update
         set source = excluded.source,
             updated_at = now()`,
        [normalizeRuntimeWord(item.surfaceForm), lemmaId, JSON.stringify(item.morphology)],
      )));

      return candidateFromParseResult(result.word, result);
    },

    async deleteInflectionSurfaceFormsBySource(sources: readonly string[]) {
      if (!sources.length) return 0;
      const rows = await query(
        "delete from inflection_surface_forms where source = any($1::text[]) returning id",
        [sources],
      );
      return rows.length;
    },
  };
}

export type RuntimeVocabularyStore = ReturnType<typeof createRuntimeVocabularyStore>;

let configuredStore: RuntimeVocabularyStore | null | undefined;

export function getRuntimeVocabularyStore() {
  if (configuredStore !== undefined) return configuredStore;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    configuredStore = null;
    return configuredStore;
  }

  const sql = neon(databaseUrl);
  configuredStore = createRuntimeVocabularyStore((statement, parameters = []) => (
    sql.query(statement, [...parameters]) as Promise<unknown[]>
  ));
  return configuredStore;
}
