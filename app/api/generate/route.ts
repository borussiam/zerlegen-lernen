import { NextResponse } from "next/server";
import type { FavoriteWord, GeneratedExercise } from "@/lib/types";

export const runtime = "nodejs";

const levels = new Set(["A1", "A2", "B1", "B2"]);

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 503 });

  let body: { words?: FavoriteWord[]; level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const words = body.words?.filter((item) => item.word).slice(0, 10) ?? [];
  const level = levels.has(body.level ?? "") ? body.level! : "A2";
  if (!words.length) return NextResponse.json({ error: "즐겨찾기 단어를 하나 이상 선택해 주세요." }, { status: 400 });

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
