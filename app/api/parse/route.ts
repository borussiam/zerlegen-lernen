import { NextRequest, NextResponse } from "next/server";
import { addLearnerInflectionFromWiktionary } from "@/lib/learner-inflections";
import { rankInflectionCandidates } from "@/lib/inflection-lookup";
import { getStoredWord, registerParsedWord } from "@/lib/preparsed-words";
import { getRuntimeVocabularyStore } from "@/lib/runtime-vocabulary-store";
import type { ParseResult } from "@/lib/types";
import { parseGermanWordWithInflections } from "@/lib/wiktionary";
import { ingestGermanWiktionaryEntry } from "@/lib/wiktionary-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;

function shouldHydrateInflection(result: ParseResult) {
  if (result.learnerInflection) return false;
  const normalizedPos = result.partOfSpeech?.toLocaleLowerCase("en-US") ?? "";
  return normalizedPos.includes("verb") || normalizedPos.includes("adjective");
}

async function hydrateLearnerInflection(result: ParseResult) {
  if (!shouldHydrateInflection(result)) return result;
  try {
    const parsed = await parseGermanWordWithInflections(result.word);
    const hydrated = addLearnerInflectionFromWiktionary(result, parsed.inflections);
    const store = getRuntimeVocabularyStore();
    if (store && parsed.inflections.length) {
      await store.upsertLemma(hydrated, parsed.inflections).catch((error: unknown) => {
        console.warn("Neon에 굴절형을 저장하지 못했습니다.", error);
      });
    }
    return hydrated;
  } catch (error) {
    console.warn("Wiktionary 변화표를 불러오지 못했습니다.", error);
    return result;
  }
}

export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get("word")?.trim() ?? "";

  if (!word || word.length > 80 || !/^[\p{L}ÄÖÜäöüßẞ\- ]+$/u.test(word)) {
    return NextResponse.json({ error: "올바른 독일어 단어를 입력해 주세요." }, { status: 400 });
  }

  try {
    const store = getRuntimeVocabularyStore();
    if (store) {
      const existingCandidates = rankInflectionCandidates([
        ...await store.lookupInflections(word, { exactOnly: true }),
        ...await store.lookupLemmas(word),
      ], { surfaceForm: word });
      if (existingCandidates[0]?.dictionaryEntry) {
        return NextResponse.json({
          ...existingCandidates[0].dictionaryEntry,
          lookupSurfaceForm: word,
          lookupMorphology: existingCandidates[0].morphology,
        }, {
          headers: {
            "Cache-Control": "no-store",
            "X-Zerlegen-Cache": "database-surface",
          },
        });
      }

      const ingested = await ingestGermanWiktionaryEntry(word, store);
      const surface = ingested.requestedSurfaceForms[0]
        ?? ingested.surfaceForms.find((item) => item.surfaceForm === word);
      return NextResponse.json({
        ...ingested.result,
        lookupSurfaceForm: word,
        lookupMorphology: surface?.morphology ?? null,
      }, {
        headers: {
          "Cache-Control": "no-store",
          "X-Zerlegen-Cache": "wiktionary-database",
        },
      });
    }

    const stored = await getStoredWord(word);
    const registered = stored ? null : await parseGermanWordWithInflections(word).then(async (parsed) => {
      const result = addLearnerInflectionFromWiktionary(parsed.result, parsed.inflections);
      const registeredWord = await registerParsedWord(result);
      return registeredWord;
    });
    const result = await hydrateLearnerInflection(stored?.result ?? registered!.result);
    const cacheSource = stored?.source ?? (registered!.stored ? "wiktionary-stored" : "wiktionary-unstored");
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Zerlegen-Cache": cacheSource,
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
