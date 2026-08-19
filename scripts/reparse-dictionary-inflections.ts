import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { addLearnerInflectionFromWiktionary } from "../lib/learner-inflections";
import { createRuntimeVocabularyStore, isStoredParseResult } from "../lib/runtime-vocabulary-store";
import { parseGermanWordWithInflections } from "../lib/wiktionary";
import type { ParseResult } from "../lib/types";

loadEnvConfig(process.cwd());

const BASE_DATA_PATH = path.resolve("public/data/pre-parsed-words.json");
const RUNTIME_DATA_PATH = path.resolve("data/runtime-vocabulary.json");
const REPORT_PATH = path.resolve("reports/reparse-dictionary-inflections.json");
const DEFAULT_DELAY_MS = 750;

type SourceName = "base" | "runtime-json" | "database";
type StoredParseResult = ParseResult & { sourceRank?: number | null };
type Query = (statement: string, parameters?: readonly unknown[]) => Promise<unknown[]>;

interface Dataset {
  words: StoredParseResult[];
}

interface ReparseFailure {
  word: string;
  source: SourceName;
  error: string;
}

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalized(value: string) {
  return value.trim().normalize("NFC").toLocaleLowerCase("de-DE");
}

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const words = (value as { words?: unknown }).words;
  return Array.isArray(words) && words.every(isStoredParseResult);
}

async function loadDataset(filePath: string, source: SourceName) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error(`${filePath} 형식이 올바르지 않습니다.`);
    return parsed.words.map((word) => ({ word, source }));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing) return [];
    throw error;
  }
}

function parseSources() {
  const requested = argValue("source", "all").split(",").map((value) => value.trim());
  if (requested.includes("all")) return new Set<SourceName>(["base", "runtime-json", "database"]);
  const sources = new Set<SourceName>();
  for (const source of requested) {
    if (source === "base" || source === "runtime-json" || source === "database") sources.add(source);
    else throw new Error(`지원하지 않는 source 값입니다: ${source}`);
  }
  return sources;
}

async function applySchema(query: Query) {
  const schema = await readFile(path.resolve("db/schema.sql"), "utf8");
  const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await query(statement);
}

async function loadDatabaseWords(query: Query) {
  const rows = await query("select result from runtime_words order by updated_at desc");
  return rows.flatMap((row): Array<{ word: StoredParseResult; source: SourceName }> => {
    if (!row || typeof row !== "object" || !("result" in row)) return [];
    const value = (row as { result?: unknown }).result;
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
    return isStoredParseResult(parsed) ? [{ word: parsed, source: "database" }] : [];
  });
}

function uniqueWords(items: Array<{ word: StoredParseResult; source: SourceName }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalized(item.word.word);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preserveDatasetMetadata(existing: StoredParseResult, reparsed: ParseResult): StoredParseResult {
  return {
    ...reparsed,
    level: existing.level ?? reparsed.level ?? null,
    sourceRank: existing.sourceRank ?? null,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL을 .env.local 또는 실행 환경에 설정해 주세요.");

  const sources = parseSources();
  const dryRun = process.argv.includes("--dry-run");
  const strict = process.argv.includes("--strict");
  const purgeStaticSources = !process.argv.includes("--keep-static-sources");
  const limit = Number(argValue("limit", "0"));
  const delayMs = Number(argValue("delay-ms", String(DEFAULT_DELAY_MS)));
  const sql = neon(databaseUrl);
  const query: Query = (statement, parameters = []) => (
    sql.query(statement, [...parameters]) as Promise<unknown[]>
  );
  const store = createRuntimeVocabularyStore(query);

  if (!dryRun) {
    await applySchema(query);
    if (purgeStaticSources) {
      const rows = await query("delete from inflection_surface_forms where source <> 'wiktionary-inflection' returning id");
      console.log(`Removed ${rows.length} non-Wiktionary inflection row(s).`);
    }
  }

  const inputs = [
    ...(sources.has("base") ? await loadDataset(BASE_DATA_PATH, "base") : []),
    ...(sources.has("runtime-json") ? await loadDataset(RUNTIME_DATA_PATH, "runtime-json") : []),
    ...(sources.has("database") ? await loadDatabaseWords(query) : []),
  ];
  const words = uniqueWords(inputs).slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  const failures: ReparseFailure[] = [];
  let updated = 0;
  let surfaceForms = 0;

  console.log(`Reparsing ${words.length} dictionary entr${words.length === 1 ? "y" : "ies"} from Wiktionary.`);

  for (const [index, item] of words.entries()) {
    if (index > 0 && Number.isFinite(delayMs) && delayMs > 0) await delay(delayMs);
    try {
      const parsed = await parseGermanWordWithInflections(item.word.word);
      const result = preserveDatasetMetadata(
        item.word,
        addLearnerInflectionFromWiktionary(parsed.result, parsed.inflections),
      );
      if (!dryRun) {
        await store.upsert(result);
        await store.upsertLemma(result, parsed.inflections);
      }
      updated += 1;
      surfaceForms += parsed.inflections.length;
      console.log(`${index + 1}/${words.length} ${item.word.word}: ${parsed.inflections.length} surface form(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ word: item.word.word, source: item.source, error: message });
      console.warn(`${index + 1}/${words.length} ${item.word.word}: ${message}`);
    }
  }

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    dryRun,
    sources: Array.from(sources),
    updated,
    surfaceForms,
    failures,
  }, null, 2)}\n`, "utf8");

  console.log(`Reparse complete. Updated ${updated}/${words.length}; ${surfaceForms} surface form(s). Report: ${REPORT_PATH}`);
  if (strict && failures.length) throw new Error(`Reparse completed with ${failures.length} failure(s).`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
