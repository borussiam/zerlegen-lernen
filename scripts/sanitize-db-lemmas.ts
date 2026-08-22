import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { createRuntimeVocabularyStore, isStoredParseResult, type RuntimeVocabularyQuery } from "../lib/runtime-vocabulary-store";
import { ingestGermanWiktionaryEntry } from "../lib/wiktionary-ingestion";
import { applyRuntimeSchema } from "./seed-function-words";

loadEnvConfig(process.cwd());

interface ContaminatedLemmaRow {
  lemma_id?: unknown;
  headword?: unknown;
  result?: unknown;
}

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function parseStoredResult(value: unknown) {
  if (isStoredParseResult(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isStoredParseResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadContaminatedRows(query: RuntimeVocabularyQuery, limit: number) {
  const rows = await query(
    `select lemma_id, headword, result
     from lemmas
     where result is not null
       and exists (
         select 1
         from jsonb_array_elements_text(result->'meanings') as meaning(value)
         where meaning.value ~* '\\m(inflection of|[^[:alpha:]]form of)\\M'
       )
     order by updated_at desc
     limit $1`,
    [limit > 0 ? limit : 10_000],
  );

  return rows.flatMap((row): Array<{ lemmaId: string; headword: string }> => {
    if (!row || typeof row !== "object") return [];
    const item = row as ContaminatedLemmaRow;
    const result = parseStoredResult(item.result);
    const lemmaId = typeof item.lemma_id === "string" ? item.lemma_id : "";
    const headword = result?.word ?? (typeof item.headword === "string" ? item.headword : "");
    return lemmaId && headword ? [{ lemmaId, headword }] : [];
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL을 .env.local 또는 실행 환경에 설정해 주세요.");

const dryRun = process.argv.includes("--dry-run");
  const limit = Number(argValue("limit", "0"));
  const sql = neon(databaseUrl);
  const query: RuntimeVocabularyQuery = (statement, parameters = []) => (
    sql.query(statement, [...parameters]) as Promise<unknown[]>
  );
  const store = createRuntimeVocabularyStore(query);

  if (!dryRun) await applyRuntimeSchema(query);
  if (!dryRun) {
    const stalePronounRows = await query(
      `delete from inflection_surface_forms
       using lemmas
       where lemmas.lemma_id = inflection_surface_forms.lemma_id
         and inflection_surface_forms.source = 'wiktionary-inflection'
         and coalesce(lemmas.part_of_speech, '') ~* '\\mpronoun\\M'
         and inflection_surface_forms.morphology->>'partOfSpeech' = 'noun'
       returning inflection_surface_forms.id`,
    );
    console.log(`Removed ${stalePronounRows.length} POS-inconsistent pronoun surface row(s).`);

    const staleVerbRows = await query(
      `delete from inflection_surface_forms
       using lemmas
       where lemmas.lemma_id = inflection_surface_forms.lemma_id
         and inflection_surface_forms.source = 'wiktionary-inflection'
         and coalesce(lemmas.part_of_speech, '') ~* '\\mverb\\M'
         and inflection_surface_forms.morphology->>'partOfSpeech' = 'verb'
         and not (inflection_surface_forms.morphology ? 'tense')
         and not (inflection_surface_forms.morphology ? 'person')
         and inflection_surface_forms.morphology->>'mood' = 'indicative'
       returning inflection_surface_forms.id`,
    );
    console.log(`Removed ${staleVerbRows.length} weakly-typed verb surface row(s).`);

    const dirtyVerbPronounRows = await query(
      `delete from inflection_surface_forms
       using lemmas
       where lemmas.lemma_id = inflection_surface_forms.lemma_id
         and coalesce(lemmas.part_of_speech, '') ~* '\\mverb\\M'
         and lower(inflection_surface_forms.surface_form) = any($1::text[])
       returning inflection_surface_forms.id`,
      [["ich", "du", "er", "sie", "es", "wir", "ihr", "man"]],
    );
    console.log(`Removed ${dirtyVerbPronounRows.length} verb surface row(s) polluted by subject pronouns.`);

    const dirtyNominalArticleRows = await query(
      `delete from inflection_surface_forms
       using lemmas
       where lemmas.lemma_id = inflection_surface_forms.lemma_id
         and lower(inflection_surface_forms.surface_form) = any($1::text[])
         and coalesce(lemmas.part_of_speech, '') ~* '\\m(noun|adjective)\\M'
       returning inflection_surface_forms.id`,
      [["der", "die", "das", "des", "dem", "den", "ein", "eine", "eines", "einem", "einen", "einer"]],
    );
    console.log(`Removed ${dirtyNominalArticleRows.length} nominal surface row(s) polluted by leading articles.`);

    const dirtyPhraseSurfaceRows = await query(
      `delete from inflection_surface_forms
       using lemmas
       where lemmas.lemma_id = inflection_surface_forms.lemma_id
         and inflection_surface_forms.surface_form !~ '\\s'
         and lemmas.headword ~ '\\s'
         and (
           lemmas.result is null
           or jsonb_array_length(coalesce(lemmas.result->'meanings', '[]'::jsonb)) = 0
           or not exists (
             select 1
             from jsonb_array_elements_text(coalesce(lemmas.result->'meanings', '[]'::jsonb)) as meaning(value)
             where btrim(meaning.value) <> ''
               and meaning.value <> '사전에서 정의를 자동 추출하지 못했습니다.'
           )
         )
       returning inflection_surface_forms.id`,
    );
    console.log(`Removed ${dirtyPhraseSurfaceRows.length} single-token surface row(s) mapped to unresolved phrase lemmas.`);

    const dirtyPhraseLemmaRows = await query(
      `delete from lemmas
       where headword ~ '\\s'
         and (
           result is null
           or jsonb_array_length(coalesce(result->'meanings', '[]'::jsonb)) = 0
           or not exists (
             select 1
             from jsonb_array_elements_text(coalesce(result->'meanings', '[]'::jsonb)) as meaning(value)
             where btrim(meaning.value) <> ''
               and meaning.value <> '사전에서 정의를 자동 추출하지 못했습니다.'
           )
         )
       returning lemma_id`,
    );
    console.log(`Removed ${dirtyPhraseLemmaRows.length} unresolved phrase lemma row(s).`);
  }

  const rows = await loadContaminatedRows(query, limit);
  let sanitized = 0;
  const failures: Array<{ headword: string; error: string }> = [];

  for (const row of rows) {
    try {
      if (!dryRun) {
        await ingestGermanWiktionaryEntry(row.headword, store);
        await query("delete from lemmas where lemma_id = $1", [row.lemmaId]);
      }
      sanitized += 1;
      console.log(`${sanitized}/${rows.length} ${row.headword}: sanitized`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ headword: row.headword, error: message });
      console.warn(`${row.headword}: ${message}`);
    }
  }

  console.log(`Lemma sanitization complete. Sanitized ${sanitized}/${rows.length}; failures: ${failures.length}.`);
  if (failures.length && process.argv.includes("--strict")) {
    throw new Error(`Sanitization completed with ${failures.length} failure(s).`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
