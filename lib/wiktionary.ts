import axios from "axios";
import * as cheerio from "cheerio";
import type { Article, Morpheme, MorphemeKind, ParseResult, WordExample } from "@/lib/types";

const WIKTIONARY_ORIGIN = "https://en.wiktionary.org";
const API_URL = `${WIKTIONARY_ORIGIN}/w/api.php`;
const USER_AGENT = "ZerlegenLernen/1.0 (https://github.com/borussiam/zerlegen-lernen) axios/1.19.0";
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 250;
const REQUEST_INTERVAL_MS = 175;
const MAX_RATE_LIMIT_RETRIES = 2;
const SECTION_HEADING_SELECTOR = ".mw-heading2, .mw-heading3, .mw-heading4, .mw-heading5";
const PART_OF_SPEECH = /^(?:Noun|Proper noun|Verb|Adjective|Adverb|Participle|Pronoun|Numeral|Interjection|Preposition|Conjunction|Prefix|Suffix|Affix|Infix|Interfix|Circumfix|Particle)(?: \d+)?$/i;

interface WiktionaryPage {
  pageid: number;
  title: string;
  missing?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  result: ParseResult;
}

interface WiktionaryRuntimeState {
  cache: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<ParseResult>>;
  requestQueue: Promise<void>;
  nextRequestAt: number;
}

const globalForWiktionary = globalThis as typeof globalThis & {
  __zerlegenWiktionaryState?: WiktionaryRuntimeState;
};

const runtimeState = globalForWiktionary.__zerlegenWiktionaryState ??= {
  cache: new Map(),
  inFlight: new Map(),
  requestQueue: Promise.resolve(),
  nextRequestAt: 0,
};

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function getCachedResult(key: string) {
  const entry = runtimeState.cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    runtimeState.cache.delete(key);
    return null;
  }

  runtimeState.cache.delete(key);
  runtimeState.cache.set(key, entry);
  return entry.result;
}

function setCachedResult(key: string, result: ParseResult) {
  runtimeState.cache.delete(key);
  while (runtimeState.cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = runtimeState.cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    runtimeState.cache.delete(oldestKey);
  }
  runtimeState.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

function enqueueWiktionaryRequest<T>(request: () => Promise<T>) {
  const queued = runtimeState.requestQueue.then(async () => {
    const waitTime = Math.max(0, runtimeState.nextRequestAt - Date.now());
    if (waitTime) await delay(waitTime);

    try {
      return await request();
    } finally {
      runtimeState.nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    }
  });

  runtimeState.requestQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function retryAfterMilliseconds(error: unknown) {
  if (!axios.isAxiosError(error)) return 0;
  const value = error.response?.headers?.["retry-after"];
  if (typeof value !== "string") return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

async function requestWiktionary(params: Record<string, string | number>) {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const response = await enqueueWiktionaryRequest(() => axios.get(API_URL, {
        params,
        timeout: 10_000,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Encoding": "gzip",
          Accept: "application/json",
        },
      }));
      const apiRateLimited = response.data?.error?.code === "ratelimited";
      if (!apiRateLimited) return response;
      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error("Wiktionary 요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.");
      }
      await delay(1_000 * (2 ** attempt));
    } catch (error) {
      const rateLimited = axios.isAxiosError(error) && error.response?.status === 429;
      if (!rateLimited || attempt === MAX_RATE_LIMIT_RETRIES) {
        if (rateLimited) {
          throw new Error("Wiktionary 요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.");
        }
        throw error;
      }

      const exponentialDelay = 1_000 * (2 ** attempt);
      await delay(Math.max(exponentialDelay, retryAfterMilliseconds(error)));
    }
  }

  throw new Error("Wiktionary 요청을 완료하지 못했습니다.");
}

