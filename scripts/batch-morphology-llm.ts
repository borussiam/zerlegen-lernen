import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { headwordKeyFor } from "../lib/dictionary-entry";
import { isStoredParseResult, normalizeRuntimeWord } from "../lib/runtime-vocabulary-store";
import type { Morpheme, MorphemeKind, ParseResult } from "../lib/types";

loadEnvConfig(process.cwd());

const DATA_PATH = path.resolve("public/data/pre-parsed-words.json");
const RUNTIME_DATA_PATH = path.resolve("data/runtime-vocabulary.json");
const REPORT_PATH = path.resolve("reports/morphology-llm-suggestions.json");
const OLLAMA_URL = process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434/api/generate";

interface Dataset {
  words: ParseResult[];
}

interface MorphologySuggestion {
  word: string;
  accepted: boolean;
  reason: string;
  morphemes: Morpheme[];
}

function argValue(name: string, fallback: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const MODEL = argValue("model", "llama3.1:8b");
const LIMIT = Number(argValue("limit", "100"));
const WRITE_DB = process.argv.includes("--write-db");
const WRITE_RUNTIME_JSON = process.argv.includes("--write-runtime-json");

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

function targetUrl(lookup: string) {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(lookup)}#German`;
}

function morphemeMeaning(kind: MorphemeKind) {
  if (kind === "prefix") return "LLM이 원문 어원에서 추출한 접두사 후보입니다.";
  if (kind === "suffix") return "LLM이 원문 어원에서 추출한 접미사 후보입니다.";
  if (kind === "compound") return "LLM이 원문 어원에서 추출한 복합어 구성 후보입니다.";
  return "LLM이 원문 어원에서 추출한 어근 후보입니다.";
}

function normalizeMorpheme(raw: unknown): Morpheme | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<Morpheme>;
  if (typeof item.text !== "string" || typeof item.lookup !== "string") return null;
  const kind = item.kind === "prefix" || item.kind === "suffix" || item.kind === "compound" || item.kind === "root"
    ? item.kind
    : item.lookup.startsWith("-")
      ? "suffix"
      : item.lookup.endsWith("-")
        ? "prefix"
        : "root";
  return {
    text: item.text.trim(),
    lookup: item.lookup.trim(),
    targetUrl: typeof item.targetUrl === "string" && item.targetUrl.startsWith("https://en.wiktionary.org/")
      ? item.targetUrl
      : targetUrl(item.lookup.trim()),
    kind,
    meaning: typeof item.meaning === "string" && item.meaning.trim() ? item.meaning.trim() : morphemeMeaning(kind),
  };
}

function validateSuggestion(word: string, value: unknown): MorphologySuggestion {
  if (!value || typeof value !== "object") {
    return { word, accepted: false, reason: "non-object LLM response", morphemes: [] };
  }
  const parsed = value as { accepted?: unknown; reason?: unknown; morphemes?: unknown };
  const morphemes = Array.isArray(parsed.morphemes)
    ? parsed.morphemes.map(normalizeMorpheme).filter((item): item is Morpheme => Boolean(item))
    : [];
  const accepted = parsed.accepted === true && morphemes.length >= 2;
  return {
    word,
    accepted,
    reason: typeof parsed.reason === "string" ? parsed.reason : accepted ? "accepted" : "insufficient morphemes",
    morphemes: accepted ? morphemes : [],
  };
}

async function askOllama(word: ParseResult) {
  const prompt = [
    "Extract German morphological components from the raw Wiktionary etymology.",
    "Return strict JSON only: {\"accepted\":boolean,\"reason\":string,\"morphemes\":[{\"text\":string,\"lookup\":string,\"kind\":\"prefix\"|\"root\"|\"suffix\"|\"compound\"}]}",
    "Rules: use only components justified by the etymology text and visible word shape; ignore unrelated comparison words; affixes must be written with a hyphen, such as -er or un-.",
    `Headword: ${word.word}`,
    `Part of speech: ${word.partOfSpeech ?? "unknown"}`,
    `Current morphemes: ${word.morphemes.map((part) => part.lookup).join(" + ")}`,
    `Raw etymology: ${word.etymology ?? ""}`,
  ].join("\n");

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, format: "json" }),
  });
  if (!response.ok) throw new Error(`Ollama failed for ${word.word}: ${response.status}`);
  const data = await response.json() as { response?: unknown };
  const text = typeof data.response === "string" ? data.response : "{}";
  return validateSuggestion(word.word, JSON.parse(text) as unknown);
}

function needsMorphologyReview(word: ParseResult) {
  if (!word.etymology) return false;
  if (word.morphemes.length >= 2) return false;
  return /\bfrom\b|\bequivalent to\b|\+/i.test(word.etymology);
}

async function writeDbSuggestions(words: ParseResult[], suggestions: MorphologySuggestion[]) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for --write-db.");
  const sql = neon(databaseUrl);
  const byWord = new Map(words.map((word) => [word.word, word]));
  for (const suggestion of suggestions.filter((item) => item.accepted)) {
    const word = byWord.get(suggestion.word);
    if (!word) continue;
    const result = { ...word, morphemes: suggestion.morphemes, etymology: `${word.etymology ?? ""} [LLM morphology: ${suggestion.reason}]`.trim() };
    await sql.query(
      `update runtime_words
       set result = $1::jsonb,
           headword_key = $2,
           updated_at = now()
       where normalized_word = $3`,
      [JSON.stringify(result), headwordKeyFor(result.word), normalizeRuntimeWord(result.word)],
    );
    await sql.query(
      `update lemmas
       set result = $1::jsonb,
           headword_key = $2,
           updated_at = now()
       where headword_key = $2`,
      [JSON.stringify(result), headwordKeyFor(result.word)],
    );
  }
}

async function main() {
  const baseWords = await loadDataset(DATA_PATH);
  const runtimeWords = await loadDataset(RUNTIME_DATA_PATH);
  const words = [...baseWords, ...runtimeWords].filter(needsMorphologyReview).slice(0, Number.isFinite(LIMIT) ? LIMIT : 100);
  const suggestions: MorphologySuggestion[] = [];

  for (const [index, word] of words.entries()) {
    try {
      const suggestion = await askOllama(word);
      suggestions.push(suggestion);
      console.log(`${index + 1}/${words.length} ${word.word}: ${suggestion.accepted ? "accepted" : "skipped"} - ${suggestion.reason}`);
    } catch (error) {
      suggestions.push({ word: word.word, accepted: false, reason: error instanceof Error ? error.message : String(error), morphemes: [] });
    }
  }

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, suggestions }, null, 2)}\n`, "utf8");

  if (WRITE_DB) await writeDbSuggestions([...baseWords, ...runtimeWords], suggestions);
  if (WRITE_RUNTIME_JSON) {
    const accepted = new Map(suggestions.filter((item) => item.accepted).map((item) => [item.word, item]));
    const nextRuntimeWords = runtimeWords.map((word) => {
      const suggestion = accepted.get(word.word);
      return suggestion ? { ...word, morphemes: suggestion.morphemes } : word;
    });
    await writeFile(RUNTIME_DATA_PATH, `${JSON.stringify({ words: nextRuntimeWords }, null, 2)}\n`, "utf8");
  }

  console.log(`Morphology LLM batch complete. Accepted ${suggestions.filter((item) => item.accepted).length}/${suggestions.length}. Report: ${REPORT_PATH}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
