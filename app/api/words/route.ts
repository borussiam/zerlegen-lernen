import { NextResponse } from "next/server";
import { getVocabularyIndex } from "@/lib/preparsed-words";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getVocabularyIndex(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
