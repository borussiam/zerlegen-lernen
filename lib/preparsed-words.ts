import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { headwordKeyFor, mergeParseResults } from "./dictionary-entry";
import { getGermanCaseCandidates } from "./german-word";
import { getRuntimeVocabularyStore, isStoredParseResult } from "./runtime-vocabulary-store";
import type { CefrLevel, ParseResult, VocabularyIndexEntry } from "./types";
import { inferDifficultyLevel, isAffixWord } from "./vocabulary";

interface PreParsedDataset {
  words: ParseResult[];
}

interface LoadedVocabulary {
  index: Map<string, ParseResult>;
  vocabulary: Map<string, VocabularyIndexEntry>;
  headwords: Map<string, ParseResult[]>;
  baseKeys: Set<string>;
  runtimeKeys: Set<string>;
}

let vocabularyPromise: Promise<LoadedVocabulary> | null = null;
let persistenceQueue = Promise.resolve();
const RUNTIME_DATA_PATH = path.join(process.cwd(), "data", "runtime-vocabulary.json");
const RUNTIME_TEMP_PATH = `${RUNTIME_DATA_PATH}.tmp`;

function isDataset(value: unknown): value is PreParsedDataset {
  if (typeof value !== "object" || value === null || !("words" in value)) return false;
  const words = (value as { words?: unknown }).words;
  return Array.isArray(words) && words.every(isStoredParseResult);
}

async function loadVocabulary(): Promise<LoadedVocabulary> {
  const index = new Map<string, ParseResult>();
  const vocabulary = new Map<string, VocabularyIndexEntry>();
  const headwords = new Map<string, ParseResult[]>();
  const baseKeys = new Set<string>();
  const runtimeKeys = new Set<string>();

  function addResult(sourceResult: ParseResult, source: "base" | "runtime") {
    const level = isAffixWord(sourceResult.word, sourceResult.partOfSpeech)
      ? null
      : sourceResult.level ?? null;
    const result = sourceResult.level === level ? sourceResult : { ...sourceResult, level };
    const key = result.word.normalize("NFC");
    const headwordKey = headwordKeyFor(result.word);
    index.set(key, result);
    headwords.set(headwordKey, [...(headwords.get(headwordKey) ?? []), result]);
    if (source === "base") baseKeys.add(key);
    else runtimeKeys.add(key);
    vocabulary.set(headwordKey, vocabularyEntry(mergeParseResults(headwords.get(headwordKey) ?? [result])));
  }

  try {
    const filePath = path.join(process.cwd(), "public", "data", "pre-parsed-words.json");
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error("사전 파싱 캐시 형식이 올바르지 않습니다.");
    parsed.words.forEach((result) => addResult(result, "base"));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }

  try {
    const parsed = JSON.parse(await readFile(RUNTIME_DATA_PATH, "utf8")) as unknown;
    if (!isDataset(parsed)) throw new Error("런타임 단어 데이터 형식이 올바르지 않습니다.");
    parsed.words.forEach((result) => addResult(result, "runtime"));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }
  return { index, vocabulary, headwords, baseKeys, runtimeKeys };
}

function findResultsWithKeys(index: Map<string, ParseResult>, input: string) {
  const normalized = input.trim().normalize("NFC");
  const matches: Array<{ key: string; result: ParseResult }> = [];
  for (const candidate of getGermanCaseCandidates(normalized)) {
    const result = index.get(candidate);
    if (result) matches.push({ key: candidate, result });
  }
  return matches;
}

function findResult(index: Map<string, ParseResult>, input: string) {
  return findResultsWithKeys(index, input)[0]?.result ?? null;
}

function vocabularyEntry(result: ParseResult): VocabularyIndexEntry {
  return {
    word: result.word,
    article: result.article,
    partOfSpeech: result.partOfSpeech,
    level: result.level ?? null,
    meaning: result.meanings[0] ?? "",
    articleReason: result.articleReason,
    headwordKey: result.headwordKey,
    displayHeadword: result.displayHeadword,
    variants: result.variants,
    decompositionOptions: result.decompositionOptions,
  };
}

