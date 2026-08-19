import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";

loadEnvConfig(process.cwd());

const REPORT_PATH = path.resolve("reports/inflection-audit.json");

interface CountRow {
  count?: unknown;
}

interface SuspiciousRow {
  surface_form?: unknown;
  headword?: unknown;
  morphology?: unknown;
  source?: unknown;
}

function countValue(row: unknown) {
  if (!row || typeof row !== "object") return 0;
  const value = (row as CountRow).count;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for DB inflection audit.");

  const sql = neon(databaseUrl);
  const [lemmaCountRow] = await sql.query("select count(*) from lemmas");
  const [surfaceCountRow] = await sql.query("select count(*) from inflection_surface_forms");
  const [verbLemmaCountRow] = await sql.query("select count(*) from lemmas where coalesce(part_of_speech, '') ~* 'verb'");
  const [verbSurfaceCountRow] = await sql.query(
    "select count(*) from inflection_surface_forms where morphology->>'partOfSpeech' = 'verb'",
  );
  const [adjectiveSurfaceCountRow] = await sql.query(
    "select count(*) from inflection_surface_forms where morphology->>'partOfSpeech' = 'adjective'",
  );
  const suspiciousRows = await sql.query(
    `select inflection_surface_forms.surface_form, lemmas.headword, inflection_surface_forms.morphology, inflection_surface_forms.source
     from inflection_surface_forms
     join lemmas on lemmas.lemma_id = inflection_surface_forms.lemma_id
     where inflection_surface_forms.surface_form ~ '(.)\\1\\1'
        or inflection_surface_forms.surface_form ~ '\\s{2,}'
        or inflection_surface_forms.surface_form ~ '[0-9]'
     order by inflection_surface_forms.updated_at desc
     limit 100`,
  ) as SuspiciousRow[];

  const summary = {
    generatedAt: new Date().toISOString(),
    lemmas: countValue(lemmaCountRow),
    surfaceForms: countValue(surfaceCountRow),
    verbLemmas: countValue(verbLemmaCountRow),
    verbSurfaceForms: countValue(verbSurfaceCountRow),
    adjectiveSurfaceForms: countValue(adjectiveSurfaceCountRow),
    suspiciousSurfaceForms: suspiciousRows.length,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({ summary, suspiciousRows }, null, 2)}\n`, "utf8");
  console.log(`Inflection audit complete. Report: ${REPORT_PATH}`);
  if (suspiciousRows.length) {
    throw new Error(`Inflection audit found ${suspiciousRows.length} suspicious surface form(s).`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
