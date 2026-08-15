import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { createRuntimeVocabularyStore, isStoredParseResult } from "../lib/runtime-vocabulary-store";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL을 .env.local 또는 실행 환경에 설정해 주세요.");

const runtimePath = path.join(process.cwd(), "data", "runtime-vocabulary.json");
let parsed: unknown;
try {
  parsed = JSON.parse(await readFile(runtimePath, "utf8")) as unknown;
} catch (error) {
  const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
  if (missing) {
    console.log("이전할 data/runtime-vocabulary.json 파일이 없습니다.");
    process.exit(0);
  }
  throw error;
}

const words = typeof parsed === "object" && parsed !== null && "words" in parsed
  ? (parsed as { words?: unknown }).words
  : null;
if (!Array.isArray(words) || !words.every(isStoredParseResult)) {
  throw new Error("data/runtime-vocabulary.json 형식이 올바르지 않습니다.");
}

const sql = neon(databaseUrl);
const store = createRuntimeVocabularyStore((statement, parameters = []) => (
  sql.query(statement, [...parameters]) as Promise<unknown[]>
));
for (const word of words) await store.upsert(word);

console.log(`런타임 단어 ${words.length}개를 Neon으로 이전했습니다.`);
