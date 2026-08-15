import { neon } from "@neondatabase/serverless";
import { getGermanCaseCandidates } from "./german-word";
import type { CefrLevel, ParseResult } from "./types";

export type RuntimeVocabularyQuery = (
  statement: string,
  parameters?: readonly unknown[],
) => Promise<unknown[]>;

interface RuntimeWordRow {
  result: unknown;
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

export function normalizeRuntimeWord(word: string) {
  return word.trim().normalize("NFC");
}

export function createRuntimeVocabularyStore(query: RuntimeVocabularyQuery) {
  return {
    async find(input: string) {
      const candidates = getGermanCaseCandidates(normalizeRuntimeWord(input));
      const rows = await query(
        "select result from runtime_words where normalized_word = any($1::text[]) limit 1",
        [candidates],
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
        `insert into runtime_words (normalized_word, word, result)
         values ($1, $2, $3::jsonb)
         on conflict (normalized_word) do update
         set word = excluded.word, result = excluded.result, updated_at = now()`,
        [normalizeRuntimeWord(result.word), result.word, JSON.stringify(result)],
      );
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
