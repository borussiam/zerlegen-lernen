import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { capitalizeGermanToken, startsWithUppercaseGermanLetter, stripGermanToken, tokenizeGermanText } from "../lib/german-tokenizer";
import { getRuntimeVocabularyStore, isStoredParseResult } from "../lib/runtime-vocabulary-store";
import type { InflectionCandidate, ParseResult, WordExample } from "../lib/types";

loadEnvConfig(process.cwd());

const DATA_PATH = path.resolve("public/data/pre-parsed-words.json");
const RUNTIME_DATA_PATH = path.resolve("data/runtime-vocabulary.json");
const REPORT_PATH = path.resolve("reports/example-sentence-token-audit.json");
const USE_DATABASE = !process.argv.includes("--no-db");
const lookupCache = new Map<string, Promise<InflectionCandidate[]>>();

interface Dataset {
  words: ParseResult[];
}

interface MissingTokenRecord {
  surface: string;
  normalized: string;
  frequency: number;
  suspectedPartOfSpeech: string;
  rootCause: string;
  examples: Array<{ owner: string; sentence: string }>;
}

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const words = (value as { words?: unknown }).words;
  return Array.isArray(words) && words.every(isStoredParseResult);
}

async function loadDataset(filePath: string) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error(`${filePath} 형식이 올바르지 않습니다.`);
    return parsed.words;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing) return [];
    throw error;
  }
}

function examplesFor(result: ParseResult): WordExample[] {
  const variants = result.variants?.flatMap((variant) => variant.examples) ?? [];
  return [...result.examples, ...variants]
    .filter((example, index, examples) => (
      example.kind !== "word"
      && examples.findIndex((candidate) => candidate.sentence === example.sentence) === index
    ));
}

function candidateKey(candidate: Pick<InflectionCandidate, "lemmaId" | "source">) {
  return `${candidate.source}:${candidate.lemmaId}`;
}

function mergeCandidates(left: InflectionCandidate[], right: InflectionCandidate[]) {
  const seen = new Set<string>();
  return [...left, ...right].filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalized(value: string) {
  return stripGermanToken(value).toLocaleLowerCase("de-DE");
}

function buildHeadwordSet(words: ParseResult[]) {
  const headwords = new Set<string>();
  for (const word of words) {
    headwords.add(normalized(word.word));
    word.variants?.forEach((variant) => headwords.add(normalized(variant.word)));
  }
  return headwords;
}

function suspectedPartOfSpeech(surface: string) {
  const lower = normalized(surface);
  if (/^(?:ge.+t|ge.+en)$/.test(lower)) return "Participle";
  if (/(?:st|t|en|e)$/.test(lower)) return "Verb/Inflection";
  if (/(?:er|en|em|es|e)$/.test(lower)) return "Declined form";
  if (startsWithUppercaseGermanLetter(surface)) return "Noun or sentence-initial token";
  return "Unknown";
}

function rootCause(surface: string, headwords: Set<string>) {
  const clean = stripGermanToken(surface);
  const lower = normalized(clean);
  const capitalized = capitalizeGermanToken(lower);
  if (startsWithUppercaseGermanLetter(clean) && headwords.has(lower)) return "capitalization-mismatch";
  if (!startsWithUppercaseGermanLetter(clean) && headwords.has(normalized(capitalized))) return "lowercase-noun-or-capitalization";
  if (/(?:st|t|en|e|er|em|es)$/.test(lower)) return "missing-inflection-form";
  return "missing-lemma-or-dictionary-entry";
}

async function resolveToken(surface: string, tokenIndex: number) {
  const cacheKey = `${surface}\n${tokenIndex === 0 ? "initial" : "other"}`;
  const cached = lookupCache.get(cacheKey);
  if (cached) return cached;
  const request = resolveTokenUncached(surface, tokenIndex);
  lookupCache.set(cacheKey, request);
  return request;
}

async function resolveTokenUncached(surface: string, tokenIndex: number) {
  const store = USE_DATABASE ? getRuntimeVocabularyStore() : null;
  if (!store) return [];
  try {
    return mergeCandidates([], await store.lookupInflections(surface, { sentenceInitial: tokenIndex === 0 }));
  } catch (error) {
    console.warn("DB 굴절형 조회를 건너뜁니다.", error);
    return [];
  }
}

async function main() {
  const words = [...await loadDataset(DATA_PATH), ...await loadDataset(RUNTIME_DATA_PATH)];
  const headwords = buildHeadwordSet(words);
  const missing = new Map<string, MissingTokenRecord>();
  let sentenceCount = 0;
  let tokenCount = 0;
  let resolvedTokens = 0;

  for (const word of words) {
    for (const example of examplesFor(word)) {
      sentenceCount += 1;
      for (const token of tokenizeGermanText(example.sentence).filter((item) => item.word)) {
        tokenCount += 1;
        const surface = stripGermanToken(token.clean);
        const candidates = await resolveToken(surface, token.index);
        if (candidates.length || headwords.has(normalized(surface))) {
          resolvedTokens += 1;
          continue;
        }

        const key = normalized(surface);
        const existing = missing.get(key);
        const nextExample = { owner: word.word, sentence: example.sentence };
        if (existing) {
          existing.frequency += 1;
          if (existing.examples.length < 5) existing.examples.push(nextExample);
        } else {
          missing.set(key, {
            surface,
            normalized: key,
            frequency: 1,
            suspectedPartOfSpeech: suspectedPartOfSpeech(surface),
            rootCause: rootCause(surface, headwords),
            examples: [nextExample],
          });
        }
      }
    }
  }

  const missingTokens = Array.from(missing.values()).sort((left, right) => (
    right.frequency - left.frequency || left.normalized.localeCompare(right.normalized, "de")
  ));
  const rootCauses = missingTokens.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.rootCause] = (accumulator[item.rootCause] ?? 0) + item.frequency;
    return accumulator;
  }, {});
  const summary = {
    generatedAt: new Date().toISOString(),
    sentences: sentenceCount,
    tokens: tokenCount,
    resolvedTokens,
    missingTokens: tokenCount - resolvedTokens,
    uniqueMissingTokens: missingTokens.length,
    rootCauses,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({ summary, missingTokens }, null, 2)}\n`, "utf8");
  console.log(`예문 토큰 감사 완료: ${summary.uniqueMissingTokens}개 고유 미해결 토큰, 보고서 ${REPORT_PATH}`);
}

await main();
