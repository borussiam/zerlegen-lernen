import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL을 .env.local 또는 실행 환경에 설정해 주세요.");

const schema = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = neon(databaseUrl);

for (const statement of statements) {
  await sql.query(statement);
}

console.log(`Neon 스키마 적용 완료 (${statements.length}개 구문)`);
