import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { parseGermanWord } from "../lib/wiktionary";
import type { ParseResult } from "../lib/types";

const DATA_PATH = path.resolve("public/data/pre-parsed-words.json");
const TEMP_DATA_PATH = `${DATA_PATH}.tmp`;
const CHECKPOINT_PATH = path.resolve(".cache/b1-vocabulary-expansion.checkpoint.json");
const REPORT_PATH = path.resolve("reports/b1-vocabulary-audit.json");
const SOURCE_REVISION = "efd235e692efd47eda026d0a1cbd703ce23d7692";
const CANDIDATE_SOURCE_URL = `https://raw.githubusercontent.com/vbvss199/Language-Learning-decks/${SOURCE_REVISION}/german/german.json`;
const GOETHE_B1_URL = "https://www.goethe.de/pro/relaunch/prf/sl/Goethe-Zertifikat_B1_Wortliste.pdf";
const REQUEST_DELAY_MS = 1_500;

interface StoredWord extends ParseResult {
  sourceRank?: number | null;
}

interface Dataset {
  meta: Record<string, unknown> & { count: number; levels: Record<string, number> };
  words: StoredWord[];
}

interface SourceWord {
  word?: unknown;
  pos?: unknown;
  cefr_level?: unknown;
  useful_for_flashcard?: unknown;
  word_frequency?: unknown;
}

interface Candidate {
  word: string;
  sourceRank: number | null;
}

interface Checkpoint {
  candidates: Candidate[] | null;
  nextIndex: number;
  added: string[];
  failures: Array<{ word: string; error: string }>;
  complete: boolean;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalized(word: string) {
  return word.trim().normalize("NFC").toLocaleLowerCase("de-DE");
}

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dataset>;
  return Boolean(candidate.meta) && Array.isArray(candidate.words);
}

function emptyCheckpoint(): Checkpoint {
  return { candidates: null, nextIndex: 0, added: [], failures: [], complete: false };
}

