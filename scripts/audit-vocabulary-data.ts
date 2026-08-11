import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PDFParse } from "pdf-parse";
import { parseGermanWord } from "../lib/wiktionary";
import type { CefrLevel, ParseResult, WordExample } from "../lib/types";
import { isAffixWord } from "../lib/vocabulary";

const DATA_PATH = path.resolve("public/data/pre-parsed-words.json");
const TEMP_DATA_PATH = `${DATA_PATH}.tmp`;
const CHECKPOINT_PATH = path.resolve(".cache/vocabulary-audit.checkpoint.json");
const REPORT_PATH = path.resolve("reports/vocabulary-audit.json");
const SOURCE_REVISION = "efd235e692efd47eda026d0a1cbd703ce23d7692";
const CANDIDATE_SOURCE_URL = `https://raw.githubusercontent.com/vbvss199/Language-Learning-decks/${SOURCE_REVISION}/german/german.json`;
const GOETHE_LISTS = {
  A1: "https://www.goethe.de/pro/relaunch/prf/de/A1_SD1_Wortliste_02.pdf",
  A2: "https://www.goethe.de/pro/relaunch/prf/sl/Goethe-Zertifikat_A2_Wortliste.pdf",
} as const;
const WIKTIONARY_DELAY_MS = 1_500;
const ITEM_DELAY_MS = 1_000;
const BATCH_SIZE = 75;
const BATCH_PAUSE_MS = 12_000;
const SAVE_INTERVAL = 10;

loadEnvConfig(process.cwd());

interface StoredWord extends ParseResult {
  sourceRank?: number | null;
}

interface Dataset {
  meta: Record<string, unknown> & {
    count: number;
    levels: Record<string, number>;
  };
  words: StoredWord[];
}

interface SourceWord {
  word?: unknown;
  pos?: unknown;
  cefr_level?: unknown;
  useful_for_flashcard?: unknown;
  word_frequency?: unknown;
}

interface ExpansionCandidate {
  word: string;
  level: "A1" | "A2";
  sourceRank: number | null;
}

interface AuditCheckpoint {
  version: 1;
  expansionCandidates: ExpansionCandidate[] | null;
  expansionNextIndex: number;
  expansionComplete: boolean;
  translationNextIndex: number;
  translationComplete: boolean;
  added: Array<{ word: string; level: "A1" | "A2" }>;
  expansionFailures: Array<{ word: string; level: "A1" | "A2"; error: string }>;
  translationsAdded: number;
  affixExamplesRebuilt: number;
}

const MANUAL_AFFIX_EXAMPLES: Record<string, Array<[string, string]>> = {
  "bei-": [["beibringen", "to teach"], ["beitragen", "to contribute"], ["beilegen", "to enclose"]],
  "fort-": [["fortfahren", "to continue"], ["fortgehen", "to go away"], ["fortsetzen", "to continue"]],
  "hin-": [["hingehen", "to go there"], ["hinlegen", "to put down"], ["hinweisen", "to point out"]],
  "los-": [["losgehen", "to set off"], ["loslassen", "to let go"], ["losfahren", "to depart"]],
  "nieder-": [["niederlegen", "to put down"], ["niederschlagen", "to knock down"], ["niederlassen", "to settle"]],
  "weg-": [["weggehen", "to go away"], ["wegwerfen", "to throw away"], ["wegnehmen", "to take away"]],
  "weiter-": [["weitergehen", "to continue"], ["weiterlesen", "to keep reading"], ["weitergeben", "to pass on"]],
  "-ion": [["Information", "information"], ["Diskussion", "discussion"], ["Situation", "situation"]],
  "-lein": [["Büchlein", "little book"], ["Fräulein", "young lady"], ["Häuslein", "little house"]],
  "-los": [["arbeitslos", "unemployed"], ["kostenlos", "free of charge"], ["endlos", "endless"]],
  "-weise": [["teilweise", "partly"], ["möglicherweise", "possibly"], ["beispielsweise", "for example"]],
};

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalized(word: string) {
  return word.trim().normalize("NFC").toLocaleLowerCase("de-DE");
}

