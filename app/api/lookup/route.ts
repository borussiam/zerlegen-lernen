import { NextRequest, NextResponse } from "next/server";
import { candidateFromParseResult, dedupeInflectionCandidates, emptySurfaceLookup, orderedSurfaceLookupTokens } from "@/lib/inflection-lookup";
import { stripGermanToken } from "@/lib/german-tokenizer";
import { getStoredWord } from "@/lib/preparsed-words";
import { getRuntimeVocabularyStore } from "@/lib/runtime-vocabulary-store";
import { ingestGermanWiktionaryEntry } from "@/lib/wiktionary-ingestion";
import type { InflectionCandidate } from "@/lib/types";

export const runtime = "nodejs";

function candidateKey(candidate: Pick<InflectionCandidate, "lemmaId" | "source">) {
  return `${candidate.source}:${candidate.lemmaId}`;
}

function mergeCandidates(candidates: InflectionCandidate[]) {
  const seen = new Set<string>();
  return dedupeInflectionCandidates(candidates).filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

export async function GET(request: NextRequest) {
  const rawSurface = request.nextUrl.searchParams.get("surface")?.trim() ?? "";
  const surface = stripGermanToken(rawSurface);
  const sentence = request.nextUrl.searchParams.get("sentence")?.trim() || undefined;
  const tokenIndexValue = request.nextUrl.searchParams.get("tokenIndex");
  const tokenIndex = tokenIndexValue === null ? undefined : Number(tokenIndexValue);
  const sentenceInitial = tokenIndex === 0;

  if (!surface || surface.length > 80 || !/^[\p{L}ÄÖÜäöüßẞ\-']+$/u.test(surface)) {
    return NextResponse.json({ error: "올바른 독일어 토큰이 아닙니다." }, { status: 400 });
  }
  if (sentence && sentence.length > 500) {
    return NextResponse.json({ error: "예문이 너무 깁니다." }, { status: 400 });
  }
  if (tokenIndex !== undefined && (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 200)) {
    return NextResponse.json({ error: "토큰 위치가 올바르지 않습니다." }, { status: 400 });
  }

  const emptyResult = emptySurfaceLookup(surface);
  const store = getRuntimeVocabularyStore();
  let databaseCandidates: InflectionCandidate[] = [];
  if (store) {
    try {
      for (const lookupToken of orderedSurfaceLookupTokens(surface)) {
        databaseCandidates = await store.lookupInflections(lookupToken.value, {
          exactOnly: lookupToken.exactCase,
          sentenceInitial,
        });
        if (databaseCandidates.length) break;
      }
    } catch (error) {
      console.warn("Neon에서 굴절형 후보를 조회하지 못했습니다.", error);
    }

    if (!databaseCandidates.length) {
      try {
        await ingestGermanWiktionaryEntry(surface, store);
        for (const lookupToken of orderedSurfaceLookupTokens(surface)) {
          databaseCandidates = await store.lookupInflections(lookupToken.value, {
            exactOnly: lookupToken.exactCase,
            sentenceInitial,
          });
          if (databaseCandidates.length) break;
        }
      } catch (error) {
        console.warn("Wiktionary 동적 수집으로 토큰 후보를 만들지 못했습니다.", error);
      }
    }
  }

  let dictionaryCandidates: InflectionCandidate[] = [];
  if (!databaseCandidates.length) {
    try {
      for (const lookupToken of orderedSurfaceLookupTokens(surface)) {
        const stored = await getStoredWord(lookupToken.value);
        if (stored) {
          dictionaryCandidates = [candidateFromParseResult(surface, stored.result)];
          break;
        }
      }
    } catch (error) {
      console.warn("저장 단어에서 토큰 후보를 조회하지 못했습니다.", error);
    }
  }

  return NextResponse.json({
    ...emptyResult,
    candidates: mergeCandidates([...databaseCandidates, ...dictionaryCandidates]),
    relatedCandidates: [],
  }, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}
