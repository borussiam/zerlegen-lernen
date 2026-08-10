import { NextRequest, NextResponse } from "next/server";
import { parseGermanWord } from "@/lib/wiktionary";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get("word")?.trim() ?? "";

  if (!word || word.length > 80 || !/^[\p{L}ÄÖÜäöüßẞ\- ]+$/u.test(word)) {
    return NextResponse.json({ error: "올바른 독일어 단어를 입력해 주세요." }, { status: 400 });
  }

  try {
    return NextResponse.json(await parseGermanWord(word), {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "단어를 분석하지 못했습니다.";
    const rateLimited = message.includes("요청이 많아") || message.includes("429");
    return NextResponse.json(
      { error: message },
      {
        status: rateLimited ? 503 : 502,
        headers: {
          "Cache-Control": "no-store",
          ...(rateLimited ? { "Retry-After": "5" } : {}),
        },
      },
    );
  }
}
