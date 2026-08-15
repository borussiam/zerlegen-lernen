import { NextResponse } from "next/server";
import type { GeneratedExercise } from "@/lib/types";

export const runtime = "nodejs";

const levels = new Set(["A1", "A2", "B1", "B2"]);

interface ExerciseWordInput {
  word: string;
  meaning: string;
}

function exerciseWordInput(value: unknown): ExerciseWordInput | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const word = typeof item.word === "string" ? item.word.trim() : "";
  const meaning = typeof item.meaning === "string" ? item.meaning.trim() : "";
  if (!word || word.length > 100 || meaning.length > 500) return null;
  return { word, meaning };
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_AI_ENABLED !== "true") {
    return NextResponse.json({ error: "AI 퀴즈 기능이 비활성화되어 있습니다." }, { status: 503 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 503 });

  let body: { words?: unknown; level?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  if (!Array.isArray(body.words)) {
    return NextResponse.json({ error: "단어 목록 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const parsedWords = body.words.slice(0, 10).map(exerciseWordInput);
  if (parsedWords.some((word) => word === null)) {
    return NextResponse.json({ error: "단어 항목 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const words = parsedWords as ExerciseWordInput[];
  const requestedLevel = typeof body.level === "string" ? body.level : "";
  const level = levels.has(requestedLevel) ? requestedLevel : "A2";
  if (!words.length) return NextResponse.json({ error: "학습 중이거나 복습 예정인 단어를 하나 이상 선택해 주세요." }, { status: 400 });

  const prompt = `독일어 ${level} 학습자를 위한 예문을 만드세요. 단어: ${words.map((item) => item.word).join(", ")}.
반드시 JSON 배열만 반환하세요. 각 항목은 sentence(독일어 완문), translation(한국어 번역), answer(목표 단어), cloze(목표 단어만 _____로 바꾼 문장), level 필드를 가집니다. 단어당 한 문장만 만드세요.`;

  try {
    const response = await fetch(process.env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "당신은 정확하고 간결한 독일어 교사입니다. JSON 객체 {exercises: [...]}만 출력합니다." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) throw new Error(`LLM API 오류 (${response.status})`);
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const exercises = (parsed.exercises ?? parsed) as GeneratedExercise[];
    if (!Array.isArray(exercises)) throw new Error("AI 응답 형식이 올바르지 않습니다.");
    return NextResponse.json({ exercises });
  } catch (error) {
    const message = error instanceof Error ? error.message : "예문 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
