import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { applyRuntimeSchema, seedFunctionWords } from "./seed-function-words";
import type { RuntimeVocabularyQuery } from "../lib/runtime-vocabulary-store";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL을 .env.local 또는 실행 환경에 설정해 주세요.");

const sql = neon(databaseUrl);
const query: RuntimeVocabularyQuery = (statement, parameters = []) => (
  sql.query(statement, [...parameters]) as Promise<unknown[]>
);

await applyRuntimeSchema(query);
const seedResult = await seedFunctionWords(query, {
  delayMs: Number(process.env.FUNCTION_WORD_SEED_DELAY_MS ?? "750"),
});

console.log(`Neon 스키마 적용 및 기능어 시드 완료 (${seedResult.seeded}/${seedResult.requested})`);
