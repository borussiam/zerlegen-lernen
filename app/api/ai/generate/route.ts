import { NextResponse } from "next/server";
import { generateExercises, streamExerciseGeneration, validateGenerateExerciseBody } from "@/lib/ai-provider";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_AI_ENABLED !== "true") {
    return NextResponse.json({ error: "AI 퀴즈 기능이 비활성화되어 있습니다." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const parsed = validateGenerateExerciseBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    if (parsed.stream) return await streamExerciseGeneration(parsed);
    return NextResponse.json({ exercises: await generateExercises(parsed) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "예문 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
