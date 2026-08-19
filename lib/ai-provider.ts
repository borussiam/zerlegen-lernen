import type { GeneratedExercise } from "./types";

export type AiProvider = "ollama" | "openai" | "groq";

export interface ExerciseWordInput {
  word: string;
  meaning: string;
}

export interface GenerateExerciseRequest {
  words: ExerciseWordInput[];
  level: "A1" | "A2" | "B1" | "B2";
  stream?: boolean;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const levels = new Set(["A1", "A2", "B1", "B2"]);

function providerFromEnv(): AiProvider {
  const provider = process.env.AI_PROVIDER?.trim().toLocaleLowerCase("en-US");
  if (provider === "ollama" || provider === "openai" || provider === "groq") return provider;
  return process.env.OLLAMA_BASE_URL ? "ollama" : "openai";
}

function endpointFor(provider: AiProvider) {
  if (provider === "ollama") {
    return `${process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434"}/api/chat`;
  }
  if (provider === "groq") return process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1/chat/completions";
  return process.env.OPENAI_BASE_URL ?? process.env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions";
}

function modelFor(provider: AiProvider) {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (provider === "ollama") return "llama3.1";
  if (provider === "groq") return "llama-3.1-8b-instant";
  return "gpt-4o-mini";
}

function apiKeyFor(provider: AiProvider) {
  if (provider === "ollama") return null;
  if (provider === "groq") return process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  return process.env.OPENAI_API_KEY ?? null;
}

export function validateGenerateExerciseBody(value: unknown): GenerateExerciseRequest | { error: string } {
  if (!value || typeof value !== "object") return { error: "요청 본문이 올바른 JSON 객체가 아닙니다." };
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.words)) return { error: "단어 목록 형식이 올바르지 않습니다." };
  const words = body.words.slice(0, 10).map((item): ExerciseWordInput | null => {
    if (!item || typeof item !== "object") return null;
    const word = typeof (item as Record<string, unknown>).word === "string"
      ? ((item as Record<string, unknown>).word as string).trim()
      : "";
    const meaning = typeof (item as Record<string, unknown>).meaning === "string"
      ? ((item as Record<string, unknown>).meaning as string).trim()
      : "";
    if (!word || word.length > 100 || meaning.length > 500) return null;
    return { word, meaning };
  });
  if (words.some((word) => word === null)) return { error: "단어 항목 형식이 올바르지 않습니다." };
  if (!words.length) return { error: "학습 중이거나 복습 예정인 단어를 하나 이상 선택해 주세요." };
  const requestedLevel = typeof body.level === "string" ? body.level : "";
  const level = levels.has(requestedLevel) ? requestedLevel as GenerateExerciseRequest["level"] : "A2";
  return { words: words as ExerciseWordInput[], level, stream: body.stream === true };
}

function buildMessages(request: GenerateExerciseRequest): ChatMessage[] {
  const prompt = `독일어 ${request.level} 학습자를 위한 예문을 만드세요. 단어: ${request.words.map((item) => item.word).join(", ")}.
반드시 JSON 배열만 반환하세요. 각 항목은 sentence(독일어 완문), translation(한국어 번역), answer(목표 단어), cloze(목표 단어만 _____로 바꾼 문장), level 필드를 가집니다. 단어당 한 문장만 만드세요.`;
  return [
    { role: "system", content: "당신은 정확하고 간결한 독일어 교사입니다. JSON 객체 {exercises: [...]}만 출력합니다." },
    { role: "user", content: prompt },
  ];
}

function requestBody(provider: AiProvider, request: GenerateExerciseRequest, stream: boolean) {
  const messages = buildMessages(request);
  if (provider === "ollama") {
    return {
      model: modelFor(provider),
      messages,
      stream,
      format: "json",
      options: { temperature: 0.6 },
    };
  }
  return {
    model: modelFor(provider),
    messages,
    stream,
    temperature: 0.6,
    response_format: { type: "json_object" },
  };
}

async function requestProvider(request: GenerateExerciseRequest, stream: boolean) {
  const provider = providerFromEnv();
  const apiKey = apiKeyFor(provider);
  if (provider !== "ollama" && !apiKey) {
    throw new Error(provider === "groq" ? "GROQ_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다." : "OPENAI_API_KEY가 설정되지 않았습니다.");
  }
  const response = await fetch(endpointFor(provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(requestBody(provider, request, stream)),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${provider} AI API 오류 (${response.status})${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  return { provider, response };
}

function contentFromProviderJson(provider: AiProvider, data: unknown) {
  if (!data || typeof data !== "object") return "";
  if (provider === "ollama") {
    const message = (data as { message?: { content?: unknown } }).message;
    return typeof message?.content === "string" ? message.content : "";
  }
  const choice = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
  return typeof choice?.message?.content === "string" ? choice.message.content : "";
}

function validateExercises(value: unknown): GeneratedExercise[] {
  const exercises = Array.isArray(value) ? value : (value as { exercises?: unknown } | null)?.exercises;
  if (!Array.isArray(exercises)) throw new Error("AI 응답 형식이 올바르지 않습니다.");
  return exercises.slice(0, 10).map((item) => {
    if (!item || typeof item !== "object") throw new Error("AI 응답 항목 형식이 올바르지 않습니다.");
    const entry = item as Record<string, unknown>;
    const sentence = typeof entry.sentence === "string" ? entry.sentence : "";
    const translation = typeof entry.translation === "string" ? entry.translation : "";
    const answer = typeof entry.answer === "string" ? entry.answer : "";
    const cloze = typeof entry.cloze === "string" ? entry.cloze : "";
    const level = typeof entry.level === "string" ? entry.level : "";
    if (!sentence || !translation || !answer || !cloze || !level) throw new Error("AI 응답 항목이 비어 있습니다.");
    return { sentence, translation, answer, cloze, level };
  });
}

export async function generateExercises(request: GenerateExerciseRequest) {
  const { provider, response } = await requestProvider(request, false);
  const data = await response.json() as unknown;
  const content = contentFromProviderJson(provider, data);
  const parsed = JSON.parse(content || "{}") as unknown;
  return validateExercises(parsed);
}

export async function streamExerciseGeneration(request: GenerateExerciseRequest) {
  const { provider, response } = await requestProvider(request, true);
  if (!response.body) throw new Error(`${provider} AI API가 스트림 본문을 반환하지 않았습니다.`);
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": provider === "ollama" ? "application/x-ndjson; charset=utf-8" : "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-AI-Provider": provider,
    },
  });
}