async function loadCheckpoint() {
  try {
    const checkpoint = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")) as Partial<Checkpoint>;
    return { ...emptyCheckpoint(), ...checkpoint } as Checkpoint;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
    return emptyCheckpoint();
  }
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  await mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await writeFile(CHECKPOINT_PATH, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function updateMetadata(dataset: Dataset) {
  const levels: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0, unclassified: 0 };
  for (const word of dataset.words) levels[word.level ?? "unclassified"] += 1;
  dataset.meta.count = dataset.words.length;
  dataset.meta.levels = levels;
  dataset.meta.lastVocabularyAuditAt = new Date().toISOString();
  dataset.meta.b1Reference = "Goethe-Zertifikat B1 Wortliste";
}

async function saveDataset(dataset: Dataset) {
  updateMetadata(dataset);
  await writeFile(TEMP_DATA_PATH, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(TEMP_DATA_PATH, DATA_PATH);
}

function extractLemmas(text: string) {
  const lemmas = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const candidate = (rawLine.includes("\t") ? rawLine.split("\t")[0] : rawLine)
      .replace(/\u00ad/g, "")
      .trim()
      .replace(/^(?:der|die|das)\s+/i, "")
      .replace(/^\(sich\)\s+/i, "")
      .replace(/\s+\(sich\)$/i, "")
      .replace(/\s+\((?:Sg\.|Pl\.)\)$/i, "")
      .split(",")[0]
      .trim()
      .normalize("NFC");
    if (/^[\p{L}-]{2,}$/u.test(candidate) && !candidate.endsWith("-")) lemmas.add(normalized(candidate));
  }
  return lemmas;
}

async function buildCandidates(dataset: Dataset) {
  const parser = new PDFParse({ url: GOETHE_B1_URL });
  let official: Set<string>;
  try {
    official = extractLemmas((await parser.getText()).text);
  } finally {
    await parser.destroy();
  }
  const response = await fetch(CANDIDATE_SOURCE_URL, {
    headers: { "User-Agent": "ZerlegenLernen-B1Audit/1.0 (https://github.com/borussiam/zerlegen-lernen)" },
  });
  if (!response.ok) throw new Error(`후보 어휘 요청 실패: ${response.status}`);
  const source = await response.json() as unknown;
  if (!Array.isArray(source)) throw new Error("후보 어휘 형식이 올바르지 않습니다.");
  const seen = new Set(dataset.words.map((word) => normalized(word.word)));
  return (source as SourceWord[]).flatMap((item): Candidate[] => {
    if (
      item.cefr_level !== "B1"
      || item.useful_for_flashcard !== true
      || typeof item.word !== "string"
      || typeof item.pos !== "string"
      || !["noun", "verb", "adjective"].includes(item.pos)
      || !/^[\p{L}-]+$/u.test(item.word)
    ) return [];
    const key = normalized(item.word);
    if (!official.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{
      word: item.word.normalize("NFC"),
      sourceRank: typeof item.word_frequency === "number" ? item.word_frequency : null,
    }];
  }).sort((left, right) => (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER));
}

function validateParsedWord(word: ParseResult) {
  if (!word.meanings.length) throw new Error("뜻이 없습니다.");
  if (!word.examples.length || word.examples.some((example) => !example.sentence.trim())) throw new Error("예문이 없습니다.");
  if (!word.morphemes.length) throw new Error("분해 데이터가 없습니다.");
}

async function writeReport(dataset: Dataset, checkpoint: Checkpoint) {
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    reference: GOETHE_B1_URL,
    candidateSource: CANDIDATE_SOURCE_URL,
    auditedCandidates: checkpoint.candidates?.length ?? 0,
    added: checkpoint.added,
    failures: checkpoint.failures,
    finalCount: dataset.words.length,
  }, null, 2)}\n`, "utf8");
}

async function main() {
  const rawDataset = JSON.parse(await readFile(DATA_PATH, "utf8")) as unknown;
  if (!isDataset(rawDataset)) throw new Error("단어 데이터 형식이 올바르지 않습니다.");
  const checkpoint = await loadCheckpoint();
  if (!checkpoint.candidates) {
    checkpoint.candidates = await buildCandidates(rawDataset);
    await saveCheckpoint(checkpoint);
  }
  console.log(`B1 추가 후보 ${checkpoint.candidates.length}개, ${checkpoint.nextIndex}번부터 시작합니다.`);
  const existing = new Set(rawDataset.words.map((word) => normalized(word.word)));
  let nextAttemptAt = Date.now();

  for (let index = checkpoint.nextIndex; index < checkpoint.candidates.length; index += 1) {
    const candidate = checkpoint.candidates[index];
    checkpoint.nextIndex = index + 1;
    const wait = Math.max(0, nextAttemptAt - Date.now());
    if (wait) await delay(wait);
    nextAttemptAt = Date.now() + REQUEST_DELAY_MS;
    try {
      const parsed = await parseGermanWord(candidate.word);
      validateParsedWord(parsed);
      const key = normalized(parsed.word);
      if (!existing.has(key)) {
        rawDataset.words.push({ ...parsed, level: "B1", sourceRank: candidate.sourceRank });
        existing.add(key);
        checkpoint.added.push(parsed.word);
        await saveDataset(rawDataset);
      }
    } catch (error) {
      checkpoint.failures.push({ word: candidate.word, error: error instanceof Error ? error.message : String(error) });
    }
    await saveCheckpoint(checkpoint);
    if ((index + 1) % 25 === 0) {
      console.log(`B1 진행 ${index + 1}/${checkpoint.candidates.length}, 추가 ${checkpoint.added.length}, 실패 ${checkpoint.failures.length}`);
    }
  }
  checkpoint.complete = true;
  await Promise.all([saveDataset(rawDataset), saveCheckpoint(checkpoint), writeReport(rawDataset, checkpoint)]);
  console.log(`B1 확장 완료: 추가 ${checkpoint.added.length}, 실패 ${checkpoint.failures.length}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
