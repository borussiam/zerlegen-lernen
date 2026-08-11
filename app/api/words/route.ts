import { NextResponse } from "next/server";
import { getVocabularyIndex } from "@/lib/preparsed-words";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getVocabularyIndex(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
