import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { createRuntimeVocabularyStore, type RuntimeVocabularyQuery } from "../lib/runtime-vocabulary-store";
import { ingestGermanWiktionaryEntry } from "../lib/wiktionary-ingestion";

loadEnvConfig(process.cwd());

const FUNCTION_WORD_LEMMAS = [
  "der", "ein", "kein",
  "ich", "du", "er", "sie", "es", "wir", "ihr",
  "sich",
  "dieser", "jener",
  "wer", "was", "welcher",
  "mein", "dein", "sein", "ihr", "unser", "euer",
  "in", "an", "auf", "zu", "mit", "von", "bei", "nach", "aus", "um",
  "durch", "für", "ohne", "gegen", "über", "unter", "vor", "hinter",
  "neben", "zwischen",
  "und", "oder", "aber", "denn", "weil", "dass", "ob", "wenn", "als", "obwohl",
];

interface SeedOptions {
  dryRun?: boolean;
  delayMs?: number;
  limit?: number;
  words?: string[];
}

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function applyRuntimeSchema(query: RuntimeVocabularyQuery) {
  const schema = await readFile(path.resolve("db/schema.sql"), "utf8");
  const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await query(statement);
}

export async function seedFunctionWords(query: RuntimeVocabularyQuery, options: SeedOptions = {}) {
  const store = createRuntimeVocabularyStore(query);
  const uniqueWords = Array.from(new Set(options.words?.length ? options.words : FUNCTION_WORD_LEMMAS));
  const words = options.limit && options.limit > 0 ? uniqueWords.slice(0, options.limit) : uniqueWords;
  let seeded = 0;
  const failures: Array<{ word: string; error: string }> = [];

  for (const [index, word] of words.entries()) {
    if (index > 0 && options.delayMs && options.delayMs > 0) await delay(options.delayMs);
    try {
      if (!options.dryRun) await ingestGermanWiktionaryEntry(word, store);
      seeded += 1;
      console.log(`${index + 1}/${words.length} ${word}: seeded`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ word, error: message });
      console.warn(`${index + 1}/${words.length} ${word}: ${message}`);
    }
  }

  console.log(`Function-word seed complete. Seeded ${seeded}/${words.length}; failures: ${failures.length}.`);
  return { requested: words.length, seeded, failures };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL을 .env.local 또는 실행 환경에 설정해 주세요.");

  const sql = neon(databaseUrl);
  const query: RuntimeVocabularyQuery = (statement, parameters = []) => (
    sql.query(statement, [...parameters]) as Promise<unknown[]>
  );

  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) await applyRuntimeSchema(query);
  await seedFunctionWords(query, {
    dryRun,
    delayMs: Number(argValue("delay-ms", "750")),
    limit: Number(argValue("limit", "0")),
    words: argValue("word", "").split(",").map((word) => word.trim()).filter(Boolean),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
