"use client";

import { FormEvent, useEffect, useState } from "react";
import type { FavoriteWord, GeneratedExercise, ParseResult } from "@/lib/types";

const STORAGE_KEY = "zerlegen-lernen:favorites";

const articleStyle = {
  der: "bg-blue-100 text-blue-700 border-blue-200",
  die: "bg-rose-100 text-rose-700 border-rose-200",
  das: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export function WordWorkbench() {
  const [query, setQuery] = useState("Lehrer");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [favorites, setFavorites] = useState<FavoriteWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState("A2");
  const [exercises, setExercises] = useState<GeneratedExercise[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);

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

  function saveFavorites(next: FavoriteWord[]) {
    setFavorites(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function search(word = query) {
    const cleanWord = word.replace(/^(?:der|die|das)\s+/i, "").trim();
    if (!cleanWord) return;
    setQuery(cleanWord);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/parse?word=${encodeURIComponent(cleanWord)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "검색에 실패했습니다.");
      setResult(data);
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

  function toggleFavorite() {
    if (!result) return;
    const exists = favorites.some((item) => item.word.toLocaleLowerCase("de-DE") === result.word.toLocaleLowerCase("de-DE"));
    const next = exists
      ? favorites.filter((item) => item.word.toLocaleLowerCase("de-DE") !== result.word.toLocaleLowerCase("de-DE"))
      : [...favorites, { word: result.word, article: result.article, meaning: result.meanings[0] }];
    saveFavorites(next);
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

  const isFavorite = !!result && favorites.some((item) => item.word.toLocaleLowerCase("de-DE") === result.word.toLocaleLowerCase("de-DE"));

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
        <span className="rounded-full border border-ink/15 bg-white/50 px-3 py-1.5 text-xs">★ {favorites.length} Wörter</span>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-12 pb-14 pt-16 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
        <div>
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.25em] text-moss">Wortwerkstatt · 단어 작업실</p>
          <h1 className="max-w-3xl font-serif text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
            긴 단어도,<br /><span className="text-coral">조각내면</span> 보입니다.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">
            독일어 단어를 형태소와 어원으로 분해하고 관사의 원리를 발견하세요. 각 조각을 누르면 탐색이 다시 시작됩니다.
          </p>
        </div>
        <form suppressHydrationWarning onSubmit={submit} className="rounded-[2rem] border border-ink/10 bg-white/75 p-3 shadow-card backdrop-blur sm:p-4">
          <label htmlFor="word" className="mb-2 block px-3 pt-2 text-xs font-bold uppercase tracking-widest text-ink/45">Welches Wort?</label>
          <div className="flex gap-2">
            <input suppressHydrationWarning id="word" name="word" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="z. B. Freundlichkeit" autoComplete="off" className="min-w-0 flex-1 rounded-2xl bg-paper px-4 py-4 text-lg outline-none ring-moss/30 transition focus:ring-4" />
            <button type="submit" disabled={loading} className="rounded-2xl bg-ink px-5 font-bold text-white transition hover:bg-moss disabled:opacity-50">
              {loading ? "…" : "zerlegen →"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 px-2 pb-1 text-xs text-ink/50">
            <span>Probieren:</span>
            {["Lehrer", "Zerlegung", "Freundlichkeit"].map((word) => <button type="button" key={word} onClick={() => void search(word)} className="underline decoration-ink/20 underline-offset-4 hover:text-ink">{word}</button>)}
          </div>
        </form>
      </section>

      {error && <div role="alert" className="mx-auto mb-6 max-w-6xl rounded-2xl border border-coral/30 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {result && (
        <section className="mx-auto max-w-6xl rounded-[2rem] border border-ink/10 bg-white/90 p-6 shadow-card sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="flex items-center gap-3">
                {result.article && <span className={`rounded-full border px-3 py-1 text-sm font-bold ${articleStyle[result.article]}`}>{result.article}</span>}
                <h2 className="font-serif text-4xl font-bold sm:text-5xl">{result.word}</h2>
              </div>
              {result.partOfSpeech && <p className="mt-2 text-xs uppercase tracking-widest text-ink/45">{result.partOfSpeech}</p>}
            </div>
            <button onClick={toggleFavorite} aria-pressed={isFavorite} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${isFavorite ? "border-amber-300 bg-amber-100 text-amber-800" : "border-ink/15 hover:bg-paper"}`}>
              {isFavorite ? "★ 저장됨" : "☆ 단어장에 저장"}
            </button>
          </div>

          <div className="my-9 flex flex-wrap items-center gap-2">
            {result.morphemes.map((part, index) => (
              <div key={`${part.text}-${index}`} className="flex items-center gap-2">
                {index > 0 && <span className="text-2xl text-ink/25">+</span>}
                <button type="button" onClick={() => void search(part.lookup)} title={`${part.meaning}\n${part.targetUrl}`} className="group relative rounded-2xl border border-moss/20 bg-moss/5 px-5 py-3 text-xl font-bold text-moss transition hover:-translate-y-1 hover:bg-moss hover:text-white">
                  {part.text}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-3 hidden w-64 -translate-x-1/2 rounded-xl bg-ink p-3 text-left text-xs font-normal leading-5 text-white shadow-xl group-hover:block">{part.meaning}</span>
                </button>
              </div>
            ))}
          </div>

          {result.compoundHint && <p className="mb-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><strong>관사 힌트:</strong> {result.compoundHint}</p>}

          <div className="grid gap-8 border-t border-ink/10 pt-7 md:grid-cols-2">
            <div>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-coral">Bedeutung · 뜻</h3>
              <ol className="space-y-2 text-sm leading-6 text-ink/75">{result.meanings.map((meaning, index) => <li key={meaning}><span className="mr-2 text-ink/35">{index + 1}.</span>{meaning}</li>)}</ol>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-moss">Herkunft · 어원</h3>
              <p className="text-sm leading-6 text-ink/75">{result.etymology ?? "자동으로 추출된 어원 정보가 없습니다. Wiktionary 원문에서 더 자세히 확인해 주세요."}</p>
              <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-xs font-bold underline decoration-moss/30 underline-offset-4">Wiktionary 원문 ↗</a>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto mt-8 grid max-w-6xl gap-6 pb-20 lg:grid-cols-[.8fr_1.2fr]">
        <div className="rounded-[2rem] bg-ink p-7 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Meine Wörter · 단어장</p>
          <h2 className="mt-3 font-serif text-3xl">별표가 문장이 됩니다.</h2>
          <div className="mt-6 flex min-h-24 flex-wrap content-start gap-2">
            {favorites.length ? favorites.map((item) => (
              <button key={item.word} onClick={() => void search(item.word)} title="다시 검색" className="h-fit rounded-full border border-white/20 px-3 py-1.5 text-sm hover:bg-white hover:text-ink">{item.article} {item.word}</button>
            )) : <p className="text-sm leading-6 text-white/50">검색 결과의 별표를 눌러 학습할 단어를 모아 보세요.</p>}
          </div>
          <div className="mt-6 flex gap-2">
            <select
              suppressHydrationWarning
              id="level"
              name="level"
              aria-label="퀴즈 난이도"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none"
            >
              {["A1", "A2", "B1", "B2"].map((item) => <option className="text-ink" key={item} value={item}>{item}</option>)}
            </select>
            <button disabled={!favorites.length || quizLoading} onClick={() => void generateExercises()} className="flex-1 rounded-xl bg-coral px-4 py-2 text-sm font-bold hover:bg-[#c95e52] disabled:opacity-40">{quizLoading ? "문장 만드는 중…" : "AI 빈칸 퀴즈 만들기"}</button>
          </div>
        </div>

        <div className="rounded-[2rem] border border-ink/10 bg-white/75 p-7 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink/45">Lückentest · 빈칸 퀴즈</p>
            {!!exercises.length && <button onClick={() => setShowAnswers((value) => !value)} className="text-xs font-bold underline underline-offset-4">{showAnswers ? "정답 숨기기" : "정답 보기"}</button>}
          </div>
          {exercises.length ? <ol className="mt-5 space-y-5">{exercises.map((item, index) => (
            <li key={`${item.answer}-${index}`} className="border-b border-ink/10 pb-5 last:border-0">
              <p className="font-serif text-lg font-semibold">{index + 1}. {showAnswers ? item.sentence : item.cloze}</p>
              <p className="mt-1 text-sm text-ink/50">{item.translation}</p>
              {showAnswers && <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{item.answer}</span>}
            </li>
          ))}</ol> : <div className="grid min-h-48 place-items-center text-center"><p className="max-w-sm text-sm leading-6 text-ink/45">즐겨찾기 단어와 난이도를 선택하면<br />여기에 맞춤 예문과 빈칸 문제가 나타납니다.</p></div>}
        </div>
      </section>
    </main>
  );
}
