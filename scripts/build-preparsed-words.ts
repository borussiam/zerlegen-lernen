import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseGermanWord } from "../lib/wiktionary";
import type { ParseResult } from "../lib/types";

const TARGET_COUNT = 2_500;
const REQUEST_DELAY_MS = 1_500;
const CHECKPOINT_INTERVAL = 10;
const SOURCE_REVISION = "efd235e692efd47eda026d0a1cbd703ce23d7692";
const CANDIDATE_SOURCE_URL = `https://raw.githubusercontent.com/vbvss199/Language-Learning-decks/${SOURCE_REVISION}/german/german.json`;
const OUTPUT_PATH = path.resolve("public/data/pre-parsed-words.json");
const ERROR_LOG_PATH = path.resolve("logs/pre-parsed-words-errors.jsonl");
const CHECKPOINT_PATH = path.resolve(".cache/pre-parsed-words.checkpoint.json");
const TEMP_OUTPUT_PATH = `${OUTPUT_PATH}.tmp`;

type CefrLevel = "A1" | "A2" | "B1" | "B2";

interface SourceWord {
  word?: unknown;
  pos?: unknown;
  cefr_level?: unknown;
  useful_for_flashcard?: unknown;
  word_frequency?: unknown;
}

interface CandidateWord {
  word: string;
  level: CefrLevel | null;
  quotaLevel: CefrLevel;
  sourceRank: number | null;
}

interface PreParsedWord extends ParseResult {
  level: CefrLevel | null;
  sourceRank: number | null;
}

interface BuildCheckpoint {
  nextCandidateIndex: number;
  words: PreParsedWord[];
  levelCounts: Record<CefrLevel, number>;
  attempted: number;
  failed: number;
}

interface BuildOutput {
  meta: {
    generatedAt: string;
    count: number;
    levels: Record<CefrLevel, number> & { unclassified: number };
    requestDelayMs: number;
    dictionary: string;
    candidateSource: string;
    candidateSourceRevision: string;
    license: string;
  };
  words: PreParsedWord[];
}

const LEVEL_QUOTAS: Record<CefrLevel, number> = {
  A1: 400,
  A2: 600,
  B1: 750,
  B2: 750,
};

const AFFIX_CANDIDATES: CandidateWord[] = [
  "ab-", "an-", "auf-", "aus-", "be-", "bei-", "ein-", "ent-", "er-", "fort-",
  "ge-", "her-", "hin-", "los-", "miss-", "mit-", "nach-", "nieder-", "un-", "ur-",
  "ver-", "vor-", "weg-", "weiter-", "zer-", "zu-", "zurück-", "zusammen-",
].map((word) => ({ word, level: null, quotaLevel: "B1" as const, sourceRank: null }));

AFFIX_CANDIDATES.push(...[
  "-bar", "-chen", "-ei", "-er", "-haft", "-heit", "-ig", "-in", "-ion", "-isch",
  "-ismus", "-ist", "-ität", "-keit", "-lein", "-lich", "-ling", "-los", "-ment",
  "-nis", "-sam", "-schaft", "-tum", "-ung", "-weise",
].map((word) => ({ word, level: null, quotaLevel: "B2" as const, sourceRank: null })));

const ALLOWED_SOURCE_PARTS = new Set(["noun", "verb", "adjective", "prefix", "suffix", "affix"]);
const ALLOWED_PARSED_PARTS = /^(?:Noun|Verb|Adjective|Prefix|Suffix|Affix)$/i;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function emptyLevelCounts(): Record<CefrLevel, number> {
  return { A1: 0, A2: 0, B1: 0, B2: 0 };
}

function isCefrLevel(value: unknown): value is CefrLevel {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2";
}

function sourceWords(value: unknown): SourceWord[] {
  if (!Array.isArray(value)) throw new Error("후보 단어 데이터 형식이 배열이 아닙니다.");
  return value.filter((item): item is SourceWord => typeof item === "object" && item !== null);
}

