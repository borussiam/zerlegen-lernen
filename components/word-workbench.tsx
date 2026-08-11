"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, FormEvent, KeyboardEvent } from "react";
import type { CefrLevel, FavoriteType, FavoriteWord, GeneratedExercise, Morpheme, ParseResult, VocabularyIndexEntry } from "@/lib/types";
import { articleReasonText, buildArticleQuizQuestions, isCorrectArticleAnswer, shuffleItems } from "@/lib/article-quiz";
import type { ArticleQuizMode, ArticleQuizQuestion, DefiniteArticle } from "@/lib/article-quiz";
import { filterAndSortFavorites, getFavoriteTypes, isAffixWord, matchVocabulary, vocabularyForRandom } from "@/lib/vocabulary";
import type { FavoriteFilter, FavoriteSort, RandomLevelRange } from "@/lib/vocabulary";

const STORAGE_KEY = "zerlegen-lernen:favorites";
const HISTORY_KEY = "zerlegen-lernen:results";
const WORD_CACHE_KEY = "zerlegen-lernen:word-cache:v6";
const WORD_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const WORD_CACHE_MAX_ENTRIES = 100;
const CLIENT_REQUEST_DELAY_MS = 175;

const articleStyle = {
  der: "bg-blue-100 text-blue-700 border-blue-200",
  die: "bg-rose-100 text-rose-700 border-rose-200",
  das: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const levelStyle: Record<CefrLevel, string> = {
  A1: "border-emerald-300 bg-emerald-50 text-emerald-800",
  A2: "border-sky-300 bg-sky-50 text-sky-800",
  B1: "border-amber-300 bg-amber-50 text-amber-900",
  B2: "border-violet-300 bg-violet-50 text-violet-800",
};

interface FavoritePartPopover {
  owner: string;
  part: Morpheme;
  top: number;
  left: number;
  loading: boolean;
  result?: ParseResult;
  error?: string;
}

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

function favoriteFromResult(
  result: ParseResult,
  types: FavoriteType[],
  existing?: FavoriteWord,
): FavoriteWord {
  return {
    word: result.word,
    article: result.article,
    meaning: result.meanings[0],
    decomposition: result.morphemes.map((part) => part.text).join(" + "),
    partOfSpeech: result.partOfSpeech,
    morphemes: result.morphemes,
    articleReason: result.articleReason,
    favoriteTypes: types,
    level: result.level ?? existing?.level ?? null,
    addedAt: existing?.addedAt ?? Date.now(),
  };
}

function isVocabularyEntry(value: unknown): value is VocabularyIndexEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VocabularyIndexEntry>;
  return typeof entry.word === "string"
    && typeof entry.meaning === "string"
    && (entry.level === null || entry.level === "A1" || entry.level === "A2" || entry.level === "B1" || entry.level === "B2");
}

function isFavoriteWord(value: unknown): value is FavoriteWord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FavoriteWord>;
  return typeof item.word === "string" && typeof item.meaning === "string";
}

function vocabularyEntryFromResult(result: ParseResult): VocabularyIndexEntry {
  return {
    word: result.word,
    article: result.article,
    partOfSpeech: result.partOfSpeech,
    level: result.level ?? null,
    meaning: result.meanings[0] ?? "",
    articleReason: result.articleReason,
  };
}