function isLevel(value: unknown): value is CefrLevel {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2";
}

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dataset>;
  return Boolean(candidate.meta) && Array.isArray(candidate.words);
}

function emptyCheckpoint(): AuditCheckpoint {
  return {
    version: 1,
    expansionCandidates: null,
    expansionNextIndex: 0,
    expansionComplete: false,
    translationNextIndex: 0,
    translationComplete: false,
    added: [],
    expansionFailures: [],
    translationsAdded: 0,
    affixExamplesRebuilt: 0,
  };
}

async function loadCheckpoint() {
  try {
    const parsed = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")) as Partial<AuditCheckpoint>;
    if (parsed.version === 1) return { ...emptyCheckpoint(), ...parsed } as AuditCheckpoint;
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
  }
  return emptyCheckpoint();
}

async function saveCheckpoint(checkpoint: AuditCheckpoint) {
  await mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await writeFile(CHECKPOINT_PATH, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function updateMetadata(dataset: Dataset) {
  const levels: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0, unclassified: 0 };
  for (const word of dataset.words) {
    const level = isLevel(word.level) ? word.level : "unclassified";
    levels[level] += 1;
  }
  dataset.meta.count = dataset.words.length;
  dataset.meta.levels = levels;
  dataset.meta.lastVocabularyAuditAt = new Date().toISOString();
  dataset.meta.a1A2Reference = "Goethe-Zertifikat A1 Start Deutsch 1 and Goethe-Zertifikat A2 Wortlisten";
}

async function saveDataset(dataset: Dataset) {
  updateMetadata(dataset);
  await writeFile(TEMP_DATA_PATH, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(TEMP_DATA_PATH, DATA_PATH);
}

function extractGoetheLemmas(text: string) {
  const lemmas = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    let candidate = (rawLine.includes("\t") ? rawLine.split("\t")[0] : rawLine)
      .replace(/\u00ad/g, "")
      .trim()
      .replace(/^(?:der|die|das)\s+/i, "")
      .replace(/^\(sich\)\s+/i, "")
      .replace(/\s+\(sich\)$/i, "")
      .replace(/\s+\((?:Sg\.|Pl\.)\)$/i, "")
      .split(",")[0]
      .trim();
    candidate = candidate.normalize("NFC");
    if (/^[\p{L}-]{2,}$/u.test(candidate) && !candidate.endsWith("-")) {
      lemmas.add(normalized(candidate));
    }
  }
  return lemmas;
}

async function loadGoetheLemmas(level: "A1" | "A2") {
  const parser = new PDFParse({ url: GOETHE_LISTS[level] });
  try {
    return extractGoetheLemmas((await parser.getText()).text);
  } finally {
    await parser.destroy();
  }
}

async function expansionCandidates(dataset: Dataset) {
  const [a1Lemmas, a2Lemmas, sourceResponse] = await Promise.all([
    loadGoetheLemmas("A1"),
    loadGoetheLemmas("A2"),
    fetch(CANDIDATE_SOURCE_URL, {
      headers: { "User-Agent": "ZerlegenLernen-Audit/1.0 (https://github.com/borussiam/zerlegen-lernen)" },
    }),
  ]);
  if (!sourceResponse.ok) throw new Error(`후보 어휘 요청 실패: ${sourceResponse.status}`);
  const source = await sourceResponse.json() as unknown;
  if (!Array.isArray(source)) throw new Error("후보 어휘 데이터 형식이 올바르지 않습니다.");
  const existing = new Set(dataset.words.map((word) => normalized(word.word)));
  const seen = new Set(existing);
  return (source as SourceWord[]).flatMap((item): ExpansionCandidate[] => {
    const level = item.cefr_level;
    if (
      (level !== "A1" && level !== "A2")
      || typeof item.word !== "string"
      || typeof item.pos !== "string"
      || item.useful_for_flashcard !== true
      || !["noun", "verb", "adjective"].includes(item.pos)
      || !/^[\p{L}-]+$/u.test(item.word)
    ) return [];
    const key = normalized(item.word);
    const official = level === "A1" ? a1Lemmas : a2Lemmas;
    if (!official.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{
      word: item.word.normalize("NFC"),
      level,
      sourceRank: typeof item.word_frequency === "number" ? item.word_frequency : null,
    }];
  }).sort((left, right) => left.level.localeCompare(right.level)
    || (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER));
}

function validateParsedWord(word: ParseResult) {
  if (!word.meanings.length) throw new Error("뜻이 없습니다.");
  if (!word.examples.length || word.examples.some((example) => !example.sentence.trim())) {
    throw new Error("예문이 없습니다.");
  }
  if (!word.morphemes.length) throw new Error("분해 데이터가 없습니다.");
}

async function expandVocabulary(dataset: Dataset, checkpoint: AuditCheckpoint) {
  if (checkpoint.expansionComplete) return;
  const candidates = checkpoint.expansionCandidates ?? await expansionCandidates(dataset);
  if (!checkpoint.expansionCandidates) {
    checkpoint.expansionCandidates = candidates;
    await saveCheckpoint(checkpoint);
  }
  console.log(`Goethe A1/A2 교차 검증 결과: 추가 후보 ${candidates.length}개`);
  let nextAttemptAt = Date.now();
  const existing = new Set(dataset.words.map((word) => normalized(word.word)));

  for (let index = checkpoint.expansionNextIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    checkpoint.expansionNextIndex = index + 1;
    const wait = Math.max(0, nextAttemptAt - Date.now());
    if (wait) await delay(wait);
    nextAttemptAt = Date.now() + WIKTIONARY_DELAY_MS;

    try {
      const parsed = await parseGermanWord(candidate.word);
      validateParsedWord(parsed);
      const key = normalized(parsed.word);
      if (existing.has(key)) continue;
      dataset.words.push({ ...parsed, level: candidate.level, sourceRank: candidate.sourceRank });
      existing.add(key);
      checkpoint.added.push({ word: parsed.word, level: candidate.level });
      await saveDataset(dataset);
    } catch (error) {
      checkpoint.expansionFailures.push({
        word: candidate.word,
        level: candidate.level,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await saveCheckpoint(checkpoint);
    if ((index + 1) % 10 === 0) console.log(`확장 진행 ${index + 1}/${candidates.length}, 추가 ${checkpoint.added.length}개`);
  }
  checkpoint.expansionComplete = true;
  await Promise.all([saveDataset(dataset), saveCheckpoint(checkpoint)]);
}

function compactEnglishMeaning(meaning: string) {
  return meaning
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .split(/[.;]/)[0]
    .trim();
}

function affixExamples(affix: StoredWord, words: StoredWord[]): WordExample[] {
  const key = normalized(affix.word);
  const matches = words.filter((word) => !isAffixWord(word.word, word.partOfSpeech)
    && word.morphemes.some((part) => normalized(part.lookup) === key || normalized(part.text) === key));
  const derived = matches.slice(0, 3).map((word): WordExample => ({
    sentence: word.word,
    translation: compactEnglishMeaning(word.meanings[0] ?? word.word),
    source: "wiktionary",
    kind: "word",
  }));
  if (derived.length >= 2) return derived;
  const manual = MANUAL_AFFIX_EXAMPLES[affix.word] ?? [];
  const combined = [...derived];
  for (const [word, translation] of manual) {
    if (!combined.some((example) => normalized(example.sentence) === normalized(word))) {
      combined.push({ sentence: word, translation, source: "generated", kind: "word" });
    }
    if (combined.length === 3) break;
  }
  return combined;
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#\d+|#x[\da-f]+|amp|quot|apos|lt|gt);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const hexadecimal = code[1]?.toLowerCase() === "x";
      const number = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return ({ amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">" } as Record<string, string>)[code.toLowerCase()] ?? entity;
  });
}

async function translateWithGoogle(sentences: string[], apiKey: string) {
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ q: sentences, source: "de", target: "en", format: "text" }),
  });
  const body = await response.json() as {
    data?: { translations?: Array<{ translatedText?: string }> };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Google Cloud Translation 실패 (${response.status}): ${body.error?.message ?? "unknown error"}`);
  const translations = body.data?.translations?.map((translation) => decodeHtmlEntities(translation.translatedText ?? "")) ?? [];
  if (translations.length !== sentences.length || translations.some((translation) => !translation.trim())) {
    throw new Error("Google Cloud Translation 응답 수가 요청과 일치하지 않습니다.");
  }
  return translations;
}

async function auditExamplesAndTranslations(dataset: Dataset, checkpoint: AuditCheckpoint) {
  if (checkpoint.translationComplete) return;
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY가 없습니다. 공식 Google Cloud Translation API 키를 설정한 뒤 다시 실행하세요.");
  }

  for (let index = checkpoint.translationNextIndex; index < dataset.words.length; index += 1) {
    const word = dataset.words[index];
    const startedAt = Date.now();
    if (isAffixWord(word.word, word.partOfSpeech)) {
      const examples = affixExamples(word, dataset.words);
      if (!examples.length) throw new Error(`${word.word}: 예시 단어를 만들 수 없습니다.`);
      word.examples = examples;
      checkpoint.affixExamplesRebuilt += 1;
    } else {
      word.examples = word.examples.map((example) => ({ ...example, kind: "sentence" }));
      const missingIndexes = word.examples.flatMap((example, exampleIndex): number[] => (
        example.translation?.trim() ? [] : [exampleIndex]
      ));
      if (missingIndexes.length) {
        const translations = await translateWithGoogle(
          missingIndexes.map((exampleIndex) => word.examples[exampleIndex].sentence),
          apiKey,
        );
        missingIndexes.forEach((exampleIndex, translationIndex) => {
          word.examples[exampleIndex].translation = translations[translationIndex];
        });
        checkpoint.translationsAdded += translations.length;
      }
    }

    checkpoint.translationNextIndex = index + 1;
    if ((index + 1) % SAVE_INTERVAL === 0) {
      await Promise.all([saveDataset(dataset), saveCheckpoint(checkpoint)]);
    }
    const remainingDelay = ITEM_DELAY_MS - (Date.now() - startedAt);
    if (remainingDelay > 0) await delay(remainingDelay);
    if ((index + 1) % BATCH_SIZE === 0 && index + 1 < dataset.words.length) {
      await Promise.all([saveDataset(dataset), saveCheckpoint(checkpoint)]);
      console.log(`번역 감사 ${index + 1}/${dataset.words.length}, ${BATCH_PAUSE_MS / 1_000}초 배치 휴식`);
      await delay(BATCH_PAUSE_MS);
    }
  }
  checkpoint.translationComplete = true;
  await Promise.all([saveDataset(dataset), saveCheckpoint(checkpoint)]);
}

async function writeReport(dataset: Dataset, checkpoint: AuditCheckpoint) {
  const missingExamples = dataset.words.filter((word) => !word.examples.length).map((word) => word.word);
  const missingTranslations = dataset.words.flatMap((word) => word.examples.some((example) => !example.translation?.trim()) ? [word.word] : []);
  const invalidAffixes = dataset.words.filter((word) => isAffixWord(word.word, word.partOfSpeech)
    && word.examples.some((example) => example.kind !== "word")).map((word) => word.word);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: dataset.words.length,
    checkpoint,
    missingExamples,
    missingTranslations,
    invalidAffixes,
    sources: { goethe: GOETHE_LISTS, candidates: CANDIDATE_SOURCE_URL },
  }, null, 2)}\n`, "utf8");
}

async function main() {
  const parsed = JSON.parse(await readFile(DATA_PATH, "utf8")) as unknown;
  if (!isDataset(parsed)) throw new Error("단어 데이터 형식이 올바르지 않습니다.");
  const checkpoint = await loadCheckpoint();
  await expandVocabulary(parsed, checkpoint);
  const skipTranslations = process.argv.includes("--skip-translations");
  if (!skipTranslations) await auditExamplesAndTranslations(parsed, checkpoint);
  await writeReport(parsed, checkpoint);
  console.log(`감사 완료: ${parsed.words.length}개, 신규 ${checkpoint.added.length}개, 번역 ${skipTranslations ? "건너뜀" : `${checkpoint.translationsAdded}개`}`);
}

void main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
