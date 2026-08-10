import axios from "axios";
import * as cheerio from "cheerio";
import type { Article, Morpheme, MorphemeKind, ParseResult } from "@/lib/types";

const WIKTIONARY_ORIGIN = "https://en.wiktionary.org";
const API_URL = `${WIKTIONARY_ORIGIN}/w/api.php`;
const SECTION_HEADING_SELECTOR = ".mw-heading2, .mw-heading3, .mw-heading4, .mw-heading5";
const PART_OF_SPEECH = /^(?:Noun|Proper noun|Verb|Adjective|Adverb|Participle|Pronoun|Numeral|Interjection|Preposition|Conjunction)(?: \d+)?$/i;

function clean(text: string) {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function extractModernEtymology($: cheerio.CheerioAPI) {
  for (const heading of $("h3, h4, h5").toArray()) {
    if (!/^Etymology(?: \d+)?$/i.test(clean($(heading).text()))) continue;

    const section = $(heading).closest(".mw-heading");
    const paragraphs = section.nextUntil(SECTION_HEADING_SELECTOR).filter("p");

    for (const paragraph of paragraphs.toArray()) {
      const html = $(paragraph).html() ?? "";
      const marker = /\bequivalent to\b/i.exec(html);
      if (!marker || marker.index === undefined) continue;

      const fragment = cheerio.load(`<p>${html.slice(marker.index)}</p>`);
      const etymology = clean(fragment("p").text());
      const linkedParts: Array<Morpheme & { targetUrl: string }> = [];
      const seen = new Set<string>();

      fragment("a[href]").each((_, anchor) => {
        const link = fragment(anchor);
        const href = link.attr("href");
        if (!href) return;

        const language = link.closest("[lang]").attr("lang");
        const linkedPage = getLinkedPage(href);
        if (!linkedPage || (language && language !== "de")) return;
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
        return { etymology, morphemes: linkedParts };
      }
    }
  }

  return { etymology: null, morphemes: [] as Morpheme[] };
}

function extractDefinitions($: cheerio.CheerioAPI) {
  const meanings: string[] = [];
  let partOfSpeech: string | null = null;
  let article: Article = null;

  for (const heading of $("h3, h4, h5").toArray()) {
    const headingText = clean($(heading).text());
    if (!PART_OF_SPEECH.test(headingText)) continue;

    const contents = $(heading).closest(".mw-heading").nextUntil(SECTION_HEADING_SELECTOR);
    partOfSpeech ??= headingText.replace(/ \d+$/, "");

    if (!article) {
      const gender = clean(contents.find(".headword-line .gender abbr").first().text()).toLowerCase();
      if (gender.startsWith("m")) article = "der";
      else if (gender.startsWith("f")) article = "die";
      else if (gender.startsWith("n")) article = "das";
    }

    contents.filter("ol").first().children("li").each((_, item) => {
      if (meanings.length >= 5) return;
      const definition = $(item).clone();
      definition.children("ul, ol, dl, blockquote").remove();
      const value = clean(definition.text());
      if (value && !meanings.includes(value)) meanings.push(value);
    });
  }

  return { article, partOfSpeech, meanings };
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
  const { article, partOfSpeech, meanings } = extractDefinitions($);
  const { etymology, morphemes } = extractModernEtymology($);

  return {
    word,
    article,
    partOfSpeech,
    meanings: meanings.length ? meanings : ["영어 Wiktionary에서 정의를 자동 추출하지 못했습니다."],
    etymology,
    morphemes: morphemes.length
      ? morphemes
      : [{
          text: word,
          lookup: word,
          targetUrl: `${WIKTIONARY_ORIGIN}/wiki/${encodeURIComponent(word)}#German`,
          kind: "root",
          meaning: "Wiktionary에 명시적인 현대 독일어 분해식이 없습니다.",
        }],
    sourceUrl: `${WIKTIONARY_ORIGIN}/wiki/${encodeURIComponent(word)}#German`,
    compoundHint: morphemes.some((part) => part.kind === "compound") && article
      ? "독일어 복합명사의 관사는 보통 마지막 명사(Grundwort)의 관사를 따릅니다."
      : null,
  };
}

export async function parseGermanWord(input: string): Promise<ParseResult> {
  const word = input.trim();
  const { data } = await axios.get(API_URL, {
    params: { action: "parse", page: word, prop: "text", format: "json", origin: "*" },
    timeout: 8_000,
    headers: { "User-Agent": "zerlegen-lernen/0.1 (educational project)" },
  });

  if (data.error || !data.parse?.text?.["*"]) {
    throw new Error(data.error?.info ?? "영어 Wiktionary에서 단어를 찾을 수 없습니다.");
  }

  return parseEnglishWiktionaryHtml(word, data.parse.text["*"] as string);
}
