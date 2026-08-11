import { readFile } from "node:fs/promises";
import path from "node:path";
import { getGermanCaseCandidates } from "./german-word";
import type { ParseResult } from "./types";

interface PreParsedDataset {
  words: ParseResult[];
}

let indexPromise: Promise<Map<string, ParseResult>> | null = null;

function isParseResult(value: unknown): value is ParseResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<ParseResult>;
  return typeof result.word === "string"
    && (result.article === null || result.article === "der" || result.article === "die" || result.article === "das")
    && (result.partOfSpeech === null || typeof result.partOfSpeech === "string")
    && Array.isArray(result.meanings)
    && result.meanings.every((meaning) => typeof meaning === "string")
    && Array.isArray(result.examples)
    && Array.isArray(result.morphemes)
    && typeof result.sourceUrl === "string";
}

function isDataset(value: unknown): value is PreParsedDataset {
  if (typeof value !== "object" || value === null || !("words" in value)) return false;
  const words = (value as { words?: unknown }).words;
  return Array.isArray(words) && words.every(isParseResult);
}

async function buildIndex() {
  const index = new Map<string, ParseResult>();
  try {
    const filePath = path.join(process.cwd(), "public", "data", "pre-parsed-words.json");
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error("사전 파싱 캐시 형식이 올바르지 않습니다.");
    for (const result of parsed.words) index.set(result.word.normalize("NFC"), result);
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }
  return index;
}

export async function getPreParsedWord(input: string) {
  indexPromise ??= buildIndex();
  const index = await indexPromise;
  const normalized = input.trim().normalize("NFC");
  for (const candidate of getGermanCaseCandidates(normalized)) {
    const result = index.get(candidate);
    if (result) return result;
  }
  return null;
}
