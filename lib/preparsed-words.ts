import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getGermanCaseCandidates } from "./german-word";
import type { CefrLevel, ParseResult, VocabularyIndexEntry } from "./types";
import { inferDifficultyLevel, isAffixWord } from "./vocabulary";

interface PreParsedDataset {
  words: ParseResult[];
}

interface LoadedVocabulary {
  index: Map<string, ParseResult>;
  vocabulary: Map<string, VocabularyIndexEntry>;
  runtimeKeys: Set<string>;
}

let vocabularyPromise: Promise<LoadedVocabulary> | null = null;
let persistenceQueue = Promise.resolve();
const RUNTIME_DATA_PATH = path.join(process.cwd(), "data", "runtime-vocabulary.json");
const RUNTIME_TEMP_PATH = `${RUNTIME_DATA_PATH}.tmp`;

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
  const vocabulary = new Map<string, VocabularyIndexEntry>();
  const runtimeKeys = new Set<string>();

  function addResult(sourceResult: ParseResult, runtime = false) {
    const level = isAffixWord(sourceResult.word, sourceResult.partOfSpeech)
      ? null
      : sourceResult.level ?? null;
    const result = sourceResult.level === level ? sourceResult : { ...sourceResult, level };
    const key = result.word.normalize("NFC");
    index.set(key, result);
    if (runtime) runtimeKeys.add(key);
    vocabulary.set(key, {
      word: result.word,
      article: result.article,
      partOfSpeech: result.partOfSpeech,
      level,
      meaning: result.meanings[0] ?? "",
      articleReason: result.articleReason,
    });
  }

  try {
    const filePath = path.join(process.cwd(), "public", "data", "pre-parsed-words.json");
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error("사전 파싱 캐시 형식이 올바르지 않습니다.");
    parsed.words.forEach((result) => addResult(result));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }

  try {
    const parsed = JSON.parse(await readFile(RUNTIME_DATA_PATH, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error("런타임 단어 데이터 형식이 올바르지 않습니다.");
    parsed.words.forEach((result) => addResult(result, true));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }
  return { index, vocabulary, runtimeKeys };
}

function findResult(index: Map<string, ParseResult>, input: string) {
  const normalized = input.trim().normalize("NFC");
  for (const candidate of getGermanCaseCandidates(normalized)) {
    const result = index.get(candidate);
    if (result) return result;
  }
  return null;
}

function vocabularyEntry(result: ParseResult): VocabularyIndexEntry {
  return {
    word: result.word,
    article: result.article,
    partOfSpeech: result.partOfSpeech,
    level: result.level ?? null,
    meaning: result.meanings[0] ?? "",
    articleReason: result.articleReason,
  };
}

async function persistRuntimeWords(words: ParseResult[]) {
  try {
    await mkdir(path.dirname(RUNTIME_DATA_PATH), { recursive: true });
    await writeFile(RUNTIME_TEMP_PATH, `${JSON.stringify({ words }, null, 2)}\n`, "utf8");
    await rename(RUNTIME_TEMP_PATH, RUNTIME_DATA_PATH);
  } catch (error) {
    const readOnly = error instanceof Error && "code" in error
      && (error.code === "EROFS" || error.code === "EACCES" || error.code === "EPERM");
    if (!readOnly) throw error;
    // Serverless filesystems can be read-only; the process-local registry still works.
  }
}

export async function getPreParsedWord(input: string) {
  vocabularyPromise ??= loadVocabulary();
  const { index } = await vocabularyPromise;
  return findResult(index, input);
}

export async function getVocabularyIndex() {
  vocabularyPromise ??= loadVocabulary();
  return Array.from((await vocabularyPromise).vocabulary.values());
}

export async function registerParsedWord(parsed: ParseResult) {
  vocabularyPromise ??= loadVocabulary();
  const loaded = await vocabularyPromise;
  const existing = findResult(loaded.index, parsed.word);
  if (existing) return existing;

  const knownComponentLevels = parsed.morphemes.flatMap((part): CefrLevel[] => {
    const component = findResult(loaded.index, part.lookup);
    return component?.level ? [component.level] : [];
  });
  const result: ParseResult = {
    ...parsed,
    level: inferDifficultyLevel(parsed, knownComponentLevels),
  };
  const key = result.word.normalize("NFC");
  loaded.index.set(key, result);
  loaded.vocabulary.set(key, vocabularyEntry(result));
  loaded.runtimeKeys.add(key);

  persistenceQueue = persistenceQueue.then(() => {
    const runtimeWords = Array.from(loaded.runtimeKeys).flatMap((runtimeKey): ParseResult[] => {
      const word = loaded.index.get(runtimeKey);
      return word ? [word] : [];
    });
    return persistRuntimeWords(runtimeWords);
  }).catch((error: unknown) => {
    console.warn("런타임 단어 데이터를 파일에 저장하지 못했습니다.", error);
  });
  await persistenceQueue;
  return result;
}