async function fetchCandidates() {
  const response = await fetch(CANDIDATE_SOURCE_URL, {
    headers: {
      "User-Agent": "ZerlegenLernen-DataBuilder/1.0 (https://github.com/borussiam/zerlegen-lernen)",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`후보 단어 목록 요청 실패: ${response.status}`);

  const source = sourceWords(await response.json() as unknown);
  const byLevel = new Map<CefrLevel, CandidateWord[]>();
  for (const level of Object.keys(LEVEL_QUOTAS) as CefrLevel[]) byLevel.set(level, []);

  for (const item of source) {
    if (
      typeof item.word !== "string"
      || typeof item.pos !== "string"
      || !isCefrLevel(item.cefr_level)
      || item.useful_for_flashcard !== true
      || !ALLOWED_SOURCE_PARTS.has(item.pos)
      || !/^[\p{L}-]+$/u.test(item.word)
    ) continue;

    byLevel.get(item.cefr_level)?.push({
      word: item.word.normalize("NFC"),
      level: item.cefr_level,
      quotaLevel: item.cefr_level,
      sourceRank: typeof item.word_frequency === "number" ? item.word_frequency : null,
    });
  }

  const seen = new Set<string>();
  const candidates: CandidateWord[] = [];
  for (const level of Object.keys(LEVEL_QUOTAS) as CefrLevel[]) {
    const levelCandidates = [
      ...AFFIX_CANDIDATES.filter((candidate) => candidate.quotaLevel === level),
      ...(byLevel.get(level) ?? []).sort((left, right) => (
        (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER)
      )),
    ];
    for (const candidate of levelCandidates) {
      const key = candidate.word.normalize("NFC");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function isCheckpoint(value: unknown): value is BuildCheckpoint {
  if (typeof value !== "object" || value === null) return false;
  const checkpoint = value as Partial<BuildCheckpoint>;
  return Number.isInteger(checkpoint.nextCandidateIndex)
    && Array.isArray(checkpoint.words)
    && typeof checkpoint.levelCounts === "object"
    && checkpoint.levelCounts !== null
    && Number.isInteger(checkpoint.attempted)
    && Number.isInteger(checkpoint.failed);
}

async function loadCheckpoint(): Promise<BuildCheckpoint> {
  try {
    const parsed = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")) as unknown;
    if (isCheckpoint(parsed)) return parsed;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }

  await writeFile(ERROR_LOG_PATH, "", "utf8");
  return {
    nextCandidateIndex: 0,
    words: [],
    levelCounts: emptyLevelCounts(),
    attempted: 0,
    failed: 0,
  };
}

async function saveCheckpoint(checkpoint: BuildCheckpoint) {
  await writeFile(CHECKPOINT_PATH, `${JSON.stringify(checkpoint)}\n`, "utf8");
}

function validateResult(result: ParseResult) {
  if (!result.partOfSpeech || !ALLOWED_PARSED_PARTS.test(result.partOfSpeech)) {
    throw new Error(`대상 품사가 아닙니다: ${result.partOfSpeech ?? "unknown"}`);
  }
  if (
    !result.meanings.length
    || result.meanings.some((meaning) => meaning.includes("정의를 자동 추출하지 못했습니다"))
  ) {
    throw new Error("Wiktionary 정의를 추출하지 못했습니다.");
  }
  if (!result.examples.length || result.examples.some((example) => !example.sentence.trim())) {
    throw new Error("예문이 없습니다.");
  }
  if (!result.morphemes.length) throw new Error("분해 요소 데이터가 없습니다.");
}

async function recordError(candidate: CandidateWord, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await appendFile(ERROR_LOG_PATH, `${JSON.stringify({
    at: new Date().toISOString(),
    word: candidate.word,
    level: candidate.level,
    message,
  })}\n`, "utf8");
}

async function writeFinalOutput(checkpoint: BuildCheckpoint) {
  const actualLevelCounts = checkpoint.words.reduce<Record<CefrLevel, number> & { unclassified: number }>(
    (counts, word) => {
      if (word.level) counts[word.level] += 1;
      else counts.unclassified += 1;
      return counts;
    },
    { ...emptyLevelCounts(), unclassified: 0 },
  );
  const output: BuildOutput = {
    meta: {
      generatedAt: new Date().toISOString(),
      count: checkpoint.words.length,
      levels: actualLevelCounts,
      requestDelayMs: REQUEST_DELAY_MS,
      dictionary: "English Wiktionary (German entries)",
      candidateSource: CANDIDATE_SOURCE_URL,
      candidateSourceRevision: SOURCE_REVISION,
      license: "CC BY-SA 4.0; see public/data/README.md",
    },
    words: checkpoint.words,
  };
  await writeFile(TEMP_OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await rename(TEMP_OUTPUT_PATH, OUTPUT_PATH);
}

async function main() {
  await Promise.all([
    mkdir(path.dirname(OUTPUT_PATH), { recursive: true }),
    mkdir(path.dirname(ERROR_LOG_PATH), { recursive: true }),
    mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true }),
  ]);

  const candidates = await fetchCandidates();
  const checkpoint = await loadCheckpoint();
  const acceptedWords = new Set(checkpoint.words.map((word) => word.word.normalize("NFC")));
  let nextAttemptAt = Date.now();
  console.log(`후보 ${candidates.length}개, 기존 성공 ${checkpoint.words.length}개부터 시작합니다.`);

  for (let index = checkpoint.nextCandidateIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    checkpoint.nextCandidateIndex = index + 1;
    if (checkpoint.levelCounts[candidate.quotaLevel] >= LEVEL_QUOTAS[candidate.quotaLevel]) continue;

    const waitTime = Math.max(0, nextAttemptAt - Date.now());
    if (waitTime) await delay(waitTime);
    nextAttemptAt = Date.now() + REQUEST_DELAY_MS;
    checkpoint.attempted += 1;
    try {
      const result = await parseGermanWord(candidate.word);
      validateResult(result);
      const resultKey = result.word.normalize("NFC");
      if (acceptedWords.has(resultKey)) throw new Error("이미 저장된 표제어입니다.");

      checkpoint.words.push({ ...result, level: candidate.level, sourceRank: candidate.sourceRank });
      checkpoint.levelCounts[candidate.quotaLevel] += 1;
      acceptedWords.add(resultKey);
    } catch (error) {
      checkpoint.failed += 1;
      await recordError(candidate, error);
    } finally {
      if (checkpoint.attempted % CHECKPOINT_INTERVAL === 0) await saveCheckpoint(checkpoint);
      if (checkpoint.attempted % 25 === 0) {
        console.log(
          `[${checkpoint.words.length}/${TARGET_COUNT}] 시도 ${checkpoint.attempted}, 실패 ${checkpoint.failed}, `
          + `A1 ${checkpoint.levelCounts.A1}, A2 ${checkpoint.levelCounts.A2}, `
          + `B1 ${checkpoint.levelCounts.B1}, B2 ${checkpoint.levelCounts.B2}`,
        );
      }
    }

    if (checkpoint.words.length === TARGET_COUNT) break;
  }

  await saveCheckpoint(checkpoint);
  if (checkpoint.words.length !== TARGET_COUNT) {
    throw new Error(`2,500개를 채우지 못했습니다. 현재 ${checkpoint.words.length}개입니다.`);
  }

  await writeFinalOutput(checkpoint);
  await unlink(CHECKPOINT_PATH);
  console.log(`완료: ${OUTPUT_PATH}에 ${checkpoint.words.length}개를 저장했습니다.`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
