"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Article, FavoriteWord, GeneratedExercise, Morpheme, ParseResult } from "@/lib/types";

const STORAGE_KEY = "zerlegen-lernen:favorites";
const HISTORY_KEY = "zerlegen-lernen:results";
const WORD_CACHE_KEY = "zerlegen-lernen:word-cache:v3";
const WORD_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const WORD_CACHE_MAX_ENTRIES = 100;
const CLIENT_REQUEST_DELAY_MS = 175;

const articleStyle = {
  der: "bg-blue-100 text-blue-700 border-blue-200",
  die: "bg-rose-100 text-rose-700 border-rose-200",
  das: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

type DefiniteArticle = Exclude<Article, null>;

interface ArticleQuizQuestion {
  word: string;
  article: DefiniteArticle;
  meaning: string;
  reason: string;
}

interface FavoritePartPopover {
  owner: string;
  part: Morpheme;
  loading: boolean;
  result?: ParseResult;
  error?: string;
}

const ARTICLE_QUIZ_POOL: Record<string, ArticleQuizQuestion[]> = {
  A1: [
    { word: "Tisch", article: "der", meaning: "table", reason: "이 단어에는 확실한 어미 규칙이 없어 der Tisch로 함께 익히는 것이 좋습니다." },
    { word: "Schule", article: "die", meaning: "school", reason: "-e로 끝나는 명사는 여성명사인 경우가 많아 die를 쓰지만 예외도 있습니다." },
    { word: "Haus", article: "das", meaning: "house", reason: "이 단어에는 확실한 어미 규칙이 없어 das Haus로 함께 익히는 것이 좋습니다." },
    { word: "Zeitung", article: "die", meaning: "newspaper", reason: "-ung로 끝나는 명사는 대체로 여성명사이므로 die를 사용합니다." },
    { word: "Mädchen", article: "das", meaning: "girl", reason: "축소 접미사 -chen은 문법적으로 중성명사를 만들기 때문에 das를 사용합니다." },
  ],
  A2: [
    { word: "Lehrer", article: "der", meaning: "teacher", reason: "사람·행위자를 나타내는 접미사 -er로 만든 명사는 대체로 남성명사입니다." },
    { word: "Wohnung", article: "die", meaning: "apartment", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Möglichkeit", article: "die", meaning: "possibility", reason: "-keit로 끝나는 명사는 여성명사이므로 die를 사용합니다." },
    { word: "Museum", article: "das", meaning: "museum", reason: "-um로 끝나는 차용 명사는 대체로 중성명사입니다." },
    { word: "Garten", article: "der", meaning: "garden", reason: "뚜렷한 생산적 어미 규칙이 없어 der Garten으로 함께 익히는 것이 안전합니다." },
  ],
  B1: [
    { word: "Freundlichkeit", article: "die", meaning: "friendliness", reason: "-keit로 끝나는 명사는 여성명사이므로 die를 사용합니다." },
    { word: "Entscheidung", article: "die", meaning: "decision", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Ergebnis", article: "das", meaning: "result", reason: "이 단어에는 확실한 어미 규칙이 없어 das Ergebnis로 함께 익혀야 합니다." },
    { word: "Zusammenhang", article: "der", meaning: "connection; context", reason: "복합명사의 성은 마지막 기본어 Hang의 남성 성을 따릅니다." },
    { word: "Verhältnis", article: "das", meaning: "relationship; ratio", reason: "이 단어에는 확실한 어미 규칙이 없어 das Verhältnis로 함께 익혀야 합니다." },
  ],
  B2: [
    { word: "Wissenschaft", article: "die", meaning: "science", reason: "-schaft로 끝나는 명사는 여성명사이므로 die를 사용합니다." },
    { word: "Kapitalismus", article: "der", meaning: "capitalism", reason: "-ismus로 끝나는 명사는 남성명사이므로 der를 사용합니다." },
    { word: "Instrument", article: "das", meaning: "instrument", reason: "-ment로 끝나는 명사는 대체로 중성명사입니다." },
    { word: "Überzeugung", article: "die", meaning: "conviction", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Schmetterling", article: "der", meaning: "butterfly", reason: "-ling으로 끝나는 명사는 남성명사이므로 der를 사용합니다." },
  ],
};

function isParseResult(value: unknown): value is ParseResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParseResult>;
  return typeof candidate.word === "string"
    && Array.isArray(candidate.meanings)
    && Array.isArray(candidate.examples)
    && Array.isArray(candidate.morphemes);
}

function normalizedWord(word: string) {
  return word.trim().toLocaleLowerCase("de-DE");
}

function isTerminalResult(result: ParseResult) {
  return result.morphemes.length === 1
    && normalizedWord(result.morphemes[0].lookup) === normalizedWord(result.word);
}

function favoriteMorphemes(item: FavoriteWord) {
  if (item.morphemes?.length) return item.morphemes;
  if (!item.decomposition) return [];

  const parts = item.decomposition.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  return parts.map((part): Morpheme => ({
    text: part,
    lookup: part,
    targetUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(part)}#German`,
    kind: part.startsWith("-") ? "suffix" : part.endsWith("-") ? "prefix" : "root",
    meaning: "저장된 분해 요소입니다.",
  }));
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

interface BrowserCacheEntry {
  expiresAt: number;
  result: ParseResult;
}

const inFlightWordRequests = new Map<string, Promise<ParseResult>>();

function browserCacheKey(word: string) {
  return word.trim().normalize("NFC");
}

function readBrowserCache() {
  try {
    const value = localStorage.getItem(WORD_CACHE_KEY);
    return value ? JSON.parse(value) as Record<string, BrowserCacheEntry> : {};
  } catch {
    return {};
  }
}

function getBrowserCachedWord(word: string) {
  const cache = readBrowserCache();
  const key = browserCacheKey(word);
  const entry = cache[key];
  if (!entry || entry.expiresAt <= Date.now() || !isParseResult(entry.result)) {
    if (entry) {
      delete cache[key];
      try {
        localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // Ignore storage failures; the server cache still applies.
      }
    }
    return null;
  }
  return entry.result;
}

function setBrowserCachedWord(word: string, result: ParseResult) {
  try {
    const cache = readBrowserCache();
    const entries = Object.entries(cache)
      .filter(([, entry]) => entry.expiresAt > Date.now() && isParseResult(entry.result))
      .sort(([, left], [, right]) => right.expiresAt - left.expiresAt)
      .slice(0, WORD_CACHE_MAX_ENTRIES - 2);
    const next = Object.fromEntries(entries) as Record<string, BrowserCacheEntry>;
    next[browserCacheKey(word)] = { expiresAt: Date.now() + WORD_CACHE_TTL_MS, result };
    next[browserCacheKey(result.word)] = { expiresAt: Date.now() + WORD_CACHE_TTL_MS, result };
    localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private browsing; the server cache still applies.
  }
}

function clientDelay(milliseconds = CLIENT_REQUEST_DELAY_MS) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestWord(word: string) {
  const key = browserCacheKey(word);
  const cached = getBrowserCachedWord(key);
  if (cached) return cached;

  const existingRequest = inFlightWordRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = fetch(`/api/parse?word=${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "검색에 실패했습니다.");
    const result = data as ParseResult;
    setBrowserCachedWord(key, result);
    return result;
  }).finally(() => {
    inFlightWordRequests.delete(key);
  });

  inFlightWordRequests.set(key, request);
  return request;
}

interface ChildPreview {
  result?: ParseResult;
  error?: string;
}

function MorphemeComparisonGrid({
  result,
  onExplore,
}: {
  result: ParseResult;
  onExplore: (word: string) => void;
}) {
  const [previews, setPreviews] = useState<ChildPreview[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreviews() {
      const next: ChildPreview[] = [];

      for (const [index, part] of result.morphemes.entries()) {
        if (index > 0) await clientDelay();
        if (cancelled) return;

        try {
          next[index] = { result: await requestWord(part.lookup) };
        } catch (caught) {
          next[index] = { error: caught instanceof Error ? caught.message : "정보를 불러오지 못했습니다." };
        }

        if (cancelled) return;
        setPreviews([...next]);
      }
    }

    void loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [result]);

  return (
    <section className="mt-8 border-t border-ink/10 pt-7" aria-labelledby="morpheme-comparison-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="morpheme-comparison-title" className="text-xs font-bold uppercase tracking-[0.2em] text-moss">Bestandteile · 구성 요소 비교</h3>
          <p className="mt-2 text-sm text-ink/55">분해된 요소의 뜻과 구조를 한 화면에서 비교하세요.</p>
        </div>
        <span className="rounded-full bg-moss/10 px-3 py-1 text-xs font-bold text-moss">{result.morphemes.length}개 요소</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {result.morphemes.map((part, index) => {
          const preview = previews[index];
          const child = preview?.result;
          const terminal = child ? isTerminalResult(child) : false;

          return (
            <article key={`${part.lookup}-${index}`} className="rounded-2xl border border-ink/10 bg-paper/65 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/40">{part.kind}</p>
                  <h4 className="mt-1 font-serif text-2xl font-bold text-moss">{part.text}</h4>
                </div>
                {terminal && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800">분해 완료</span>}
              </div>

              {!preview && <p className="mt-5 animate-pulse text-sm text-ink/40">Wiktionary 정보를 불러오는 중…</p>}
              {preview?.error && <p className="mt-5 text-sm leading-6 text-red-700">{preview.error}</p>}
              {child && (
                <>
                  <div className="mt-4 flex items-center gap-2">
                    {child.article && <span className={`rounded-lg border px-2 py-1 font-serif text-sm font-bold ${articleStyle[child.article]}`}>{child.article}</span>}
                    {child.partOfSpeech && <span className="text-xs uppercase tracking-wider text-ink/45">{child.partOfSpeech}</span>}
                  </div>
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-ink/70">
                    {child.meanings.slice(0, 2).map((meaning, meaningIndex) => <li key={`${meaning}-${meaningIndex}`}>· {meaning}</li>)}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm font-bold text-moss">
                    {child.morphemes.map((childPart, childIndex) => (
                      <span key={`${childPart.lookup}-${childIndex}`} className="flex items-center gap-1.5">
                        {childIndex > 0 && <span className="text-ink/25">+</span>}
                        <span className="rounded-lg bg-white px-2 py-1">{childPart.text}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-4 border-l-2 border-coral/40 pl-3 text-sm italic leading-6 text-ink/60">{child.examples[0]?.sentence}</p>
                  {terminal ? (
                    <p className="mt-5 text-xs font-bold text-emerald-800">Wiktionary에 더 세분화된 현대 독일어 분해식이 없습니다.</p>
                  ) : (
                    <button type="button" onClick={() => onExplore(child.word)} className="mt-5 rounded-full border border-ink/15 bg-white px-3 py-2 text-xs font-bold transition hover:border-moss hover:text-moss">이 요소를 탐색 경로에 추가 →</button>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
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
  const [favoritePopover, setFavoritePopover] = useState<FavoritePartPopover | null>(null);
  const [articleQuestions, setArticleQuestions] = useState<ArticleQuizQuestion[]>([]);
  const [articleQuestionIndex, setArticleQuestionIndex] = useState(0);
  const [articleAnswer, setArticleAnswer] = useState<DefiniteArticle | null>(null);
  const [articleScore, setArticleScore] = useState(0);
  const [articleQuizFinished, setArticleQuizFinished] = useState(false);

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
        const restored: ParseResult[] = [];
        for (const [index, word] of words.entries()) {
          if (index > 0) await clientDelay();
          restored.push(await requestWord(word));
        }
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
          partOfSpeech: result.partOfSpeech,
          morphemes: result.morphemes,
          articleReason: result.articleReason,
        }];
    saveFavorites(next);
  }

  function selectHistoryStep(index: number) {
    const next = results.slice(0, index + 1);
    pushResults(next);
  }

  function openFavorite(word: string) {
    setFavoritePopover(null);
    setActiveTab("explore");
    void search(word);
  }

  async function openFavoritePart(owner: string, part: Morpheme) {
    setFavoritePopover({ owner, part, loading: true });
    try {
      const result = await requestWord(part.lookup);
      setFavoritePopover((current) => (
        current?.owner === owner && current.part.lookup === part.lookup
          ? { owner, part, loading: false, result }
          : current
      ));
    } catch (caught) {
      setFavoritePopover((current) => (
        current?.owner === owner && current.part.lookup === part.lookup
          ? { owner, part, loading: false, error: caught instanceof Error ? caught.message : "정보를 불러오지 못했습니다." }
          : current
      ));
    }
  }

  function startArticleQuiz() {
    const savedQuestions = favorites.flatMap((item): ArticleQuizQuestion[] => (
      item.article
        ? [{
            word: item.word,
            article: item.article,
            meaning: item.meaning,
            reason: item.articleReason ?? `Wiktionary의 성 표기에 따라 ${item.article}를 사용합니다. 단어와 관사를 함께 익혀 보세요.`,
          }]
        : []
    ));
    const unique = new Map<string, ArticleQuizQuestion>();
    [...savedQuestions, ...(ARTICLE_QUIZ_POOL[level] ?? ARTICLE_QUIZ_POOL.A2)].forEach((question) => {
      unique.set(normalizedWord(question.word), question);
    });
    const next = Array.from(unique.values()).sort(() => Math.random() - 0.5).slice(0, 5);

    setArticleQuestions(next);
    setArticleQuestionIndex(0);
    setArticleAnswer(null);
    setArticleScore(0);
    setArticleQuizFinished(false);
  }

  function answerArticle(answer: DefiniteArticle) {
    if (articleAnswer) return;
    setArticleAnswer(answer);
    if (answer === articleQuestions[articleQuestionIndex]?.article) {
      setArticleScore((score) => score + 1);
    }
  }

  function nextArticleQuestion() {
    if (articleQuestionIndex + 1 >= articleQuestions.length) {
      setArticleQuizFinished(true);
      return;
    }
    setArticleQuestionIndex((index) => index + 1);
    setArticleAnswer(null);
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

  const articleQuestion = articleQuestions[articleQuestionIndex];

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

      <div role="tablist" aria-label="학습 화면" className="mx-auto mt-6 flex max-w-6xl gap-2 rounded-[1.4rem] border border-ink/15 bg-white/70 p-2 shadow-sm">
        <button type="button" role="tab" aria-selected={activeTab === "explore"} onClick={() => setActiveTab("explore")} className={`flex-1 rounded-2xl border px-5 py-3.5 text-base font-bold transition ${activeTab === "explore" ? "border-ink bg-ink text-white shadow-md" : "border-transparent text-ink/65 hover:border-ink/10 hover:bg-white"}`}>탐색</button>
        <button type="button" role="tab" aria-selected={activeTab === "favorites"} onClick={() => setActiveTab("favorites")} className={`flex-1 rounded-2xl border px-5 py-3.5 text-base font-bold transition ${activeTab === "favorites" ? "border-ink bg-ink text-white shadow-md" : "border-transparent text-ink/65 hover:border-ink/10 hover:bg-white"}`}>단어장 · {favorites.length}</button>
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
                    <button type="button" onClick={() => selectHistoryStep(index)} aria-current={index === results.length - 1 ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-sm font-bold shadow-sm transition ${index === results.length - 1 ? "border-ink bg-ink text-white ring-2 ring-moss/30" : "border-ink/20 bg-white text-ink hover:border-moss hover:text-moss"}`}>{result.word}</button>
                  </div>
                ))}
              </nav>

              <div className="space-y-6">
                {results.map((result, resultIndex) => {
                  const favorite = isFavorite(result);
                  const current = resultIndex === results.length - 1;
                  const terminal = isTerminalResult(result);
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
                            {terminal ? (
                              <span title={part.meaning} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-xl font-bold text-emerald-800">{part.text}</span>
                            ) : (
                              <button type="button" onClick={() => void search(part.lookup, results.slice(0, resultIndex + 1))} title={`${part.meaning}\n${part.targetUrl}`} className="group relative rounded-2xl border border-moss/20 bg-moss/5 px-5 py-3 text-xl font-bold text-moss transition hover:-translate-y-1 hover:bg-moss hover:text-white">
                                {part.text}
                                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-3 hidden w-64 -translate-x-1/2 rounded-xl bg-ink p-3 text-left text-xs font-normal leading-5 text-white shadow-xl group-hover:block">{part.meaning}</span>
                              </button>
                            )}
                          </div>
                        ))}
                        {terminal && <span className="ml-1 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900">✓ 분해 완료</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/45">
                        <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="font-bold underline decoration-moss/30 underline-offset-4">Wiktionary 원문 ↗</a>
                      </div>

                      {result.articleReason && <p className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><strong>왜 {result.article}일까요?</strong> {result.articleReason}</p>}

                      <div className="mt-7 border-t border-ink/10 pt-7">
                        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-coral">Bedeutung · 뜻</h3>
                        <ol className="space-y-2 text-sm leading-6 text-ink/75">{result.meanings.map((meaning, index) => <li key={`${meaning}-${index}`}><span className="mr-2 text-ink/35">{index + 1}.</span>{meaning}</li>)}</ol>
                      </div>

                      <div className="mt-7 rounded-2xl border border-coral/15 bg-coral/5 p-5">
                        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-coral">Beispiel · 예문</h3>
                        <ul className="space-y-4">
                          {result.examples.map((example, index) => (
                            <li key={`${example.sentence}-${index}`} className="text-sm leading-6 text-ink/75">
                              <p className="font-medium">„{example.sentence}“</p>
                              {example.translation && <p className="mt-1 text-ink/50">{example.translation}</p>}
                              <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider text-ink/35">{example.source === "wiktionary" ? "Wiktionary" : "자동 보완 예문"}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {current && result.morphemes.length > 1 && (
                        <MorphemeComparisonGrid
                          key={`${result.word}:${result.morphemes.map((part) => part.lookup).join("+")}`}
                          result={result}
                          onExplore={(word) => void search(word, results)}
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "favorites" && (
        <section className="mx-auto max-w-6xl space-y-6 pb-20 pt-10">
          <div className="overflow-hidden rounded-[2rem] border border-ink/10 bg-white/85 shadow-card">
            <div className="border-b border-ink/10 p-7 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-moss">Meine Wörter · 단어장</p>
              <h2 className="mt-3 font-serif text-3xl">저장한 단어를 한눈에.</h2>
              <p className="mt-2 text-sm leading-6 text-ink/55">단어를 누르면 전체 탐색으로, 분해 요소를 누르면 빠른 설명으로 이동합니다.</p>
            </div>
            {favorites.length ? (
              <div className="p-3 sm:p-5">
                <div className="overflow-x-auto rounded-2xl border border-ink/10">
                <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                  <thead className="bg-paper text-[10px] uppercase tracking-[0.18em] text-ink/45">
                    <tr><th className="px-5 py-3">관사</th><th className="px-4 py-3">단어</th><th className="px-4 py-3">뜻</th><th className="px-4 py-3">분해 요소</th><th className="px-5 py-3">관사 이유</th></tr>
                  </thead>
                  <tbody>
                    {favorites.map((item) => {
                      const parts = favoriteMorphemes(item);
                      return (
                        <tr key={item.word} className="border-t border-ink/10 align-top">
                          <td className="px-5 py-5">
                            {item.article ? <span className={`inline-flex min-w-12 justify-center rounded-xl border px-3 py-1.5 font-serif text-base font-bold ${articleStyle[item.article]}`}>{item.article}</span> : <span className="pl-3 text-ink/30">—</span>}
                          </td>
                          <td className="px-4 py-5">
                            <button type="button" onClick={() => openFavorite(item.word)} className="whitespace-nowrap font-serif text-lg font-bold underline decoration-moss/25 underline-offset-4 transition hover:text-moss">{item.word} →</button>
                          </td>
                          <td className="max-w-sm px-4 py-5 leading-6 text-ink/65">{item.meaning}</td>
                          <td className="min-w-48 px-4 py-5">
                            {parts.length ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {parts.map((part, index) => (
                                  <span key={`${part.lookup}-${index}`} className="flex items-center gap-1.5">
                                    {index > 0 && <span className="text-ink/25">+</span>}
                                    <button type="button" onClick={() => void openFavoritePart(item.word, part)} className="rounded-lg border border-moss/20 bg-moss/5 px-2.5 py-1.5 font-bold text-moss transition hover:bg-moss hover:text-white">{part.text}</button>
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-ink/35">분해 완료</span>}
                          </td>
                          <td className="max-w-xs px-5 py-5 text-xs leading-5 text-ink/55">{item.articleReason ?? (item.article ? `${item.article}와 단어를 함께 익혀 보세요.` : "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            ) : <div className="grid min-h-52 place-items-center p-8 text-center text-sm leading-6 text-ink/45">탐색 결과에서 별표를 눌러<br />학습할 단어를 저장해 보세요.</div>}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-blue-200 bg-blue-50 p-7 text-blue-950 shadow-card sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-700/60">Artikel-Quiz · 관사 맞추기</p>
                  <h2 className="mt-2 font-serif text-2xl font-bold">der, die oder das?</h2>
                </div>
                <select suppressHydrationWarning id="article-level" name="article-level" aria-label="관사 퀴즈 난이도" value={level} onChange={(event) => setLevel(event.target.value)} className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-950 outline-none">{["A1", "A2", "B1", "B2"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
              </div>

              {!articleQuestions.length && (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <p className="max-w-sm text-sm leading-6 text-blue-900/60">저장한 명사를 우선 사용하고 부족한 문제는 선택한 수준의 단어로 채웁니다.</p>
                    <button type="button" onClick={startArticleQuiz} className="mt-5 rounded-xl bg-blue-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-moss">5문제 시작하기</button>
                  </div>
                </div>
              )}

              {!!articleQuestions.length && articleQuizFinished && (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <p className="text-sm font-bold text-blue-800">퀴즈 완료</p>
                    <p className="mt-2 font-serif text-5xl font-bold">{articleScore} / {articleQuestions.length}</p>
                    <button type="button" onClick={startArticleQuiz} className="mt-6 rounded-xl bg-blue-950 px-5 py-3 text-sm font-bold text-white">다시 풀기</button>
                  </div>
                </div>
              )}

              {articleQuestion && !articleQuizFinished && (
                <div className="mt-7">
                  <div className="flex items-center justify-between text-xs font-bold text-blue-800/55"><span>{articleQuestionIndex + 1} / {articleQuestions.length}</span><span>점수 {articleScore}</span></div>
                  <div className="mt-5 rounded-2xl bg-white/80 p-6 text-center">
                    <p className="font-serif text-4xl font-bold">{articleQuestion.word}</p>
                    <p className="mt-3 text-sm text-blue-900/60">뜻: {articleQuestion.meaning}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {(["der", "die", "das"] as DefiniteArticle[]).map((choice) => {
                      const correct = articleAnswer && choice === articleQuestion.article;
                      const wrong = articleAnswer === choice && choice !== articleQuestion.article;
                      return <button type="button" key={choice} disabled={Boolean(articleAnswer)} onClick={() => answerArticle(choice)} className={`rounded-xl border px-3 py-3 font-serif text-lg font-bold transition ${correct ? "border-emerald-600 bg-emerald-100 text-emerald-900" : wrong ? "border-red-500 bg-red-100 text-red-900" : "border-blue-200 bg-white hover:border-blue-500"}`}>{choice}</button>;
                    })}
                  </div>
                  {articleAnswer && (
                    <div role="status" className="mt-5 rounded-2xl border border-blue-200 bg-white p-5 text-sm leading-6">
                      <p className="font-bold">{articleAnswer === articleQuestion.article ? "정답입니다!" : `정답은 ${articleQuestion.article}입니다.`}</p>
                      <p className="mt-1 text-blue-900/70">{articleQuestion.reason}</p>
                      <button type="button" onClick={nextArticleQuestion} className="mt-4 rounded-full bg-blue-950 px-4 py-2 text-xs font-bold text-white">{articleQuestionIndex + 1 === articleQuestions.length ? "결과 보기" : "다음 문제 →"}</button>
                    </div>
                  )}
                </div>
              )}
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
              ))}</ol> : <div className="grid min-h-64 place-items-center text-center"><p className="max-w-sm text-sm leading-6 text-white/45">저장한 단어와 난이도로<br />맞춤 예문을 만들 수 있습니다.</p></div>}
            </div>
          </div>
        </section>
      )}

      {favoritePopover && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-5 backdrop-blur-sm" onClick={() => setFavoritePopover(null)}>
          <aside role="dialog" aria-modal="true" aria-label={`${favoritePopover.part.text} 빠른 설명`} onClick={(event) => event.stopPropagation()} className="relative w-full max-w-lg rounded-[2rem] border border-white/60 bg-white p-6 shadow-2xl sm:p-8">
            <span aria-hidden className="absolute -top-2 left-12 h-5 w-5 rotate-45 border-l border-t border-ink/10 bg-white" />
            <button type="button" onClick={() => setFavoritePopover(null)} aria-label="닫기" className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full bg-paper text-lg text-ink/55 hover:text-ink">×</button>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40">{favoritePopover.owner}의 구성 요소</p>
            <h2 className="mt-2 pr-12 font-serif text-4xl font-bold text-moss">{favoritePopover.part.text}</h2>
            {favoritePopover.loading && <p className="mt-8 animate-pulse text-sm text-ink/45">Wiktionary 정보를 불러오는 중…</p>}
            {favoritePopover.error && <p className="mt-8 rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800">{favoritePopover.error}</p>}
            {favoritePopover.result && (
              <>
                <div className="mt-5 flex items-center gap-2">
                  {favoritePopover.result.article && <span className={`rounded-xl border px-3 py-1.5 font-serif font-bold ${articleStyle[favoritePopover.result.article]}`}>{favoritePopover.result.article}</span>}
                  {favoritePopover.result.partOfSpeech && <span className="text-xs uppercase tracking-wider text-ink/45">{favoritePopover.result.partOfSpeech}</span>}
                </div>
                <ul className="mt-5 space-y-2 text-sm leading-6 text-ink/70">
                  {favoritePopover.result.meanings.slice(0, 3).map((meaning, index) => <li key={`${meaning}-${index}`}>{index + 1}. {meaning}</li>)}
                </ul>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {favoritePopover.result.morphemes.map((part, index) => <span key={`${part.lookup}-${index}`} className="flex items-center gap-2 text-sm font-bold text-moss">{index > 0 && <span className="text-ink/25">+</span>}<span className="rounded-lg bg-moss/5 px-2.5 py-1.5">{part.text}</span></span>)}
                  {isTerminalResult(favoritePopover.result) && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-900">분해 완료</span>}
                </div>
                {favoritePopover.result.articleReason && <p className="mt-5 rounded-xl bg-blue-50 p-4 text-xs leading-5 text-blue-950"><strong>관사 이유:</strong> {favoritePopover.result.articleReason}</p>}
                <button type="button" onClick={() => openFavorite(favoritePopover.result!.word)} className="mt-7 w-full rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-moss">메인 검색창에서 전체 탐색 →</button>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
