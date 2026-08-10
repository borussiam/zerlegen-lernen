"use client";

import { FormEvent, useEffect, useState } from "react";
import type { FavoriteWord, GeneratedExercise, ParseResult } from "@/lib/types";

const STORAGE_KEY = "zerlegen-lernen:favorites";
const HISTORY_KEY = "zerlegen-lernen:results";

const articleStyle = {
  der: "bg-blue-100 text-blue-700 border-blue-200",
  die: "bg-rose-100 text-rose-700 border-rose-200",
  das: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function isParseResult(value: unknown): value is ParseResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParseResult>;
  return typeof candidate.word === "string"
    && Array.isArray(candidate.meanings)
    && Array.isArray(candidate.morphemes);
}

function resultsFromHistoryState(state: unknown) {
  if (!state || typeof state !== "object") return null;
  const stored = (state as Record<string, unknown>)[HISTORY_KEY];
  return Array.isArray(stored) && stored.every(isParseResult) ? stored : null;
}

function historyUrl(results: ParseResult[]) {
  const url = new URL(window.location.href);
  url.search = "";
  results.forEach((result) => url.searchParams.append("word", result.word));
  return `${url.pathname}${url.search}${url.hash}`;
}

async function requestWord(word: string) {
  const response = await fetch(`/api/parse?word=${encodeURIComponent(word)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "검색에 실패했습니다.");
  return data as ParseResult;
}

export function WordWorkbench() {
  const [query, setQuery] = useState("Lehrer");
  const [results, setResults] = useState<ParseResult[]>([]);
  const [favorites, setFavorites] = useState<FavoriteWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState("A2");
  const [exercises, setExercises] = useState<GeneratedExercise[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [activeTab, setActiveTab] = useState<"explore" | "favorites">("explore");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) setFavorites(JSON.parse(saved));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    function applyResults(next: ParseResult[]) {
      if (cancelled) return;
      setResults(next);
      setQuery(next.at(-1)?.word ?? "Lehrer");
      setError("");
      setActiveTab("explore");
    }

    async function restore(state: unknown, replaceState = false) {
      const stored = resultsFromHistoryState(state);
      if (stored) {
        applyResults(stored);
        return;
      }

      const words = new URL(window.location.href).searchParams.getAll("word").slice(0, 12);
      if (!words.length) {
        applyResults([]);
        window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: [] }, "", window.location.href);
        return;
      }

      setLoading(true);
      try {
        const restored = await Promise.all(words.map(requestWord));
        applyResults(restored);
        if (replaceState && !cancelled) {
          window.history.replaceState(
            { ...window.history.state, [HISTORY_KEY]: restored },
            "",
            historyUrl(restored),
          );
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "탐색 기록을 복원하지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const handlePopState = (event: PopStateEvent) => {
      void restore(event.state);
    };

    void restore(window.history.state, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  function saveFavorites(next: FavoriteWord[]) {
    setFavorites(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function pushResults(next: ParseResult[]) {
    setResults(next);
    setQuery(next.at(-1)?.word ?? "Lehrer");
    window.history.pushState(
      { ...window.history.state, [HISTORY_KEY]: next },
      "",
      historyUrl(next),
    );
  }

  async function search(word = query, parents: ParseResult[] = []) {
    const cleanWord = word.replace(/^(?:der|die|das)\s+/i, "").trim();
    if (!cleanWord) return;
    setQuery(cleanWord);
    setLoading(true);
    setError("");
    try {
      const data = await requestWord(cleanWord);
      pushResults([...parents, data]);
      setActiveTab("explore");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검색에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void search();
  }

  function toggleFavorite(result: ParseResult) {
    const exists = favorites.some((item) => item.word.toLocaleLowerCase("de-DE") === result.word.toLocaleLowerCase("de-DE"));
    const next = exists
      ? favorites.filter((item) => item.word.toLocaleLowerCase("de-DE") !== result.word.toLocaleLowerCase("de-DE"))
      : [...favorites, {
          word: result.word,
          article: result.article,
          meaning: result.meanings[0],
          decomposition: result.morphemes.map((part) => part.text).join(" + "),
        }];
    saveFavorites(next);
  }

  function selectHistoryStep(index: number) {
    const next = results.slice(0, index + 1);
    pushResults(next);
  }

  function openFavorite(word: string) {
    setActiveTab("explore");
    void search(word);
  }

  async function generateExercises() {
    setQuizLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: favorites, level }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "퀴즈 생성에 실패했습니다.");
      setExercises(data.exercises);
      setShowAnswers(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "퀴즈 생성에 실패했습니다.");
    } finally {
      setQuizLoading(false);
    }
  }

  function isFavorite(result: ParseResult) {
    return favorites.some((item) => item.word.toLocaleLowerCase("de-DE") === result.word.toLocaleLowerCase("de-DE"));
  }

  return (
    <main className="min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <nav className="mx-auto flex max-w-6xl items-center justify-between border-b border-ink/15 pb-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-lg text-paper">ZL</span>
          <div>
            <p className="font-serif text-xl font-bold leading-none">zerlegen lernen</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-ink/50">Deutsch, Stück für Stück</p>
          </div>
        </div>
        <button type="button" onClick={() => setActiveTab("favorites")} className="rounded-full border border-ink/15 bg-white/50 px-4 py-2 text-xs font-bold transition hover:bg-white">★ {favorites.length} Wörter</button>
      </nav>

      <div role="tablist" aria-label="학습 화면" className="mx-auto mt-6 flex max-w-6xl gap-2 rounded-2xl border border-ink/10 bg-white/55 p-1.5">
        <button type="button" role="tab" aria-selected={activeTab === "explore"} onClick={() => setActiveTab("explore")} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${activeTab === "explore" ? "bg-ink text-white" : "text-ink/55 hover:bg-white"}`}>탐색</button>
        <button type="button" role="tab" aria-selected={activeTab === "favorites"} onClick={() => setActiveTab("favorites")} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${activeTab === "favorites" ? "bg-ink text-white" : "text-ink/55 hover:bg-white"}`}>단어장 · {favorites.length}</button>
      </div>

      {error && <div role="alert" className="mx-auto mt-6 max-w-6xl rounded-2xl border border-coral/30 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {activeTab === "explore" && (
        <>
          <section className="mx-auto grid max-w-6xl gap-12 pb-14 pt-14 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
            <div>
              <p className="mb-5 text-xs font-bold uppercase tracking-[0.25em] text-moss">Wortwerkstatt · 단어 작업실</p>
              <h1 className="max-w-3xl font-serif text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">긴 단어도,<br /><span className="text-coral">조각내면</span> 보입니다.</h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">독일어 단어를 형태소 단위로 따라가며 연결 관계를 살펴보세요. 각 조각을 누르면 기존 결과 아래에 다음 탐색 단계가 쌓입니다.</p>
            </div>
            <form suppressHydrationWarning onSubmit={submit} className="rounded-[2rem] border border-ink/10 bg-white/75 p-3 shadow-card backdrop-blur sm:p-4">
              <label htmlFor="word" className="mb-2 block px-3 pt-2 text-xs font-bold uppercase tracking-widest text-ink/45">Welches Wort?</label>
              <div className="flex gap-2">
                <input suppressHydrationWarning id="word" name="word" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="z. B. Freundlichkeit" autoComplete="off" className="min-w-0 flex-1 rounded-2xl bg-paper px-4 py-4 text-lg outline-none ring-moss/30 transition focus:ring-4" />
                <button type="submit" disabled={loading} className="rounded-2xl bg-ink px-5 font-bold text-white transition hover:bg-moss disabled:opacity-50">{loading ? "…" : "zerlegen →"}</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 px-2 pb-1 text-xs text-ink/50">
                <span>Probieren:</span>
                {["Lehrer", "Freundlich", "Freundlichkeit", "-er"].map((word) => <button type="button" key={word} onClick={() => void search(word)} className="underline decoration-ink/20 underline-offset-4 hover:text-ink">{word}</button>)}
              </div>
            </form>
          </section>

          {!!results.length && (
            <div className="mx-auto max-w-6xl pb-20">
              <nav aria-label="단어 탐색 기록" className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-ink/10 bg-white/65 p-3">
                <span className="px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40">탐색 경로</span>
                {results.map((result, index) => (
                  <div key={`${result.word}-${index}`} className="flex items-center gap-2">
                    {index > 0 && <span aria-hidden className="text-ink/25">›</span>}
                    <button type="button" onClick={() => selectHistoryStep(index)} aria-current={index === results.length - 1 ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${index === results.length - 1 ? "bg-moss text-white" : "bg-paper text-ink/60 hover:text-ink"}`}>{result.word}</button>
                  </div>
                ))}
              </nav>

              <div className="space-y-6">
                {results.map((result, resultIndex) => {
                  const favorite = isFavorite(result);
                  const current = resultIndex === results.length - 1;
                  return (
                    <section key={`${result.word}-${resultIndex}`} className={`rounded-[2rem] border bg-white/90 p-6 shadow-card transition sm:p-9 ${current ? "border-moss/30" : "border-ink/10"}`}>
                      <div className="mb-5 flex items-center justify-between gap-4 border-b border-ink/10 pb-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/40">탐색 단계 {resultIndex + 1}</p>
                        {!current && <span className="text-xs text-ink/35">이전 결과</span>}
                      </div>
                      <div className="flex flex-wrap items-start justify-between gap-5">
                        <div>
                          <div className="flex items-center gap-3 sm:gap-4">
                            {result.article && <span className={`rounded-2xl border px-4 py-1.5 font-serif text-xl font-bold leading-none shadow-sm sm:text-2xl ${articleStyle[result.article]}`}>{result.article}</span>}
                            <h2 className="font-serif text-4xl font-bold sm:text-5xl">{result.word}</h2>
                          </div>
                          {result.partOfSpeech && <p className="mt-3 text-xs uppercase tracking-widest text-ink/45">{result.partOfSpeech}</p>}
                        </div>
                        <button type="button" onClick={() => toggleFavorite(result)} aria-pressed={favorite} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${favorite ? "border-amber-300 bg-amber-100 text-amber-800" : "border-ink/15 hover:bg-paper"}`}>{favorite ? "★ 저장됨" : "☆ 단어장에 저장"}</button>
                      </div>

                      <div className="mt-8 flex flex-wrap items-center gap-2">
                        {result.morphemes.map((part, index) => (
                          <div key={`${part.text}-${index}`} className="flex items-center gap-2">
                            {index > 0 && <span className="text-2xl text-ink/25">+</span>}
                            <button type="button" onClick={() => void search(part.lookup, results.slice(0, resultIndex + 1))} title={`${part.meaning}\n${part.targetUrl}`} className="group relative rounded-2xl border border-moss/20 bg-moss/5 px-5 py-3 text-xl font-bold text-moss transition hover:-translate-y-1 hover:bg-moss hover:text-white">
                              {part.text}
                              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-3 hidden w-64 -translate-x-1/2 rounded-xl bg-ink p-3 text-left text-xs font-normal leading-5 text-white shadow-xl group-hover:block">{part.meaning}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/45">
                        {result.etymology && <span>분해 근거: {result.etymology}</span>}
                        <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="font-bold underline decoration-moss/30 underline-offset-4">Wiktionary 원문 ↗</a>
                      </div>

                      {result.compoundHint && <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><strong>관사 힌트:</strong> {result.compoundHint}</p>}

                      <div className="mt-7 border-t border-ink/10 pt-7">
                        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-coral">Bedeutung · 뜻</h3>
                        <ol className="space-y-2 text-sm leading-6 text-ink/75">{result.meanings.map((meaning, index) => <li key={`${meaning}-${index}`}><span className="mr-2 text-ink/35">{index + 1}.</span>{meaning}</li>)}</ol>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "favorites" && (
        <section className="mx-auto grid max-w-6xl gap-6 pb-20 pt-10 lg:grid-cols-[1.15fr_.85fr]">
          <div className="overflow-hidden rounded-[2rem] border border-ink/10 bg-white/85 shadow-card">
            <div className="border-b border-ink/10 p-7 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-moss">Meine Wörter · 단어장</p>
              <h2 className="mt-3 font-serif text-3xl">저장한 단어를 한눈에.</h2>
            </div>
            {favorites.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                  <thead className="bg-paper text-[10px] uppercase tracking-[0.18em] text-ink/45">
                    <tr><th className="px-6 py-3">관사</th><th className="px-4 py-3">단어</th><th className="px-4 py-3">뜻</th><th className="px-4 py-3">분해</th><th className="px-6 py-3 text-right">탐색</th></tr>
                  </thead>
                  <tbody>
                    {favorites.map((item) => (
                      <tr key={item.word} className="border-t border-ink/10 align-top">
                        <td className="px-6 py-4 font-serif text-lg font-bold">{item.article ?? "—"}</td>
                        <td className="px-4 py-4 font-serif text-lg font-bold">{item.word}</td>
                        <td className="max-w-xs px-4 py-4 leading-6 text-ink/65">{item.meaning}</td>
                        <td className="px-4 py-4 font-medium text-moss">{item.decomposition ?? "—"}</td>
                        <td className="px-6 py-4 text-right"><button type="button" onClick={() => openFavorite(item.word)} className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-bold hover:bg-paper">열기 →</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="grid min-h-52 place-items-center p-8 text-center text-sm leading-6 text-ink/45">탐색 결과에서 별표를 눌러<br />학습할 단어를 저장해 보세요.</div>}
          </div>

          <div className="rounded-[2rem] bg-ink p-7 text-white shadow-card sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Lückentest · 빈칸 퀴즈</p>
              {!!exercises.length && <button type="button" onClick={() => setShowAnswers((value) => !value)} className="text-xs font-bold underline underline-offset-4">{showAnswers ? "정답 숨기기" : "정답 보기"}</button>}
            </div>
            <div className="mt-5 flex gap-2">
              <select suppressHydrationWarning id="level" name="level" aria-label="퀴즈 난이도" value={level} onChange={(event) => setLevel(event.target.value)} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none">{["A1", "A2", "B1", "B2"].map((item) => <option className="text-ink" key={item} value={item}>{item}</option>)}</select>
              <button type="button" disabled={!favorites.length || quizLoading} onClick={() => void generateExercises()} className="flex-1 rounded-xl bg-coral px-4 py-2 text-sm font-bold hover:bg-[#c95e52] disabled:opacity-40">{quizLoading ? "문장 만드는 중…" : "AI 퀴즈 만들기"}</button>
            </div>
            {exercises.length ? <ol className="mt-6 space-y-5">{exercises.map((item, index) => (
              <li key={`${item.answer}-${index}`} className="border-b border-white/10 pb-5 last:border-0">
                <p className="font-serif text-lg font-semibold">{index + 1}. {showAnswers ? item.sentence : item.cloze}</p>
                <p className="mt-1 text-sm text-white/50">{item.translation}</p>
                {showAnswers && <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{item.answer}</span>}
              </li>
            ))}</ol> : <div className="grid min-h-48 place-items-center text-center"><p className="max-w-sm text-sm leading-6 text-white/45">저장한 단어와 난이도로<br />맞춤 예문을 만들 수 있습니다.</p></div>}
          </div>
        </section>
      )}
    </main>
  );
}
