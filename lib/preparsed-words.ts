import { readFile } from "node:fs/promises";
import path from "node:path";
import { getGermanCaseCandidates } from "./german-word";
import type { CefrLevel, ParseResult, VocabularyIndexEntry } from "./types";

interface PreParsedDataset {
  words: ParseResult[];
}

interface LoadedVocabulary {
  index: Map<string, ParseResult>;
  vocabulary: VocabularyIndexEntry[];
}

let vocabularyPromise: Promise<LoadedVocabulary> | null = null;

function isCefrLevel(value: unknown): value is CefrLevel {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2";
}

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
    && typeof result.sourceUrl === "string"
    && (result.level === undefined || result.level === null || isCefrLevel(result.level));
}

function isDataset(value: unknown): value is PreParsedDataset {
  if (typeof value !== "object" || value === null || !("words" in value)) return false;
  const words = (value as { words?: unknown }).words;
  return Array.isArray(words) && words.every(isParseResult);
}

async function loadVocabulary(): Promise<LoadedVocabulary> {
  const index = new Map<string, ParseResult>();
  const vocabulary: VocabularyIndexEntry[] = [];
  try {
    const filePath = path.join(process.cwd(), "public", "data", "pre-parsed-words.json");
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error("사전 파싱 캐시 형식이 올바르지 않습니다.");
    for (const result of parsed.words) {
      index.set(result.word.normalize("NFC"), result);
      vocabulary.push({
        word: result.word,
        article: result.article,
        partOfSpeech: result.partOfSpeech,
        level: result.level ?? null,
        meaning: result.meanings[0] ?? "",
        articleReason: result.articleReason,
      });
    }
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }
  return { index, vocabulary };
}

export async function getPreParsedWord(input: string) {
  vocabularyPromise ??= loadVocabulary();
  const { index } = await vocabularyPromise;
  const normalized = input.trim().normalize("NFC");
  for (const candidate of getGermanCaseCandidates(normalized)) {
    const result = index.get(candidate);
    if (result) return result;
  }
  return null;
}

export async function getVocabularyIndex() {
  vocabularyPromise ??= loadVocabulary();
  return (await vocabularyPromise).vocabulary;
}
