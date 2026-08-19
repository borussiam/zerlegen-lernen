import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { getGermanCaseCandidates } from "../lib/german-word";
import { getRuntimeVocabularyStore, isStoredParseResult } from "../lib/runtime-vocabulary-store";
import type { CefrLevel, ParseResult } from "../lib/types";

loadEnvConfig(process.cwd());

const DATA_PATH = path.resolve("public/data/pre-parsed-words.json");
const RUNTIME_DATA_PATH = path.resolve("data/runtime-vocabulary.json");
const CHECKPOINT_PATH = path.resolve(".cache/vocabulary-audit.checkpoint.json");
const B1_CHECKPOINT_PATH = path.resolve(".cache/b1-vocabulary-expansion.checkpoint.json");
const REPORT_PATH = path.resolve("reports/cefr-ingestion-audit.json");
const USE_DATABASE = !process.argv.includes("--no-db");

interface Dataset {
  words: ParseResult[];
}

interface ReferenceCandidate {
  word: string;
  level: CefrLevel;
  sourceRank: number | null;
}

interface Checkpoint {
  expansionCandidates?: unknown;
  candidates?: unknown;
  expansionFailures?: unknown;
  failures?: unknown;
}

function normalized(value: string) {
  return value.trim().normalize("NFC").toLocaleLowerCase("de-DE");
}

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const words = (value as { words?: unknown }).words;
  return Array.isArray(words) && words.every(isStoredParseResult);
}

function isReferenceCandidate(value: unknown): value is ReferenceCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReferenceCandidate>;
  return typeof candidate.word === "string"
    && (candidate.level === "A1" || candidate.level === "A2" || candidate.level === "B1" || candidate.level === "B2");
}

async function readJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing) return null;
    throw error;
  }
}

async function loadWords(filePath: string) {
  const parsed = await readJson(filePath);
  if (!parsed) return [];
  if (!isDataset(parsed)) throw new Error(`${filePath} 형식이 올바르지 않습니다.`);
  return parsed.words;
}

async function loadReferenceCandidates() {
  const candidates: ReferenceCandidate[] = [];
  for (const filePath of [CHECKPOINT_PATH, B1_CHECKPOINT_PATH]) {
    const parsed = await readJson(filePath) as Checkpoint | null;
    if (!parsed || typeof parsed !== "object") continue;
    for (const key of ["expansionCandidates", "candidates"] as const) {
      const value = parsed[key];
      if (Array.isArray(value)) {
        candidates.push(...value.filter(isReferenceCandidate));
      }
    }
  }
  return candidates.filter((candidate, index, items) => (
    items.findIndex((item) => normalized(item.word) === normalized(candidate.word) && item.level === candidate.level) === index
  ));
}

function buildStoredWordIndex(words: ParseResult[]) {
  const index = new Map<string, ParseResult[]>();
  for (const word of words) {
    const keys = new Set([
      word.word,
      word.displayHeadword ?? "",
      ...(word.variants?.map((variant) => variant.word) ?? []),
    ].filter(Boolean).flatMap((item) => getGermanCaseCandidates(item)));
    for (const key of keys) {
      const normalizedKey = normalized(key);
      index.set(normalizedKey, [...(index.get(normalizedKey) ?? []), word]);
    }
  }
  return index;
}

function classifyMissing(candidate: ReferenceCandidate, failures: unknown[]) {
  const failure = failures.find((item) => (
    item && typeof item === "object"
    && "word" in item
    && typeof (item as { word?: unknown }).word === "string"
    && normalized((item as { word: string }).word) === normalized(candidate.word)
  ));
  if (failure && "error" in (failure as object)) return `parse-failure: ${String((failure as { error?: unknown }).error)}`;
  if (/^[A-ZÄÖÜ]/u.test(candidate.word) && /(?:n|e|er|en|s)$/iu.test(candidate.word)) return "possible plural-only noun or plural headword";
  if (/^(?:der|die|das)\b/i.test(candidate.word)) return "article-prefixed source item";
  return "missing dictionary entry";
}

async function main() {
  const store = USE_DATABASE ? getRuntimeVocabularyStore() : null;
  const dbWords = store ? await store.list().catch((error: unknown) => {
    console.warn("CEFR 감사에서 DB 단어 목록을 불러오지 못했습니다.", error);
    return [] as ParseResult[];
  }) : [];
  const words = [...dbWords, ...await loadWords(DATA_PATH), ...await loadWords(RUNTIME_DATA_PATH)];
  const index = buildStoredWordIndex(words);
  const references = await loadReferenceCandidates();
  const checkpoint = await readJson(CHECKPOINT_PATH) as Checkpoint | null;
  const b1Checkpoint = await readJson(B1_CHECKPOINT_PATH) as Checkpoint | null;
  const failures = [
    ...(Array.isArray(checkpoint?.expansionFailures) ? checkpoint.expansionFailures : []),
    ...(Array.isArray(b1Checkpoint?.failures) ? b1Checkpoint.failures : []),
  ];

  const missing = references
    .filter((candidate) => !index.has(normalized(candidate.word)))
    .map((candidate) => ({
      ...candidate,
      reason: classifyMissing(candidate, failures),
    }))
    .sort((left, right) => left.level.localeCompare(right.level) || left.word.localeCompare(right.word, "de"));

  const watchWords = ["Eltern", "Geschwister", "Leute"].map((word) => ({
    word,
    present: index.has(normalized(word)),
    matches: (index.get(normalized(word)) ?? []).map((entry) => ({
      word: entry.word,
      displayHeadword: entry.displayHeadword,
      partOfSpeech: entry.partOfSpeech,
      article: entry.article,
      level: entry.level ?? null,
    })),
  }));

  const summary = {
    generatedAt: new Date().toISOString(),
    databaseWords: dbWords.length,
    storedWords: words.length,
    referenceCandidates: references.length,
    missingReferenceCandidates: missing.length,
    byLevel: missing.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.level] = (accumulator[item.level] ?? 0) + 1;
      return accumulator;
    }, {}),
    watchWords,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({ summary, missing }, null, 2)}\n`, "utf8");
  console.log(`CEFR ingestion audit: ${missing.length}/${references.length} reference candidates missing. Report: ${REPORT_PATH}`);
  const eltern = watchWords.find((item) => item.word === "Eltern");
  if (eltern && !eltern.present) console.warn("Eltern is not present in local pre-parsed/runtime vocabulary data.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