async function persistRuntimeWords(words: ParseResult[]) {
  try {
    await mkdir(path.dirname(RUNTIME_DATA_PATH), { recursive: true });
    await writeFile(RUNTIME_TEMP_PATH, `${JSON.stringify({ words }, null, 2)}\n`, "utf8");
    await rename(RUNTIME_TEMP_PATH, RUNTIME_DATA_PATH);
    return true;
  } catch (error) {
    const readOnly = error instanceof Error && "code" in error
      && (error.code === "EROFS" || error.code === "EACCES" || error.code === "EPERM");
    if (!readOnly) throw error;
    // Serverless filesystems can be read-only; the process-local registry still works.
    return false;
  }
}

function addRuntimeResult(loaded: LoadedVocabulary, result: ParseResult) {
  const key = result.word.normalize("NFC");
  if (loaded.baseKeys.has(key)) return;
  loaded.index.set(key, result);
  const headwordKey = headwordKeyFor(result.word);
  loaded.headwords.set(headwordKey, [...(loaded.headwords.get(headwordKey) ?? []), result]);
  loaded.vocabulary.set(headwordKey, vocabularyEntry(mergeParseResults(loaded.headwords.get(headwordKey) ?? [result])));
  loaded.runtimeKeys.add(key);
}

export async function getStoredWord(input: string) {
  vocabularyPromise ??= loadVocabulary();
  const loaded = await vocabularyPromise;
  const store = getRuntimeVocabularyStore();
  if (store) {
    try {
      const result = await store.find(input);
      if (result) {
        addRuntimeResult(loaded, result);
        return { result: mergeParseResults([result]), source: "database" as const };
      }
    } catch (error) {
      console.warn("Neon에서 런타임 단어를 조회하지 못했습니다.", error);
    }
  }

  const local = findResultsWithKeys(loaded.index, input);
  if (local.length) {
    return {
      result: mergeParseResults(local.map((item) => item.result)),
      source: local.some((item) => loaded.baseKeys.has(item.key)) ? "pre-parsed" as const : "database" as const,
    };
  }
  return null;
}

export async function getVocabularyIndex() {
  vocabularyPromise ??= loadVocabulary();
  const loaded = await vocabularyPromise;
  const store = getRuntimeVocabularyStore();
  if (store) {
    try {
      const runtimeWords = await store.list();
      if (runtimeWords.length) {
        return runtimeWords
          .map((result) => vocabularyEntry(mergeParseResults([result])))
          .sort((left, right) => left.word.localeCompare(right.word, "de"));
      }
    } catch (error) {
      console.warn("Neon 런타임 단어 목록을 불러오지 못했습니다.", error);
    }
  }
  return Array.from(loaded.vocabulary.values());
}

export async function registerParsedWord(parsed: ParseResult) {
  vocabularyPromise ??= loadVocabulary();
  const loaded = await vocabularyPromise;
  const existing = findResult(loaded.index, parsed.word);
  if (existing) return { result: mergeParseResults(loaded.headwords.get(headwordKeyFor(existing.word)) ?? [existing]), stored: true };

  const knownComponentLevels = parsed.morphemes.flatMap((part): CefrLevel[] => {
    const component = findResult(loaded.index, part.lookup);
    return component?.level ? [component.level] : [];
  });
  const result: ParseResult = {
    ...parsed,
    level: inferDifficultyLevel(parsed, knownComponentLevels),
  };
  addRuntimeResult(loaded, result);
  const mergedResult = mergeParseResults(loaded.headwords.get(headwordKeyFor(result.word)) ?? [result]);

  const store = getRuntimeVocabularyStore();
  if (store) {
    try {
      await store.upsert(result);
      return { result: mergedResult, stored: true };
    } catch (error) {
      console.warn("Neon에 런타임 단어를 저장하지 못했습니다.", error);
      return { result: mergedResult, stored: false };
    }
  }

  let stored = true;
  persistenceQueue = persistenceQueue.then(async () => {
    const runtimeWords = Array.from(loaded.runtimeKeys).flatMap((runtimeKey): ParseResult[] => {
      const word = loaded.index.get(runtimeKey);
      return word ? [word] : [];
    });
    stored = await persistRuntimeWords(runtimeWords);
  }).catch((error: unknown) => {
    stored = false;
    console.warn("런타임 단어 데이터를 파일에 저장하지 못했습니다.", error);
  });
  await persistenceQueue;
  return { result: mergedResult, stored };
}