function clean(text: string) {
  return text
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addExample(examples: WordExample[], sentence: string, translation: string | null = null) {
  const cleanSentence = clean(sentence);
  const cleanTranslation = translation ? clean(translation) : null;
  if (!cleanSentence || examples.some((example) => example.sentence === cleanSentence)) return;

  examples.push({
    sentence: cleanSentence,
    translation: cleanTranslation || null,
    source: "wiktionary",
  });
}

function generatedExample(word: string, partOfSpeech: string | null, article: Article): WordExample {
  const normalizedPart = partOfSpeech?.toLowerCase() ?? "";
  let sentence: string;

  if (normalizedPart.includes("suffix") || (word.startsWith("-") && !word.endsWith("-"))) {
    sentence = `Das Suffix „${word}“ bildet neue deutsche Wörter.`;
  } else if (normalizedPart.includes("prefix") || (word.endsWith("-") && !word.startsWith("-"))) {
    sentence = `Das Präfix „${word}“ steht am Anfang eines deutschen Wortes.`;
  } else if (normalizedPart.includes("adjective")) {
    sentence = `Das Beispiel ist ${word}.`;
  } else if (normalizedPart.includes("verb")) {
    sentence = `Ich möchte das Verb „${word}“ lernen.`;
  } else if (article) {
    sentence = `${article[0].toLocaleUpperCase("de-DE")}${article.slice(1)} ${word} ist in diesem Zusammenhang wichtig.`;
  } else {
    sentence = `Das deutsche Wort „${word}“ wird in diesem Beispiel verwendet.`;
  }

  return { sentence, translation: null, source: "generated" };
}

function getLinkedPage(href: string) {
  const url = new URL(href, WIKTIONARY_ORIGIN);
  let lookup = "";

  if (url.pathname.startsWith("/wiki/")) {
    lookup = decodeURIComponent(url.pathname.slice("/wiki/".length)).replace(/_/g, " ");
  } else if (url.pathname === "/w/index.php") {
    lookup = url.searchParams.get("title") ?? "";
  }

  return lookup ? { lookup, targetUrl: url.href } : null;
}

function getCaseCandidates(word: string) {
  const firstLetterIndex = word.search(/\p{L}/u);
  if (firstLetterIndex < 0) return [word];

  const firstLetter = word[firstLetterIndex];
  const prefix = word.slice(0, firstLetterIndex);
  const rest = word.slice(firstLetterIndex + firstLetter.length);
  return Array.from(new Set([
    word,
    `${prefix}${firstLetter.toLocaleLowerCase("de-DE")}${rest}`,
    `${prefix}${firstLetter.toLocaleUpperCase("de-DE")}${rest}`,
  ]));
}

function getMorphemeKind(term: string): MorphemeKind {
  if (term.startsWith("-") && !term.endsWith("-")) return "suffix";
  if (term.endsWith("-") && !term.startsWith("-")) return "prefix";
  return "root";
}

function morphemeMeaning(kind: MorphemeKind) {
  if (kind === "prefix") return "영어 Wiktionary 어원 링크에서 확인된 접두사입니다.";
  if (kind === "suffix") return "영어 Wiktionary 어원 링크에서 확인된 접미사입니다.";
  if (kind === "compound") return "영어 Wiktionary 어원 링크에서 확인된 복합어 구성 요소입니다.";
  return "영어 Wiktionary 어원 링크에서 확인된 기본형입니다.";
}

const ARTICLE_SUFFIX_RULES: Array<{ endings: string[]; article: Exclude<Article, null>; reason: string }> = [
  { endings: ["-ung", "-heit", "-keit", "-schaft", "-ion", "-tät", "-ik", "-ei", "-in"], article: "die", reason: "이 접미사로 끝나는 독일어 명사는 대체로 여성명사입니다." },
  { endings: ["-chen", "-lein", "-ment", "-um"], article: "das", reason: "이 접미사로 끝나는 독일어 명사는 대체로 중성명사입니다." },
  { endings: ["-er", "-ling", "-ismus"], article: "der", reason: "이 접미사로 만들어진 사람·행위자 명사는 대체로 남성명사입니다." },
];

function getArticleReason(word: string, article: Article, morphemes: Morpheme[]) {
  if (!article) return null;

  const explicitSuffixes = morphemes
    .filter((part) => part.kind === "suffix")
    .map((part) => part.lookup.toLocaleLowerCase("de-DE"));
  const normalizedWord = word.toLocaleLowerCase("de-DE");
  const matchedRule = ARTICLE_SUFFIX_RULES.find((rule) => (
    rule.article === article
    && rule.endings.some((ending) => explicitSuffixes.includes(ending) || normalizedWord.endsWith(ending.slice(1)))
  ));

  if (matchedRule) {
    const ending = matchedRule.endings.find((candidate) => (
      explicitSuffixes.includes(candidate) || normalizedWord.endsWith(candidate.slice(1))
    ));
    return `${ending} 규칙: ${matchedRule.reason} 영어 Wiktionary의 이 항목도 ${article}로 표기합니다.`;
  }

  if (morphemes.some((part) => part.kind === "compound")) {
    return `복합명사는 보통 마지막 기본어(Grundwort)의 성을 따릅니다. 영어 Wiktionary의 이 항목은 ${article}로 표기합니다.`;
  }

  return `영어 Wiktionary의 독일어 명사 성 표기에 따라 ${article}를 사용합니다. 뚜렷한 생산적 접미사 규칙이 없으면 단어와 관사를 함께 익히는 편이 안전합니다.`;
}

function extractModernEtymology($: cheerio.CheerioAPI) {
  for (const heading of $("h3, h4, h5").toArray()) {
    if (!/^Etymology(?: \d+)?$/i.test(clean($(heading).text()))) continue;

    const section = $(heading).closest(".mw-heading");
    const paragraphs = section.nextUntil(SECTION_HEADING_SELECTOR).filter("p");

    for (const paragraph of paragraphs.toArray()) {
      const html = $(paragraph).html() ?? "";
      const marker = /\bequivalent to\b/i.exec(html);
      const paragraphText = clean($(paragraph).text());
      if ((!marker || marker.index === undefined) && !paragraphText.includes("+")) continue;

      const fragmentHtml = marker?.index === undefined ? html : html.slice(marker.index);
      const fragment = cheerio.load(`<p>${fragmentHtml}</p>`);
      const linkedParts: Array<Morpheme & { targetUrl: string }> = [];
      const seen = new Set<string>();

      fragment("a[href]").each((_, anchor) => {
        const link = fragment(anchor);
        const href = link.attr("href");
        if (!href) return;

        const language = link.closest("[lang]").attr("lang");
        const linkedPage = getLinkedPage(href);
        if (!linkedPage || (language !== "de" && !linkedPage.targetUrl.endsWith("#German"))) return;
        if (!linkedPage.targetUrl.startsWith(`${WIKTIONARY_ORIGIN}/`)) return;

        const text = clean(link.text()) || linkedPage.lookup;
        const key = `${linkedPage.lookup}\n${linkedPage.targetUrl}`;
        if (seen.has(key)) return;
        seen.add(key);

        const kind = getMorphemeKind(linkedPage.lookup);
        linkedParts.push({
          text,
          lookup: linkedPage.lookup,
          targetUrl: linkedPage.targetUrl,
          kind,
          meaning: morphemeMeaning(kind),
        });
      });

      if (linkedParts.length >= 2) {
        const lexicalParts = linkedParts.filter((part) => part.kind === "root");
        if (lexicalParts.length > 1) {
          lexicalParts.slice(0, -1).forEach((part) => {
            part.kind = "compound";
            part.meaning = morphemeMeaning("compound");
          });
        }
        const decomposition = linkedParts.map((part) => part.text).join(" + ");
        return {
          etymology: marker ? `equivalent to ${decomposition}` : decomposition,
          morphemes: linkedParts,
        };
      }
    }
  }

  return { etymology: null, morphemes: [] as Morpheme[] };
}

function extractDefinitions($: cheerio.CheerioAPI) {
  const meanings: string[] = [];
  const examples: WordExample[] = [];
  let partOfSpeech: string | null = null;
  let article: Article = null;

  for (const heading of $("h3, h4, h5").toArray()) {
    const headingText = clean($(heading).text());
    if (!PART_OF_SPEECH.test(headingText)) continue;

    const contents = $(heading).closest(".mw-heading").nextUntil(SECTION_HEADING_SELECTOR);
    partOfSpeech ??= headingText.replace(/ \d+$/, "");

    if (!article && /^(?:Noun|Proper noun)(?: \d+)?$/i.test(headingText)) {
      const gender = clean(contents.find(".headword-line .gender abbr").first().text()).toLowerCase();
      if (gender.startsWith("m")) article = "der";
      else if (gender.startsWith("f")) article = "die";
      else if (gender.startsWith("n")) article = "das";
    }

    contents.filter("ol").first().children("li").each((_, item) => {
      $(item).find(".h-usage-example").each((__, usageExample) => {
        if (examples.length >= 3) return;
        const sentence = $(usageExample).find(".e-example").first().text();
        const translation = $(usageExample).find(".e-translation").first().text();
        addExample(examples, sentence, translation);
      });

      $(item).find(".affixusex").each((__, affixExample) => {
        if (examples.length >= 3) return;
        addExample(examples, $(affixExample).text());
      });

      if (meanings.length >= 5) return;
      const definition = $(item).clone();
      definition.find("style, script, noscript, table, audio, source, ul, ol, dl, blockquote, .mw-editsection, .reference, .citation-whole").remove();
      const value = clean(definition.text());
      if (value && !value.includes(".mw-parser-output") && !meanings.includes(value)) meanings.push(value);
    });
  }

  return { article, partOfSpeech, meanings, examples };
}

export function parseEnglishWiktionaryHtml(word: string, html: string): ParseResult {
  const page = cheerio.load(html);
  const germanHeading = page("h2")
    .filter((_, heading) => clean(page(heading).text()) === "German")
    .first()
    .closest(".mw-heading");

  if (!germanHeading.length) {
    throw new Error("영어 Wiktionary에서 독일어 항목을 찾을 수 없습니다.");
  }

  const germanHtml = germanHeading.nextUntil(".mw-heading2").toString();
  const $ = cheerio.load(`<section id="german-entry">${germanHtml}</section>`);
  const { article, partOfSpeech, meanings, examples } = extractDefinitions($);
  const { etymology, morphemes } = extractModernEtymology($);
  const standaloneKind = getMorphemeKind(word);
  const resolvedMorphemes = morphemes.length
    ? morphemes
    : [{
        text: word,
        lookup: word,
        targetUrl: `${WIKTIONARY_ORIGIN}/wiki/${encodeURIComponent(word)}#German`,
        kind: standaloneKind,
        meaning: standaloneKind === "root"
          ? "Wiktionary에 명시적인 현대 독일어 분해식이 없습니다."
          : morphemeMeaning(standaloneKind),
      } satisfies Morpheme];

  return {
    word,
    article,
    partOfSpeech,
    meanings: meanings.length ? meanings : ["영어 Wiktionary에서 정의를 자동 추출하지 못했습니다."],
    examples: examples.length ? examples : [generatedExample(word, partOfSpeech, article)],
    etymology,
    morphemes: resolvedMorphemes,
    sourceUrl: `${WIKTIONARY_ORIGIN}/wiki/${encodeURIComponent(word)}#German`,
    compoundHint: morphemes.some((part) => part.kind === "compound") && article
      ? "독일어 복합명사의 관사는 보통 마지막 명사(Grundwort)의 관사를 따릅니다."
      : null,
    articleReason: getArticleReason(word, article, resolvedMorphemes),
  };
}

async function parseGermanWordUncached(requestedWord: string): Promise<ParseResult> {
  const candidates = getCaseCandidates(requestedWord);
  const { data: queryData } = await requestWiktionary({
    action: "query",
    titles: candidates.join("|"),
    prop: "info",
    redirects: 1,
    format: "json",
    formatversion: 2,
  });

  if (queryData.error) {
    throw new Error(queryData.error.info ?? "영어 Wiktionary에서 단어를 찾을 수 없습니다.");
  }

  const pages = (queryData.query?.pages ?? []) as WiktionaryPage[];
  const page = candidates
    .map((candidate) => pages.find((item) => !item.missing && item.title === candidate))
    .find((item): item is WiktionaryPage => Boolean(item))
    ?? pages.find((item) => !item.missing && item.pageid > 0);

  if (!page) throw new Error("영어 Wiktionary에서 독일어 단어를 찾을 수 없습니다.");

  const { data: parseData } = await requestWiktionary({
    action: "parse",
    pageid: page.pageid,
    prop: "text",
    format: "json",
  });

  if (parseData.error || !parseData.parse?.text?.["*"]) {
    throw new Error(parseData.error?.info ?? "영어 Wiktionary에서 단어를 불러오지 못했습니다.");
  }

  return parseEnglishWiktionaryHtml(page.title, parseData.parse.text["*"] as string);
}

export async function parseGermanWord(input: string): Promise<ParseResult> {
  const requestedWord = input.trim().normalize("NFC");
  const cached = getCachedResult(requestedWord);
  if (cached) return cached;

  const existingRequest = runtimeState.inFlight.get(requestedWord);
  if (existingRequest) return existingRequest;

  const request = parseGermanWordUncached(requestedWord)
    .then((result) => {
      setCachedResult(requestedWord, result);
      if (result.word !== requestedWord) setCachedResult(result.word, result);
      return result;
    })
    .finally(() => {
      runtimeState.inFlight.delete(requestedWord);
    });

  runtimeState.inFlight.set(requestedWord, request);
  return request;
}
