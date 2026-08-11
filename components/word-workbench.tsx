"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Article, FavoriteType, FavoriteWord, GeneratedExercise, Morpheme, ParseResult } from "@/lib/types";

const STORAGE_KEY = "zerlegen-lernen:favorites";
const HISTORY_KEY = "zerlegen-lernen:results";
const WORD_CACHE_KEY = "zerlegen-lernen:word-cache:v5";
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
  top: number;
  left: number;
  loading: boolean;
  result?: ParseResult;
  error?: string;
}

const ARTICLE_QUIZ_POOL: Record<string, ArticleQuizQuestion[]> = {
  A1: [
    { word: "Tisch", article: "der", meaning: "탁자", reason: "뚜렷한 어미 규칙이 없어 der Tisch로 함께 익히는 것이 좋습니다." },
    { word: "Schule", article: "die", meaning: "학교", reason: "-e로 끝나는 명사는 여성명사인 경우가 많지만 예외도 있습니다." },
    { word: "Haus", article: "das", meaning: "집", reason: "뚜렷한 어미 규칙이 없어 das Haus로 함께 익히는 것이 좋습니다." },
    { word: "Zeitung", article: "die", meaning: "신문", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Mädchen", article: "das", meaning: "소녀", reason: "축소 접미사 -chen은 문법적으로 중성명사를 만듭니다." },
    { word: "Mann", article: "der", meaning: "남자", reason: "자연 성별이 남성인 사람을 나타내는 기본 명사입니다." },
    { word: "Frau", article: "die", meaning: "여자", reason: "자연 성별이 여성인 사람을 나타내는 기본 명사입니다." },
    { word: "Kind", article: "das", meaning: "아이", reason: "자연 성별과 문법적 성은 다를 수 있으므로 das Kind로 익힙니다." },
    { word: "Apfel", article: "der", meaning: "사과", reason: "뚜렷한 어미 규칙이 없어 der Apfel로 함께 익힙니다." },
    { word: "Banane", article: "die", meaning: "바나나", reason: "-e로 끝나는 명사는 여성명사인 경우가 많습니다." },
    { word: "Brot", article: "das", meaning: "빵", reason: "뚜렷한 어미 규칙이 없어 das Brot로 함께 익힙니다." },
    { word: "Hund", article: "der", meaning: "개", reason: "뚜렷한 어미 규칙이 없어 der Hund로 함께 익힙니다." },
    { word: "Katze", article: "die", meaning: "고양이", reason: "-e로 끝나는 명사는 여성명사인 경우가 많습니다." },
    { word: "Auto", article: "das", meaning: "자동차", reason: "Auto는 Automobil의 줄임말이며 중성명사입니다." },
    { word: "Buch", article: "das", meaning: "책", reason: "뚜렷한 어미 규칙이 없어 das Buch로 함께 익힙니다." },
    { word: "Lampe", article: "die", meaning: "램프", reason: "-e로 끝나는 명사는 여성명사인 경우가 많습니다." },
  ],
  A2: [
    { word: "Lehrer", article: "der", meaning: "교사", reason: "사람·행위자를 나타내는 접미사 -er 명사는 대체로 남성명사입니다." },
    { word: "Wohnung", article: "die", meaning: "주택, 아파트", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Möglichkeit", article: "die", meaning: "가능성", reason: "-keit로 끝나는 명사는 여성명사입니다." },
    { word: "Museum", article: "das", meaning: "박물관", reason: "-um로 끝나는 차용 명사는 대체로 중성명사입니다." },
    { word: "Garten", article: "der", meaning: "정원", reason: "뚜렷한 생산적 어미 규칙이 없어 der Garten으로 함께 익힙니다." },
    { word: "Bahnhof", article: "der", meaning: "기차역", reason: "복합명사는 마지막 기본어 Hof의 남성 성을 따릅니다." },
    { word: "Universität", article: "die", meaning: "대학교", reason: "-tät로 끝나는 명사는 여성명사입니다." },
    { word: "Einladung", article: "die", meaning: "초대", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Brötchen", article: "das", meaning: "작은 빵", reason: "축소 접미사 -chen은 중성명사를 만듭니다." },
    { word: "Frühling", article: "der", meaning: "봄", reason: "-ling으로 끝나는 명사는 남성명사입니다." },
    { word: "Instrument", article: "das", meaning: "도구, 악기", reason: "-ment로 끝나는 명사는 대체로 중성명사입니다." },
    { word: "Gesundheit", article: "die", meaning: "건강", reason: "-heit로 끝나는 명사는 여성명사입니다." },
    { word: "Fahrrad", article: "das", meaning: "자전거", reason: "복합명사는 마지막 기본어 Rad의 중성 성을 따릅니다." },
    { word: "Computer", article: "der", meaning: "컴퓨터", reason: "이 차용어는 남성명사이므로 der Computer로 익힙니다." },
    { word: "Reise", article: "die", meaning: "여행", reason: "-e로 끝나는 명사는 여성명사인 경우가 많습니다." },
    { word: "Bäckerei", article: "die", meaning: "빵집", reason: "-ei로 끝나는 명사는 여성명사입니다." },
  ],
  B1: [
    { word: "Freundlichkeit", article: "die", meaning: "친절함", reason: "-keit로 끝나는 명사는 여성명사입니다." },
    { word: "Entscheidung", article: "die", meaning: "결정", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Ergebnis", article: "das", meaning: "결과", reason: "뚜렷한 어미 규칙이 없어 das Ergebnis로 함께 익힙니다." },
    { word: "Zusammenhang", article: "der", meaning: "연관, 맥락", reason: "복합명사의 성은 마지막 기본어 Hang의 남성 성을 따릅니다." },
    { word: "Verhältnis", article: "das", meaning: "관계, 비율", reason: "뚜렷한 어미 규칙이 없어 das Verhältnis로 함께 익힙니다." },
    { word: "Erfahrung", article: "die", meaning: "경험", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Verantwortung", article: "die", meaning: "책임", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Ereignis", article: "das", meaning: "사건", reason: "-nis 명사는 성이 일정하지 않으므로 das Ereignis로 익힙니다." },
    { word: "Arbeitsplatz", article: "der", meaning: "직장, 작업 공간", reason: "복합명사는 마지막 기본어 Platz의 남성 성을 따릅니다." },
    { word: "Beziehung", article: "die", meaning: "관계", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Eigentum", article: "das", meaning: "소유물, 재산", reason: "-tum으로 끝나는 추상명사 중 다수는 중성명사입니다." },
    { word: "Unterschied", article: "der", meaning: "차이", reason: "뚜렷한 어미 규칙이 없어 der Unterschied로 함께 익힙니다." },
    { word: "Fähigkeit", article: "die", meaning: "능력", reason: "-keit로 끝나는 명사는 여성명사입니다." },
    { word: "Nachricht", article: "die", meaning: "소식, 메시지", reason: "뚜렷한 어미 규칙이 없어 die Nachricht로 함께 익힙니다." },
    { word: "Verhalten", article: "das", meaning: "행동, 태도", reason: "명사화된 동사 원형은 일반적으로 중성명사입니다." },
    { word: "Gedanke", article: "der", meaning: "생각", reason: "-e로 끝나지만 남성인 예외이므로 der Gedanke로 익힙니다." },
  ],
  B2: [
    { word: "Wissenschaft", article: "die", meaning: "학문, 과학", reason: "-schaft로 끝나는 명사는 여성명사입니다." },
    { word: "Kapitalismus", article: "der", meaning: "자본주의", reason: "-ismus로 끝나는 명사는 남성명사입니다." },
    { word: "Instrument", article: "das", meaning: "도구, 악기", reason: "-ment로 끝나는 명사는 대체로 중성명사입니다." },
    { word: "Überzeugung", article: "die", meaning: "확신, 신념", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Schmetterling", article: "der", meaning: "나비", reason: "-ling으로 끝나는 명사는 남성명사입니다." },
    { word: "Herausforderung", article: "die", meaning: "도전", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Erkenntnis", article: "die", meaning: "인식, 통찰", reason: "-nis 명사는 성이 일정하지 않으므로 die Erkenntnis로 익힙니다." },
    { word: "Bewusstsein", article: "das", meaning: "의식", reason: "뚜렷한 어미 규칙이 없어 das Bewusstsein으로 함께 익힙니다." },
    { word: "Voraussetzung", article: "die", meaning: "전제 조건", reason: "-ung로 끝나는 명사는 대체로 여성명사입니다." },
    { word: "Gesellschaft", article: "die", meaning: "사회", reason: "-schaft로 끝나는 명사는 여성명사입니다." },
    { word: "Wachstum", article: "das", meaning: "성장", reason: "-tum으로 끝나는 추상명사 중 다수는 중성명사입니다." },
    { word: "Einfluss", article: "der", meaning: "영향", reason: "뚜렷한 어미 규칙이 없어 der Einfluss로 함께 익힙니다." },
    { word: "Gelegenheit", article: "die", meaning: "기회", reason: "-heit로 끝나는 명사는 여성명사입니다." },
    { word: "Fortschritt", article: "der", meaning: "진보", reason: "복합 구조의 마지막 기본어 Schritt가 남성명사입니다." },
    { word: "Phänomen", article: "das", meaning: "현상", reason: "이 차용어는 중성명사이므로 das Phänomen으로 익힙니다." },
    { word: "Komplexität", article: "die", meaning: "복잡성", reason: "-tät로 끝나는 명사는 여성명사입니다." },
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

function favoriteTypes(item: FavoriteWord): FavoriteType[] {
  return item.favoriteTypes?.length ? item.favoriteTypes : ["meaning"];
}

function favoriteFromResult(result: ParseResult, types: FavoriteType[]): FavoriteWord {
  return {
    word: result.word,
    article: result.article,
    meaning: result.meanings[0],
    decomposition: result.morphemes.map((part) => part.text).join(" + "),
    partOfSpeech: result.partOfSpeech,
    morphemes: result.morphemes,
    articleReason: result.articleReason,
    favoriteTypes: types,
  };
}

function articleReasonText(reason: string | null | undefined, article: Article) {
  const cleaned = reason
    ?.replace(/\s*영어 Wiktionary의 이 항목(?:도|은) [^.]+표기합니다\./g, "")
    .replace(/영어 Wiktionary의 독일어 명사 성 표기에 따라 [^.]+사용합니다\.\s*/g, "")
    .replace(/Wiktionary의 성 표기에 따라 [^.]+사용합니다\.\s*/g, "")
    .trim();
  if (!cleaned || !article || /뚜렷한|확실한 .*규칙이 없|관사 (?:der|die|das)와 단어를 함께/.test(cleaned)) return null;
  return cleaned;
}

function shuffled<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
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

  const request = fetch(`/api/parse?word=${encodeURIComponent(key)}&v=5`, {
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
  parts,
  onExplore,
}: {
  parts: Morpheme[];
  onExplore: (word: string) => void;
}) {
  const [previews, setPreviews] = useState<ChildPreview[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreviews() {
      const next: ChildPreview[] = [];

      for (const [index, part] of parts.entries()) {
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
  }, [parts]);

  return (
    <section className="mt-8 border-t border-ink/10 pt-7">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-moss">Bestandteile · 선택한 구성 요소</h3>
          <p className="mt-2 text-sm text-ink/55">요소를 다시 누르면 상세 카드가 닫힙니다.</p>
        </div>
        <span className="rounded-full bg-moss/10 px-3 py-1 text-xs font-bold text-moss">{parts.length}개 선택</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {parts.map((part, index) => {
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

              {!preview && <p className="mt-5 animate-pulse text-sm text-ink/40">요소 정보를 불러오는 중…</p>}
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
                    <p className="mt-5 text-xs font-bold text-emerald-800">더 세분화된 현대 독일어 분해식이 없습니다.</p>
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
  const favoritePopoverRef = useRef<HTMLElement>(null);
  const [articleQuestions, setArticleQuestions] = useState<ArticleQuizQuestion[]>([]);
  const [articleQuestionIndex, setArticleQuestionIndex] = useState(0);
  const [articleAnswer, setArticleAnswer] = useState<DefiniteArticle | null>(null);
  const [articleScore, setArticleScore] = useState(0);
  const [articleQuizFinished, setArticleQuizFinished] = useState(false);
  const [articleQuizOpen, setArticleQuizOpen] = useState(false);
  const [articleHintVisible, setArticleHintVisible] = useState(false);
  const [wrongArticleQuestions, setWrongArticleQuestions] = useState<ArticleQuizQuestion[]>([]);
  const [articleQuizRound, setArticleQuizRound] = useState<"main" | "retry">("main");
  const [expandedMorphemes, setExpandedMorphemes] = useState<Record<string, string[]>>({});
  const [favoriteRequestKey, setFavoriteRequestKey] = useState<string | null>(null);

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
    if (!favoritePopover) return;

    function dismissPopover(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-favorite-popover-trigger]")) return;
      if (!favoritePopoverRef.current?.contains(event.target as Node)) {
        setFavoritePopover(null);
      }
    }

    document.addEventListener("pointerdown", dismissPopover);
    return () => document.removeEventListener("pointerdown", dismissPopover);
  }, [favoritePopover]);

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

  function updateFavorites(updater: (current: FavoriteWord[]) => FavoriteWord[]) {
    setFavorites((current) => {
      const next = updater(current);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep the in-memory wordbook usable when browser storage is unavailable.
      }
      return next;
    });
  }

  function addFavoriteTypeFromResult(result: ParseResult, type: FavoriteType) {
    const key = normalizedWord(result.word);
    updateFavorites((current) => {
      const existing = current.find((item) => normalizedWord(item.word) === key);
      const types = existing ? favoriteTypes(existing) : [];
      const nextTypes = types.includes(type) ? types : [...types, type];
      const nextFavorite = favoriteFromResult(result, nextTypes);
      return existing
        ? current.map((item) => normalizedWord(item.word) === key ? nextFavorite : item)
        : [...current, nextFavorite];
    });
  }

  function removeFavoriteType(word: string, type: FavoriteType) {
    const key = normalizedWord(word);
    updateFavorites((current) => current.flatMap((item): FavoriteWord[] => {
      if (normalizedWord(item.word) !== key) return [item];
      const nextTypes = favoriteTypes(item).filter((favoriteType) => favoriteType !== type);
      return nextTypes.length ? [{ ...item, favoriteTypes: nextTypes }] : [];
    }));
    setFavoritePopover((current) => current?.owner === word ? null : current);
  }

  async function toggleFavoriteByWord(word: string, type: FavoriteType) {
    if (hasFavoriteType(word, type)) {
      removeFavoriteType(word, type);
      return;
    }

    const requestKey = `${normalizedWord(word)}:${type}`;
    setFavoriteRequestKey(requestKey);
    try {
      addFavoriteTypeFromResult(await requestWord(word), type);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "단어장 저장에 실패했습니다.");
    } finally {
      setFavoriteRequestKey((current) => current === requestKey ? null : current);
    }
  }

  function syncFavoriteData(result: ParseResult) {
    const key = normalizedWord(result.word);
    updateFavorites((current) => current.some((item) => normalizedWord(item.word) === key)
      ? current.map((item) => normalizedWord(item.word) === key
          ? favoriteFromResult(result, favoriteTypes(item))
          : item)
      : current);
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
      syncFavoriteData(data);
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

  function toggleFavoriteType(result: ParseResult, type: FavoriteType) {
    if (hasFavoriteType(result.word, type)) removeFavoriteType(result.word, type);
    else addFavoriteTypeFromResult(result, type);
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

  async function openFavoritePart(owner: string, part: Morpheme, anchor: HTMLButtonElement) {
    if (favoritePopover?.owner === owner && favoritePopover.part.lookup === part.lookup) {
      setFavoritePopover(null);
      return;
    }

    const bounds = anchor.getBoundingClientRect();
    const left = Math.max(12, Math.min(bounds.left, window.innerWidth - 348));
    const top = bounds.bottom + 10 > window.innerHeight - 260
      ? Math.max(12, bounds.top - 250)
      : bounds.bottom + 10;
    setFavoritePopover({ owner, part, top, left, loading: true });
    try {
      const result = await requestWord(part.lookup);
      setFavoritePopover((current) => (
        current?.owner === owner && current.part.lookup === part.lookup
          ? { ...current, loading: false, result }
          : current
      ));
    } catch (caught) {
      setFavoritePopover((current) => (
        current?.owner === owner && current.part.lookup === part.lookup
          ? { ...current, loading: false, error: caught instanceof Error ? caught.message : "정보를 불러오지 못했습니다." }
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
            reason: articleReasonText(item.articleReason, item.article) ?? "-",
          }]
        : []
    ));
    const unique = new Map<string, ArticleQuizQuestion>();
    [...savedQuestions, ...(ARTICLE_QUIZ_POOL[level] ?? ARTICLE_QUIZ_POOL.A2)].forEach((question) => {
      const key = normalizedWord(question.word);
      if (!unique.has(key)) unique.set(key, {
        ...question,
        reason: articleReasonText(question.reason, question.article) ?? "-",
      });
    });
    const next = shuffled(Array.from(unique.values())).slice(0, 8);

    setArticleQuestions(next);
    setArticleQuestionIndex(0);
    setArticleAnswer(null);
    setArticleScore(0);
    setArticleQuizFinished(false);
    setArticleHintVisible(false);
    setWrongArticleQuestions([]);
    setArticleQuizRound("main");
    setArticleQuizOpen(true);
  }

  function answerArticle(answer: DefiniteArticle) {
    if (articleAnswer) return;
    setArticleAnswer(answer);
    if (answer === articleQuestions[articleQuestionIndex]?.article) {
      setArticleScore((score) => score + 1);
    } else {
      const question = articleQuestions[articleQuestionIndex];
      if (question) setWrongArticleQuestions((items) => [...items, question]);
    }
  }

  function nextArticleQuestion() {
    if (articleQuestionIndex + 1 >= articleQuestions.length) {
      setArticleQuizFinished(true);
      return;
    }
    setArticleQuestionIndex((index) => index + 1);
    setArticleAnswer(null);
    setArticleHintVisible(false);
  }

  function retryWrongArticles() {
    setArticleQuestions(shuffled(wrongArticleQuestions));
    setArticleQuestionIndex(0);
    setArticleAnswer(null);
    setArticleScore(0);
    setArticleQuizFinished(false);
    setArticleHintVisible(false);
    setWrongArticleQuestions([]);
    setArticleQuizRound("retry");
  }

  function toggleMorpheme(resultIndex: number, word: string, lookup: string) {
    const key = `${resultIndex}:${word}`;
    setExpandedMorphemes((current) => {
      const selected = current[key] ?? [];
      return {
        ...current,
        [key]: selected.includes(lookup)
          ? selected.filter((item) => item !== lookup)
          : [...selected, lookup],
      };
    });
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

  function hasFavoriteType(word: string, type: FavoriteType) {
    const favorite = favorites.find((item) => normalizedWord(item.word) === normalizedWord(word));
    return favorite ? favoriteTypes(favorite).includes(type) : false;
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
              <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">독일어 단어를 형태소 단위로 살펴보세요. 여러 조각을 선택해 상세 정보를 나란히 비교하고, 원하는 요소만 다음 탐색 단계로 이어갈 수 있습니다.</p>
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
                  const meaningFavorite = hasFavoriteType(result.word, "meaning");
                  const articleFavorite = hasFavoriteType(result.word, "article");
                  const current = resultIndex === results.length - 1;
                  const terminal = isTerminalResult(result);
                  const detailKey = `${resultIndex}:${result.word}`;
                  const selectedLookups = expandedMorphemes[detailKey] ?? [];
                  const selectedParts = result.morphemes.filter((part) => selectedLookups.includes(part.lookup));
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
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => toggleFavoriteType(result, "meaning")} aria-pressed={meaningFavorite} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${meaningFavorite ? "border-amber-300 bg-amber-100 text-amber-800" : "border-ink/15 hover:bg-paper"}`}>{meaningFavorite ? "★ 뜻 학습" : "☆ 뜻을 모름"}</button>
                          {result.article && <button type="button" onClick={() => toggleFavoriteType(result, "article")} aria-pressed={articleFavorite} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${articleFavorite ? "border-blue-300 bg-blue-100 text-blue-800" : "border-ink/15 hover:bg-paper"}`}>{articleFavorite ? "★ 관사 학습" : "☆ 관사를 모름"}</button>}
                        </div>
                      </div>

                      <div className="mt-8 flex flex-wrap items-center gap-2">
                        {result.morphemes.map((part, index) => (
                          <div key={`${part.text}-${index}`} className="flex items-center gap-2">
                            {index > 0 && <span className="text-2xl text-ink/25">+</span>}
                            {terminal ? (
                              <span title={part.meaning} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-xl font-bold text-emerald-800">{part.text}</span>
                            ) : (
                              <button type="button" aria-pressed={selectedLookups.includes(part.lookup)} onClick={() => toggleMorpheme(resultIndex, result.word, part.lookup)} title={`${part.meaning}\n눌러서 상세 정보 열기/닫기`} className={`group relative rounded-2xl border px-5 py-3 text-xl font-bold transition hover:-translate-y-1 ${selectedLookups.includes(part.lookup) ? "border-moss bg-moss text-white shadow-md" : "border-moss/20 bg-moss/5 text-moss hover:bg-moss hover:text-white"}`}>
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

                      {result.article && <p className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><strong>왜 {result.article}일까요?</strong> {articleReasonText(result.articleReason, result.article) ?? "-"}</p>}

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
                              {example.source === "generated" && <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider text-ink/35">자동 보완 예문</span>}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {!!selectedParts.length && (
                        <MorphemeComparisonGrid
                          key={`${result.word}:${selectedParts.map((part) => part.lookup).join("+")}`}
                          parts={selectedParts}
                          onExplore={(word) => void search(word, results.slice(0, resultIndex + 1))}
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
                <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                  <thead className="bg-paper text-[10px] uppercase tracking-[0.18em] text-ink/45">
                    <tr><th className="px-5 py-3">관사</th><th className="px-4 py-3">단어</th><th className="px-4 py-3">별표 유형</th><th className="px-4 py-3">뜻</th><th className="px-4 py-3">분해 요소</th><th className="px-5 py-3">관사 이유</th></tr>
                  </thead>
                  <tbody>
                    {favorites.map((item) => {
                      const parts = favoriteMorphemes(item);
                      const types = favoriteTypes(item);
                      return (
                        <tr key={item.word} className="border-t border-ink/10 align-top">
                          <td className="px-5 py-5">
                            {item.article ? <span className={`inline-flex min-w-12 justify-center rounded-xl border px-3 py-1.5 font-serif text-base font-bold ${articleStyle[item.article]}`}>{item.article}</span> : <span className="pl-3 text-ink/30">—</span>}
                          </td>
                          <td className="px-4 py-5">
                            <button type="button" onClick={() => openFavorite(item.word)} className="whitespace-nowrap font-serif text-lg font-bold underline decoration-moss/25 underline-offset-4 transition hover:text-moss">{item.word} →</button>
                          </td>
                          <td className="px-4 py-5">
                            <div className="flex flex-wrap gap-1.5">
                              <button type="button" disabled={favoriteRequestKey === `${normalizedWord(item.word)}:meaning`} onClick={() => void toggleFavoriteByWord(item.word, "meaning")} aria-pressed={types.includes("meaning")} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-50 ${types.includes("meaning") ? "border-amber-300 bg-amber-100 text-amber-800" : "border-ink/15 bg-white text-ink/45 hover:bg-amber-50"}`}>{types.includes("meaning") ? "★ 뜻" : "☆ 뜻"}</button>
                              <button type="button" disabled={!item.article || favoriteRequestKey === `${normalizedWord(item.word)}:article`} onClick={() => void toggleFavoriteByWord(item.word, "article")} aria-pressed={types.includes("article")} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-35 ${types.includes("article") ? "border-blue-300 bg-blue-100 text-blue-800" : "border-ink/15 bg-white text-ink/45 hover:bg-blue-50"}`}>{types.includes("article") ? "★ 관사" : "☆ 관사"}</button>
                            </div>
                          </td>
                          <td className="max-w-sm px-4 py-5 leading-6 text-ink/65">{item.meaning}</td>
                          <td className="min-w-48 px-4 py-5">
                            {parts.length ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {parts.map((part, index) => (
                                  <span key={`${part.lookup}-${index}`} className="flex items-center gap-1.5">
                                    {index > 0 && <span className="text-ink/25">+</span>}
                                    <button type="button" data-favorite-popover-trigger onClick={(event) => void openFavoritePart(item.word, part, event.currentTarget)} className="rounded-lg border border-moss/20 bg-moss/5 px-2.5 py-1.5 font-bold text-moss transition hover:bg-moss hover:text-white">{part.text}</button>
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-ink/35">{item.morphemes?.length || item.decomposition ? "분해 완료" : "상세 검색에서 확인"}</span>}
                          </td>
                          <td className="max-w-xs px-5 py-5 text-xs leading-5 text-ink/55">{articleReasonText(item.articleReason, item.article) ?? "-"}</td>
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
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <p className="max-w-sm text-sm leading-6 text-blue-900/60">각 단계는 전체 화면에서 진행됩니다. 저장한 명사와 수준별 무작위 단어 중 8문제를 출제합니다.</p>
                  <button type="button" onClick={startArticleQuiz} className="mt-5 rounded-xl bg-blue-950 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-moss">전체 화면 퀴즈 시작 →</button>
                </div>
              </div>
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

      {articleQuizOpen && articleQuestion && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-paper text-ink">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-6 sm:px-8 sm:py-10">
            <header className="flex items-center justify-between border-b border-ink/15 pb-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700/60">Artikel-Quiz · {articleQuizRound === "retry" ? "오답 재도전" : level}</p>
                <p className="mt-1 font-serif text-xl font-bold">der, die oder das?</p>
              </div>
              <button type="button" onClick={() => setArticleQuizOpen(false)} aria-label="관사 퀴즈 닫기" className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 bg-white text-2xl text-ink/55 transition hover:text-ink">×</button>
            </header>

            {articleQuizFinished ? (
              <div className="grid flex-1 place-items-center py-12 text-center">
                <div className="w-full max-w-lg rounded-[2rem] border border-blue-200 bg-white p-8 shadow-card sm:p-12">
                  <p className="text-sm font-bold text-blue-800">{articleQuizRound === "retry" ? "오답 재도전 완료" : "퀴즈 완료"}</p>
                  <p className="mt-3 font-serif text-6xl font-bold">{articleScore} / {articleQuestions.length}</p>
                  <p className="mt-4 text-sm leading-6 text-ink/55">{wrongArticleQuestions.length ? `${wrongArticleQuestions.length}개 단어를 다시 연습할 수 있습니다.` : "모든 관사를 정확히 맞혔습니다!"}</p>
                  <div className="mt-8 grid gap-3">
                    {!!wrongArticleQuestions.length && <button type="button" onClick={retryWrongArticles} className="rounded-2xl bg-coral px-6 py-4 text-base font-bold text-white transition hover:bg-[#c95e52]">틀린 단어만 다시 풀기 →</button>}
                    <button type="button" onClick={startArticleQuiz} className="rounded-2xl border border-ink/15 bg-white px-6 py-4 text-base font-bold transition hover:bg-paper">새 문제 8개 풀기</button>
                    <button type="button" onClick={() => setArticleQuizOpen(false)} className="px-4 py-2 text-sm font-bold text-ink/50 underline underline-offset-4">퀴즈 종료</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-center py-8 sm:py-12">
                <div className="mb-4 flex items-center justify-between text-xs font-bold text-ink/45">
                  <span>{articleQuestionIndex + 1} / {articleQuestions.length}</span>
                  <span>점수 {articleScore}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/10"><div style={{ width: `${((articleQuestionIndex + 1) / articleQuestions.length) * 100}%` }} className="h-full rounded-full bg-blue-700 transition-all" /></div>

                <section className="mt-6 rounded-[2rem] border border-ink/10 bg-white p-6 shadow-card sm:p-10">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-ink/35">Welcher Artikel?</p>
                      <h2 className="mt-3 font-serif text-5xl font-bold sm:text-7xl">{articleQuestion.word}</h2>
                    </div>
                    <div className="flex flex-col items-end gap-2 sm:flex-row">
                      <button type="button" disabled={favoriteRequestKey === `${normalizedWord(articleQuestion.word)}:meaning`} onClick={() => void toggleFavoriteByWord(articleQuestion.word, "meaning")} aria-pressed={hasFavoriteType(articleQuestion.word, "meaning")} className={`rounded-full border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${hasFavoriteType(articleQuestion.word, "meaning") ? "border-amber-300 bg-amber-100 text-amber-800" : "border-ink/15 bg-white hover:bg-amber-50"}`}>{hasFavoriteType(articleQuestion.word, "meaning") ? "★ 뜻 단어" : "☆ 뜻을 모름"}</button>
                      <button type="button" disabled={favoriteRequestKey === `${normalizedWord(articleQuestion.word)}:article`} onClick={() => void toggleFavoriteByWord(articleQuestion.word, "article")} aria-pressed={hasFavoriteType(articleQuestion.word, "article")} className={`rounded-full border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${hasFavoriteType(articleQuestion.word, "article") ? "border-blue-300 bg-blue-100 text-blue-800" : "border-ink/15 bg-white hover:bg-blue-50"}`}>{hasFavoriteType(articleQuestion.word, "article") ? "★ 관사 단어" : "☆ 관사를 모름"}</button>
                    </div>
                  </div>

                  <div className="mt-7 min-h-14">
                    {articleHintVisible ? <p className="rounded-xl bg-paper px-4 py-3 text-sm text-ink/65"><strong>뜻:</strong> {articleQuestion.meaning}</p> : <button type="button" onClick={() => setArticleHintVisible(true)} className="rounded-full border border-ink/15 px-4 py-2 text-sm font-bold transition hover:bg-paper">뜻 보기</button>}
                  </div>

                  <div className="mt-6 grid grid-cols-3 gap-3">
                    {(["der", "die", "das"] as DefiniteArticle[]).map((choice) => {
                      const correct = Boolean(articleAnswer) && choice === articleQuestion.article;
                      const wrong = articleAnswer === choice && choice !== articleQuestion.article;
                      return <button type="button" key={choice} disabled={Boolean(articleAnswer)} onClick={() => answerArticle(choice)} className={`rounded-2xl border px-3 py-4 font-serif text-2xl font-bold transition sm:py-5 sm:text-3xl ${correct ? "border-emerald-600 bg-emerald-100 text-emerald-900" : wrong ? "border-red-500 bg-red-100 text-red-900" : "border-ink/15 bg-white hover:-translate-y-0.5 hover:border-blue-500 hover:text-blue-800"}`}>{choice}</button>;
                    })}
                  </div>

                  {articleAnswer && (
                    <div role="status" className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
                      <p className="text-base font-bold">{articleAnswer === articleQuestion.article ? "정답입니다!" : `정답은 ${articleQuestion.article}입니다.`}</p>
                      <p className="mt-2 text-blue-950/70">{articleQuestion.reason}</p>
                      <button type="button" onClick={nextArticleQuestion} className="mt-5 w-full rounded-2xl bg-blue-950 px-6 py-4 text-base font-bold text-white shadow-md transition hover:bg-moss">{articleQuestionIndex + 1 === articleQuestions.length ? "결과 확인하기 →" : "다음 문제 →"}</button>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {favoritePopover && (
        <aside ref={favoritePopoverRef} role="dialog" aria-label={`${favoritePopover.part.text} 빠른 설명`} style={{ top: favoritePopover.top, left: favoritePopover.left }} className="fixed z-50 w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border border-ink/15 bg-white p-4 shadow-2xl">
            <span aria-hidden className="absolute -top-2 left-8 h-4 w-4 rotate-45 border-l border-t border-ink/15 bg-white" />
            <button type="button" onClick={() => setFavoritePopover(null)} aria-label="닫기" className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-paper text-ink/55 hover:text-ink">×</button>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40">{favoritePopover.owner}의 구성 요소</p>
            <h2 className="mt-1 pr-10 font-serif text-2xl font-bold text-moss">{favoritePopover.part.text}</h2>
            {favoritePopover.loading && <p className="mt-4 animate-pulse text-sm text-ink/45">요소 정보를 불러오는 중…</p>}
            {favoritePopover.error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800">{favoritePopover.error}</p>}
            {favoritePopover.result && (
              <>
                <p className="mt-3 line-clamp-3 text-xs leading-5 text-ink/65">{favoritePopover.result.meanings[0]}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {favoritePopover.result.morphemes.map((part, index) => <span key={`${part.lookup}-${index}`} className="flex items-center gap-2 text-sm font-bold text-moss">{index > 0 && <span className="text-ink/25">+</span>}<span className="rounded-lg bg-moss/5 px-2.5 py-1.5">{part.text}</span></span>)}
                  {isTerminalResult(favoritePopover.result) && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-900">분해 완료</span>}
                </div>
                <button type="button" onClick={() => openFavorite(favoritePopover.result!.word)} className="mt-4 w-full rounded-xl bg-ink px-4 py-2.5 text-xs font-bold text-white transition hover:bg-moss">메인 검색창에서 상세 검색 →</button>
              </>
            )}
        </aside>
      )}
    </main>
  );
}