function LevelBadge({ level }: { level?: CefrLevel | null }) {
  return level
    ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black tracking-[0.12em] ${levelStyle[level]}`}>{level}</span>
    : <span className="inline-flex rounded-full border border-ink/15 bg-paper px-2.5 py-1 text-[10px] font-bold text-ink/40">미분류</span>;
}

function FavoriteGlyph({ type }: { type: FavoriteType }) {
  return type === "meaning" ? (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="m12 2.4 2.83 5.73 6.32.92-4.57 4.45 1.08 6.29L12 16.82l-5.66 2.97 1.08-6.29-4.57-4.45 6.32-.92L12 2.4Z" />
    </svg>
  ) : (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-[2.2]">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5A2.5 2.5 0 0 1 7 3h5v16H7a2.5 2.5 0 0 0-2.5 2V5.5Zm15 0A2.5 2.5 0 0 0 17 3h-5v16h5a2.5 2.5 0 0 1 2.5 2V5.5Z" />
    </svg>
  );
}

function FavoriteToggle({
  type,
  active,
  disabled,
  compact = false,
  onClick,
}: {
  type: FavoriteType;
  active: boolean;
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const meaning = type === "meaning";
  const label = meaning ? "뜻 모름" : "관사 모름";
  const palette = meaning
    ? active
      ? "border-blue-700 bg-blue-700 text-white shadow-sm"
      : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
    : active
      ? "border-orange-600 bg-orange-600 text-white shadow-sm"
      : "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} ${active ? "해제" : "등록"}`}
      title={`${label} ${active ? "해제" : "등록"}`}
      className={`inline-flex items-center justify-center gap-2 rounded-full border font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${compact ? "h-10 w-10 p-0" : "px-4 py-2 text-sm"} ${palette}`}
    >
      <FavoriteGlyph type={type} />
      {!compact && <span>{label}</span>}
    </button>
  );
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

  const request = fetch(`/api/parse?word=${encodeURIComponent(key)}&v=6`, {
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
  hasFavoriteType,
  onToggleFavorite,
}: {
  parts: Morpheme[];
  onExplore: (word: string) => void;
  hasFavoriteType: (word: string, type: FavoriteType) => boolean;
  onToggleFavorite: (result: ParseResult, type: FavoriteType) => void;
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

          return (
            <article key={`${part.lookup}-${index}`} className="rounded-2xl border border-ink/10 bg-paper/65 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/40">{part.kind}</p>
                  <h4 className="mt-1 font-serif text-2xl font-bold text-moss">{part.text}</h4>
                </div>
                {child && (
                  <div className="flex items-center gap-2">
                    <FavoriteToggle compact type="meaning" active={hasFavoriteType(child.word, "meaning")} onClick={() => onToggleFavorite(child, "meaning")} />
                    <FavoriteToggle compact type="article" active={hasFavoriteType(child.word, "article")} disabled={!child.article} onClick={() => onToggleFavorite(child, "article")} />
                  </div>
                )}
              </div>

              {!preview && <p className="mt-5 animate-pulse text-sm text-ink/40">요소 정보를 불러오는 중…</p>}
              {preview?.error && <p className="mt-5 text-sm leading-6 text-red-700">{preview.error}</p>}
              {child && (
                <>
                  <div className="mt-4 flex items-center gap-2">
                    {child.article && <span className={`rounded-lg border px-2 py-1 font-serif text-sm font-bold ${articleStyle[child.article]}`}>{child.article}</span>}
                    {child.partOfSpeech && <span className="text-xs uppercase tracking-wider text-ink/45">{child.partOfSpeech}</span>}
                    <LevelBadge level={child.level} />
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
                  <button type="button" onClick={() => onExplore(child.word)} className="mt-5 rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-bold transition hover:border-moss hover:text-moss">자세히 보기 →</button>
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
  const [vocabulary, setVocabulary] = useState<VocabularyIndexEntry[]>([]);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(-1);
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>("all");
  const [favoriteSort, setFavoriteSort] = useState<FavoriteSort>("recent");
  const [randomLevelRange, setRandomLevelRange] = useState<RandomLevelRange>("A1-B2");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState<CefrLevel>("A2");
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
  const [articleQuizMode, setArticleQuizMode] = useState<ArticleQuizMode>("database");
  const [expandedMorphemes, setExpandedMorphemes] = useState<Record<string, string[]>>({});
  const [favoriteRequestKey, setFavoriteRequestKey] = useState<string | null>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);

  const autocompleteMatches = useMemo(
    () => matchVocabulary(vocabulary, query),
    [query, vocabulary],
  );
  const visibleFavorites = useMemo(
    () => filterAndSortFavorites(favorites, favoriteFilter, favoriteSort),
    [favoriteFilter, favoriteSort, favorites],
  );
  const favoriteNounCount = useMemo(
    () => favorites.filter((item) => Boolean(item.article)).length,
    [favorites],
  );
  const databaseNounCount = useMemo(
    () => vocabulary.filter((item) => item.level === level && Boolean(item.article)).length,
    [level, vocabulary],
  );
  const randomCandidates = useMemo(
    () => vocabularyForRandom(vocabulary, randomLevelRange),
    [randomLevelRange, vocabulary],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsed = saved ? JSON.parse(saved) as unknown : [];
        if (Array.isArray(parsed)) {
          const stored = parsed.filter(isFavoriteWord);
          const now = Date.now();
          setFavorites(stored.map((item, index) => ({
            ...item,
            favoriteTypes: getFavoriteTypes(item),
            level: isAffixWord(item.word, item.partOfSpeech) ? null : item.level,
            addedAt: item.addedAt ?? now - ((stored.length - index) * 1_000),
          })));
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/words", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("단어 목록을 불러오지 못했습니다.");
        const data = await response.json() as unknown;
        if (!Array.isArray(data) || !data.every(isVocabularyEntry)) {
          throw new Error("단어 목록 형식이 올바르지 않습니다.");
        }
        if (!cancelled) setVocabulary(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "단어 목록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!vocabulary.length) return;
    const levels = new Map(vocabulary.map((entry) => [normalizedWord(entry.word), entry.level]));
    setFavorites((current) => {
      let changed = false;
      const next = current.map((item) => {
        if (isAffixWord(item.word, item.partOfSpeech)) {
          if (item.level === null) return item;
          changed = true;
          return { ...item, level: null };
        }
        if (item.level) return item;
        const levelForWord = levels.get(normalizedWord(item.word));
        if (!levelForWord) return item;
        changed = true;
        return { ...item, level: levelForWord };
      });
      if (changed) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // The in-memory wordbook remains available if storage is unavailable.
        }
      }
      return changed ? next : current;
    });
  }, [vocabulary]);

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
      const types = existing ? getFavoriteTypes(existing) : [];
      const nextTypes = types.includes(type) ? types : [...types, type];
      const nextFavorite = favoriteFromResult(result, nextTypes, existing);
      return existing
        ? current.map((item) => normalizedWord(item.word) === key ? nextFavorite : item)
        : [...current, nextFavorite];
    });
  }

  function removeFavoriteType(word: string, type: FavoriteType) {
    const key = normalizedWord(word);
    updateFavorites((current) => current.flatMap((item): FavoriteWord[] => {
      if (normalizedWord(item.word) !== key) return [item];
      const nextTypes = getFavoriteTypes(item).filter((favoriteType) => favoriteType !== type);
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
          ? favoriteFromResult(result, getFavoriteTypes(item), item)
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
    setAutocompleteOpen(false);
    setAutocompleteIndex(-1);
    setQuery(cleanWord);
    setLoading(true);
    setError("");
    try {
      const data = await requestWord(cleanWord);
      const entry = vocabularyEntryFromResult(data);
      const entryKey = normalizedWord(entry.word);
      setVocabulary((current) => {
        const existingIndex = current.findIndex((item) => normalizedWord(item.word) === entryKey);
        if (existingIndex < 0) return [...current, entry];
        const next = [...current];
        next[existingIndex] = entry;
        return next;
      });
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
    if (autocompleteOpen && autocompleteIndex >= 0) {
      const selected = autocompleteMatches[autocompleteIndex];
      if (selected) {
        void search(selected.word);
        return;
      }
    }
    void search();
  }

  function searchRandomWord() {
    if (!randomCandidates.length) return;
    const random = randomCandidates[Math.floor(Math.random() * randomCandidates.length)];
    if (random) void search(random.word);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!autocompleteOpen || !autocompleteMatches.length) {
      if (event.key === "ArrowDown" && autocompleteMatches.length) {
        setAutocompleteOpen(true);
        setAutocompleteIndex(0);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      setAutocompleteIndex((index) => (index + 1) % autocompleteMatches.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      setAutocompleteIndex((index) => (index <= 0 ? autocompleteMatches.length - 1 : index - 1));
      event.preventDefault();
    } else if (event.key === "Escape") {
      setAutocompleteOpen(false);
      setAutocompleteIndex(-1);
    }
  }

  function handleSearchBlur(event: FocusEvent<HTMLFormElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setAutocompleteOpen(false);
      setAutocompleteIndex(-1);
    }
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
    const next = buildArticleQuizQuestions({
      mode: articleQuizMode,
      level,
      favorites,
      vocabulary,
    });
    if (!next.length) {
      setError(articleQuizMode === "favorites"
        ? "관사가 있는 단어를 단어장에 먼저 저장해 주세요."
        : `${level} 명사 데이터를 불러오지 못했습니다.`);
      return;
    }

    setError("");
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
    const question = articleQuestions[articleQuestionIndex];
    if (question && isCorrectArticleAnswer(question, answer)) {
      setArticleScore((score) => score + 1);
    } else {
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
    setArticleQuestions(shuffleItems(wrongArticleQuestions));
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
    return favorite ? getFavoriteTypes(favorite).includes(type) : false;
  }

  const articleQuestion = articleQuestions[articleQuestionIndex];
  const autocompleteVisible = autocompleteOpen && Boolean(query.trim()) && autocompleteMatches.length > 0;

  return (
    <main className="min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <nav className="mx-auto flex max-w-6xl items-center border-b border-ink/15 pb-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-lg text-paper">ZL</span>
          <div>
            <p className="font-serif text-xl font-bold leading-none">zerlegen lernen</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-ink/50">Deutsch, Stück für Stück</p>
          </div>
        </div>
      </nav>

      <div role="tablist" aria-label="학습 화면" className="mx-auto mt-6 flex max-w-6xl gap-2 rounded-[1.4rem] border border-ink/15 bg-white/70 p-2 shadow-sm">
        <button type="button" role="tab" aria-selected={activeTab === "explore"} onClick={() => setActiveTab("explore")} className={`flex-1 rounded-2xl border px-5 py-3.5 text-base font-bold transition ${activeTab === "explore" ? "border-ink bg-ink text-white shadow-md" : "border-transparent text-ink/65 hover:border-ink/10 hover:bg-white"}`}>탐색</button>
        <button type="button" role="tab" aria-selected={activeTab === "favorites"} onClick={() => setActiveTab("favorites")} className={`flex-1 rounded-2xl border px-5 py-3.5 text-base font-bold transition ${activeTab === "favorites" ? "border-ink bg-ink text-white shadow-md" : "border-transparent text-ink/65 hover:border-ink/10 hover:bg-white"}`}>단어장</button>
      </div>

      {error && <div role="alert" className="mx-auto mt-6 max-w-6xl rounded-2xl border border-coral/30 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {activeTab === "explore" && (
        <>
          <div className="sticky top-0 z-40 -mx-5 mt-5 border-y border-ink/10 bg-paper/90 px-5 py-3 shadow-sm backdrop-blur-xl sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
            <form ref={searchFormRef} suppressHydrationWarning onSubmit={submit} onBlur={handleSearchBlur} className="relative mx-auto max-w-6xl">
              <label htmlFor="word" className="sr-only">독일어 단어 검색</label>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <div className="relative min-w-0 basis-full sm:flex-1">
                  <input
                    suppressHydrationWarning
                    id="word"
                    name="word"
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="word-suggestions"
                    aria-expanded={autocompleteVisible}
                    aria-activedescendant={autocompleteIndex >= 0 ? `word-option-${autocompleteIndex}` : undefined}
                    value={query}
                    onFocus={() => query.trim() && setAutocompleteOpen(true)}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setAutocompleteOpen(true);
                      setAutocompleteIndex(-1);
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="독일어 단어 검색"
                    autoComplete="off"
                    className="w-full rounded-2xl border border-ink/10 bg-white px-5 py-3.5 text-base outline-none ring-moss/30 transition focus:border-moss focus:ring-4"
                  />
                  {autocompleteVisible && (
                    <div id="word-suggestions" role="listbox" aria-label="단어 자동완성" className="absolute inset-x-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-ink/15 bg-white p-2 shadow-2xl">
                      {autocompleteMatches.map((entry, index) => (
                        <button
                          type="button"
                          role="option"
                          id={`word-option-${index}`}
                          aria-selected={autocompleteIndex === index}
                          key={`${entry.word}-${entry.partOfSpeech ?? "word"}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void search(entry.word)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${autocompleteIndex === index ? "bg-moss text-white" : "hover:bg-paper"}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              {entry.article && <span className="font-serif text-sm font-bold">{entry.article}</span>}
                              <span className="truncate font-serif text-lg font-bold">{entry.word}</span>
                            </span>
                            <span className={`block truncate text-xs ${autocompleteIndex === index ? "text-white/70" : "text-ink/45"}`}>{entry.meaning}</span>
                          </span>
                          <LevelBadge level={entry.level} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label htmlFor="random-level-range" className="sr-only">랜덤 단어 난이도 범위</label>
                <select suppressHydrationWarning id="random-level-range" value={randomLevelRange} onChange={(event) => setRandomLevelRange(event.target.value as RandomLevelRange)} className="rounded-2xl border border-orange-300 bg-white px-3 py-3 text-sm font-bold text-orange-800 outline-none focus:ring-4 focus:ring-orange-200">
                  <option value="A1-B2">A1–B2</option>
                  <option value="A1-A2">A1–A2</option>
                  <option value="B1-B2">B1–B2</option>
                  <option value="A1">A1</option>
                  <option value="A2">A2</option>
                  <option value="B1">B1</option>
                  <option value="B2">B2</option>
                </select>
                <button type="button" disabled={!randomCandidates.length || loading} onClick={searchRandomWord} className="flex-1 whitespace-nowrap rounded-2xl border border-orange-300 bg-orange-50 px-4 py-3 font-bold text-orange-800 transition hover:bg-orange-100 disabled:opacity-40 sm:flex-none">랜덤 단어</button>
                <button type="submit" disabled={loading} className="flex-1 whitespace-nowrap rounded-2xl bg-ink px-5 py-3 font-bold text-white transition hover:bg-moss disabled:opacity-50 sm:flex-none">{loading ? "검색 중…" : "검색"}</button>
              </div>
            </form>
          </div>

          {!results.length && !loading && (
            <section className="mx-auto grid min-h-[48vh] max-w-6xl place-items-center py-16 text-center">
              <div>
                <p className="font-serif text-3xl font-bold">단어를 검색해 분해해 보세요.</p>
                <p className="mt-3 text-sm text-ink/50">2,500개 핵심 단어 자동완성과 랜덤 검색을 사용할 수 있습니다.</p>
              </div>
            </section>
          )}

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

              <div className="space-y-6 pt-8">
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
                      <div className="flex flex-wrap items-start justify-between gap-5">
                        <div>
                          <div className="flex items-center gap-3 sm:gap-4">
                            {result.article && <span className={`rounded-2xl border px-4 py-1.5 font-serif text-xl font-bold leading-none shadow-sm sm:text-2xl ${articleStyle[result.article]}`}>{result.article}</span>}
                            <h2 className="font-serif text-4xl font-bold sm:text-5xl">{result.word}</h2>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {result.partOfSpeech && <p className="text-xs uppercase tracking-widest text-ink/45">{result.partOfSpeech}</p>}
                            <LevelBadge level={result.level} />
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <FavoriteToggle type="meaning" active={meaningFavorite} onClick={() => toggleFavoriteType(result, "meaning")} />
                          {result.article && <FavoriteToggle type="article" active={articleFavorite} onClick={() => toggleFavoriteType(result, "article")} />}
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
                        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-coral">{result.examples.some((example) => example.kind === "word") ? "Beispielwörter · 예시 단어" : "Beispiel · 예문"}</h3>
                        <ul className="space-y-4">
                          {result.examples.map((example, index) => (
                            <li key={`${example.sentence}-${index}`} className="text-sm leading-6 text-ink/75">
                              <p className="font-medium">{example.kind === "word" ? example.sentence : `„${example.sentence}“`}</p>
                              {example.translation && <p className="mt-1 text-ink/50">{example.translation}</p>}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {!!selectedParts.length && (
                        <MorphemeComparisonGrid
                          key={`${result.word}:${selectedParts.map((part) => part.lookup).join("+")}`}
                          parts={selectedParts}
                          onExplore={(word) => void search(word, results.slice(0, resultIndex + 1))}
                          hasFavoriteType={hasFavoriteType}
                          onToggleFavorite={toggleFavoriteType}
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
        <section className="-mx-5 space-y-8 pb-20 pt-10 sm:-mx-8 lg:-mx-12">
          <header className="flex flex-col gap-4 px-5 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-moss">Meine Wörter · 단어장</p>
              <h2 className="mt-2 font-serif text-3xl">저장한 단어</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="별표 유형 필터" className="flex rounded-xl border border-ink/15 bg-white p-1">
                {([
                  ["all", "전체"],
                  ["meaning", "뜻 모름"],
                  ["article", "관사 모름"],
                ] as const).map(([value, label]) => (
                  <button type="button" key={value} aria-pressed={favoriteFilter === value} onClick={() => setFavoriteFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${favoriteFilter === value ? "bg-ink text-white" : "text-ink/55 hover:bg-paper"}`}>{label}</button>
                ))}
              </div>
              <label htmlFor="favorite-sort" className="sr-only">단어장 정렬</label>
              <select suppressHydrationWarning id="favorite-sort" value={favoriteSort} onChange={(event) => setFavoriteSort(event.target.value as FavoriteSort)} className="rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-moss">
                <option value="recent">최신 추가순</option>
                <option value="alphabetical">알파벳순</option>
              </select>
            </div>
          </header>

          {favorites.length ? (
            visibleFavorites.length ? (
              <div className="overflow-x-auto border-y border-ink/10 bg-white/85">
                <table className="w-full min-w-[1060px] border-collapse text-left text-sm">
                  <thead className="bg-paper text-[10px] uppercase tracking-[0.18em] text-ink/45">
                    <tr><th className="px-5 py-3 lg:px-12">관사</th><th className="px-4 py-3">단어</th><th className="px-4 py-3">수준</th><th className="px-4 py-3">학습</th><th className="px-4 py-3">뜻</th><th className="px-4 py-3">분해 요소</th><th className="px-5 py-3 lg:pr-12">관사 이유</th></tr>
                  </thead>
                  <tbody>
                    {visibleFavorites.map((item) => {
                      const parts = favoriteMorphemes(item);
                      const types = getFavoriteTypes(item);
                      return (
                        <tr key={item.word} className="border-t border-ink/10 align-top transition hover:bg-paper/45">
                          <td className="px-5 py-5 lg:pl-12">
                            {item.article ? <span className={`inline-flex min-w-12 justify-center rounded-xl border px-3 py-1.5 font-serif text-base font-bold ${articleStyle[item.article]}`}>{item.article}</span> : <span className="pl-3 text-ink/30">—</span>}
                          </td>
                          <td className="px-4 py-5">
                            <button type="button" onClick={() => openFavorite(item.word)} className="whitespace-nowrap font-serif text-lg font-bold underline decoration-moss/25 underline-offset-4 transition hover:text-moss">{item.word} →</button>
                          </td>
                          <td className="px-4 py-5"><LevelBadge level={item.level} /></td>
                          <td className="px-4 py-5">
                            <div className="flex gap-2">
                              <FavoriteToggle compact type="meaning" active={types.includes("meaning")} disabled={favoriteRequestKey === `${normalizedWord(item.word)}:meaning`} onClick={() => void toggleFavoriteByWord(item.word, "meaning")} />
                              <FavoriteToggle compact type="article" active={types.includes("article")} disabled={!item.article || favoriteRequestKey === `${normalizedWord(item.word)}:article`} onClick={() => void toggleFavoriteByWord(item.word, "article")} />
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
                            ) : <span className="text-ink/35">—</span>}
                          </td>
                          <td className="max-w-xs px-5 py-5 text-xs leading-5 text-ink/55 lg:pr-12">{articleReasonText(item.articleReason, item.article) ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="grid min-h-40 place-items-center border-y border-ink/10 bg-white/70 p-8 text-sm text-ink/45">선택한 조건에 맞는 단어가 없습니다.</div>
          ) : <div className="grid min-h-52 place-items-center border-y border-ink/10 bg-white/70 p-8 text-center text-sm leading-6 text-ink/45">탐색 결과에서 별표를 눌러<br />학습할 단어를 저장해 보세요.</div>}

          <div className="mx-auto grid max-w-6xl gap-6 px-5 sm:px-8 lg:grid-cols-2 lg:px-0">
            <div className="rounded-[2rem] border border-blue-200 bg-blue-50 p-7 text-blue-950 shadow-card sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-700/60">Artikel-Quiz · 관사 맞추기</p>
              <h2 className="mt-2 font-serif text-2xl font-bold">der, die oder das?</h2>
              <fieldset className="mt-6 grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">관사 퀴즈 출제 범위</legend>
                <label className={`cursor-pointer rounded-2xl border p-4 transition ${articleQuizMode === "favorites" ? "border-blue-800 bg-white shadow-sm" : "border-blue-200 bg-blue-100/50"}`}>
                  <input type="radio" name="article-quiz-mode" value="favorites" checked={articleQuizMode === "favorites"} onChange={() => setArticleQuizMode("favorites")} className="sr-only" />
                  <span className="block text-sm font-bold">내 단어장</span>
                  <span className="mt-1 block text-xs text-blue-900/55">명사 {favoriteNounCount}개</span>
                </label>
                <label className={`cursor-pointer rounded-2xl border p-4 transition ${articleQuizMode === "database" ? "border-blue-800 bg-white shadow-sm" : "border-blue-200 bg-blue-100/50"}`}>
                  <input type="radio" name="article-quiz-mode" value="database" checked={articleQuizMode === "database"} onChange={() => setArticleQuizMode("database")} className="sr-only" />
                  <span className="block text-sm font-bold">전체 DB 랜덤</span>
                  <span className="mt-1 block text-xs text-blue-900/55">{level} 명사 {databaseNounCount}개</span>
                </label>
              </fieldset>
              {articleQuizMode === "database" && (
                <div className="mt-4 flex items-center justify-between rounded-xl bg-white/65 px-4 py-3">
                  <label htmlFor="article-level" className="text-xs font-bold">난이도</label>
                  <select suppressHydrationWarning id="article-level" name="article-level" value={level} onChange={(event) => setLevel(event.target.value as CefrLevel)} className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-950 outline-none">{(["A1", "A2", "B1", "B2"] as CefrLevel[]).map((item) => <option key={item} value={item}>{item}</option>)}</select>
                </div>
              )}
              <div className="mt-6 text-center">
                <button type="button" disabled={articleQuizMode === "favorites" ? !favoriteNounCount : !databaseNounCount} onClick={startArticleQuiz} className="w-full rounded-2xl bg-blue-950 px-6 py-4 text-base font-bold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-40">퀴즈 시작 →</button>
              </div>
            </div>

            <div className="rounded-[2rem] bg-ink p-7 text-white shadow-card sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Lückentest · 빈칸 퀴즈</p>
                {!!exercises.length && <button type="button" onClick={() => setShowAnswers((value) => !value)} className="text-xs font-bold underline underline-offset-4">{showAnswers ? "정답 숨기기" : "정답 보기"}</button>}
              </div>
              <div className="mt-5 flex gap-2">
                <select suppressHydrationWarning id="level" name="level" aria-label="퀴즈 난이도" value={level} onChange={(event) => setLevel(event.target.value as CefrLevel)} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none">{(["A1", "A2", "B1", "B2"] as CefrLevel[]).map((item) => <option className="text-ink" key={item} value={item}>{item}</option>)}</select>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700/60">Artikel-Quiz · {articleQuizRound === "retry" ? "오답 재도전" : articleQuizMode === "favorites" ? "내 단어장" : `${level} DB`}</p>
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
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <h2 className="font-serif text-5xl font-bold sm:text-7xl">{articleQuestion.word}</h2>
                        <LevelBadge level={articleQuestion.level} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <FavoriteToggle compact type="meaning" active={hasFavoriteType(articleQuestion.word, "meaning")} disabled={favoriteRequestKey === `${normalizedWord(articleQuestion.word)}:meaning`} onClick={() => void toggleFavoriteByWord(articleQuestion.word, "meaning")} />
                      <FavoriteToggle compact type="article" active={hasFavoriteType(articleQuestion.word, "article")} disabled={favoriteRequestKey === `${normalizedWord(articleQuestion.word)}:article`} onClick={() => void toggleFavoriteByWord(articleQuestion.word, "article")} />
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
                <div className="mt-2"><LevelBadge level={favoritePopover.result.level} /></div>
                <p className="mt-3 line-clamp-3 text-xs leading-5 text-ink/65">{favoritePopover.result.meanings[0]}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {favoritePopover.result.morphemes.map((part, index) => <span key={`${part.lookup}-${index}`} className="flex items-center gap-2 text-sm font-bold text-moss">{index > 0 && <span className="text-ink/25">+</span>}<span className="rounded-lg bg-moss/5 px-2.5 py-1.5">{part.text}</span></span>)}
                </div>
                <button type="button" onClick={() => openFavorite(favoritePopover.result!.word)} className="mt-4 w-full rounded-xl bg-ink px-4 py-2.5 text-xs font-bold text-white transition hover:bg-moss">메인 검색창에서 상세 검색 →</button>
              </>
            )}
        </aside>
      )}
    </main>
  );
}
