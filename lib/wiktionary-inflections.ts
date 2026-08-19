import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { MorphologicalMetadata } from "./types";

const POS_SECTION_HEADING_SELECTOR = ".mw-heading2, .mw-heading3";
const GERMAN_FUNCTION_WORDS = new Set([
  "ich", "du", "er", "sie", "es", "wir", "ihr", "Sie",
  "ein", "eine", "einen", "einem", "einer", "eines",
  "der", "die", "das", "den", "dem", "des",
]);

export interface WiktionaryInflectionSurface {
  surfaceForm: string;
  morphology: MorphologicalMetadata;
}

function clean(text: string) {
  return text
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCell($: cheerio.CheerioAPI, cell: Element) {
  const clone = $(cell).clone();
  clone.find("style, script, noscript, audio, source, .reference, .mw-editsection, sup").remove();
  clone.find("br").replaceWith("\n");
  return clone.text()
    .replace(/\u00a0/g, " ")
    .replace(/[!?]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*]/g, "")
    .trim();
}

function normalizeSurface(raw: string) {
  const value = clean(raw)
    .replace(/^(?:ich|du|er|sie|es|wir|ihr|Sie)(?:,\s*(?:sie|es))*\s+/u, "")
    .replace(/^(?:er|sie|es|sie)\s+(?:ist|sind)\s+/u, "")
    .replace(/^(?:ein(?:e[rsnmn]?)?|der|die|das|des|dem|den)\s+/u, "")
    .replace(/\s+$/, "")
    .normalize("NFC");

  if (!value || value === "-" || value === "—" || value === "―") return null;
  if (GERMAN_FUNCTION_WORDS.has(value)) return null;
  if (!/^[\p{L}ÄÖÜäöüßẞ]+(?: [\p{L}ÄÖÜäöüßẞ]+)?$/u.test(value)) return null;
  return value;
}

function splitSurfaceText(text: string) {
  return text
    .split(/\n|,|;| \/ |\bor\b/iu)
    .flatMap((part) => part.split(/\s{2,}/u))
    .map((part) => normalizeSurface(part))
    .filter((part): part is string => Boolean(part));
}

function partOfSpeechFromHeading(heading: string): MorphologicalMetadata["partOfSpeech"] | null {
  if (/verb/i.test(heading)) return "verb";
  if (/noun|proper noun/i.test(heading)) return "noun";
  if (/adjective/i.test(heading)) return "adjective";
  return null;
}

function caseFromText(text: string): MorphologicalMetadata["case"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (lowered.includes("nominative")) return "nominative";
  if (lowered.includes("accusative")) return "accusative";
  if (lowered.includes("dative")) return "dative";
  if (lowered.includes("genitive")) return "genitive";
  return undefined;
}

function tenseFromText(text: string): MorphologicalMetadata["tense"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (lowered.includes("preterite") || lowered.includes("past tense")) return "preterite";
  if (lowered.includes("past participle")) return "past-participle";
  if (lowered.includes("present")) return "present";
  return undefined;
}

function auxiliaryFromText(text: string): MorphologicalMetadata["auxiliary"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (/\bauxiliary\s+haben\b/.test(lowered)) return "haben";
  if (/\bauxiliary\s+sein\b/.test(lowered)) return "sein";
  return undefined;
}

function moodFromText(text: string): MorphologicalMetadata["mood"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (lowered.includes("imperative")) return "imperative";
  if (lowered.includes("subjunctive ii") || lowered.includes("subjunctive-ii")) return "subjunctive-ii";
  if (lowered.includes("subjunctive i") || lowered.includes("subjunctive-i")) return "subjunctive-i";
  if (lowered.includes("indicative")) return "indicative";
  return undefined;
}

function numberFromContext(rowText: string, cellIndex: number): MorphologicalMetadata["number"] | undefined {
  const lowered = rowText.toLocaleLowerCase("en-US");
  if (lowered.includes("plural")) return "plural";
  if (lowered.includes("singular")) return "singular";
  if (cellIndex % 2 === 1) return "plural";
  if (cellIndex % 2 === 0) return "singular";
  return undefined;
}

function degreeFromText(text: string): MorphologicalMetadata["degree"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (lowered.includes("comparative")) return "comparative";
  if (lowered.includes("superlative")) return "superlative";
  return undefined;
}

function isNotComparable(text: string) {
  return /\bnot comparable\b|\bincomparable\b/i.test(text);
}

function verbPersonNumberFromText(
  text: string,
  contextNumber?: MorphologicalMetadata["number"],
): Pick<MorphologicalMetadata, "person" | "number"> {
  const cleaned = clean(text);
  if (/^ich\b/iu.test(cleaned)) return { person: "1", number: "singular" };
  if (/^du\b/iu.test(cleaned)) return { person: "2", number: "singular" };
  if (/^(?:er|es)\b/iu.test(cleaned)) return { person: "3", number: "singular" };
  if (/^wir\b/iu.test(cleaned)) return { person: "1", number: "plural" };
  if (/^ihr\b/iu.test(cleaned)) return { person: "2", number: "plural" };
  if (/^(?:sie|Sie)\b/u.test(cleaned)) return { person: "3", number: contextNumber ?? "plural" };
  return {};
}

function verbPersonNumberFromClass(className: string): Pick<MorphologicalMetadata, "person" | "number"> {
  if (className.includes("1|s|")) return { person: "1", number: "singular" };
  if (className.includes("2|s|")) return { person: "2", number: "singular" };
  if (className.includes("3|s|")) return { person: "3", number: "singular" };
  if (className.includes("1|p|")) return { person: "1", number: "plural" };
  if (className.includes("2|p|")) return { person: "2", number: "plural" };
  if (className.includes("3|p|")) return { person: "3", number: "plural" };
  if (className.includes("s|imp")) return { person: "2", number: "singular" };
  if (className.includes("p|imp")) return { person: "2", number: "plural" };
  return {};
}

function morphologyFromFormClass(
  className: string,
  pos: MorphologicalMetadata["partOfSpeech"],
  rowTense: MorphologicalMetadata["tense"] | undefined,
  rowMood: MorphologicalMetadata["mood"] | undefined,
  cellText: string,
  contextNumber?: MorphologicalMetadata["number"],
): MorphologicalMetadata {
  const morphology: MorphologicalMetadata = { partOfSpeech: pos };

  if (pos === "verb") {
    if (className.includes("past|part")) {
      morphology.tense = "past-participle";
    } else if (className.includes("pret")) {
      morphology.tense = "preterite";
    } else if (className.includes("pres")) {
      morphology.tense = "present";
    } else if (rowMood !== "imperative") {
      morphology.tense = rowTense;
    }

    if (className.includes("sub:I")) {
      morphology.mood = "subjunctive-i";
    } else if (className.includes("sub:II")) {
      morphology.mood = "subjunctive-ii";
    } else if (className.includes("imp")) {
      morphology.mood = "imperative";
    } else if (morphology.tense !== "past-participle") {
      morphology.mood = rowMood ?? "indicative";
    }

    Object.assign(morphology, verbPersonNumberFromText(cellText, contextNumber), verbPersonNumberFromClass(className));
  } else if (pos === "adjective") {
    morphology.degree = degreeFromText(className) ?? degreeFromText(cellText);
  }

  return morphology;
}

function addSurface(
  surfaces: Map<string, WiktionaryInflectionSurface>,
  surfaceForm: string,
  morphology: MorphologicalMetadata,
) {
  surfaces.set(`${surfaceForm}\n${JSON.stringify(morphology)}`, { surfaceForm, morphology });
}

function parseHeadwordLine(text: string, pos: MorphologicalMetadata["partOfSpeech"], surfaces: Map<string, WiktionaryInflectionSurface>) {
  if (pos === "verb") {
    const present = /third-person singular present\s+([^,()]+)/i.exec(text)?.[1];
    const preterite = /past tense\s+([^,()]+)/i.exec(text)?.[1];
    const participle = /past participle\s+([^,()]+)/i.exec(text)?.[1];
    const subjunctive = /past subjunctive\s+([^,()]+)/i.exec(text)?.[1];
    const auxiliary = auxiliaryFromText(text);
    for (const surfaceForm of splitSurfaceText(present ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "verb", tense: "present", mood: "indicative", person: "3", number: "singular" });
    }
    for (const surfaceForm of splitSurfaceText(preterite ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "verb", tense: "preterite", mood: "indicative" });
    }
    for (const surfaceForm of splitSurfaceText(participle ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "verb", tense: "past-participle", auxiliary });
    }
    for (const surfaceForm of splitSurfaceText(subjunctive ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "verb", tense: "preterite", mood: "subjunctive-ii" });
    }
  }

  if (pos === "noun") {
    const genitive = /genitive\s+([^,)]+)/i.exec(text)?.[1];
    const plural = /plural\s+([^,)]+)/i.exec(text)?.[1];
    for (const surfaceForm of splitSurfaceText(genitive ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "noun", case: "genitive", number: "singular" });
    }
    for (const surfaceForm of splitSurfaceText(plural ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "noun", number: "plural" });
    }
  }

  if (pos === "adjective" && !isNotComparable(text)) {
    const comparative = /comparative\s+([^,()]+)/i.exec(text)?.[1];
    const superlative = /superlative\s+([^,()]+)/i.exec(text)?.[1];
    for (const surfaceForm of splitSurfaceText(comparative ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "adjective", degree: "comparative", gradable: true });
    }
    for (const surfaceForm of splitSurfaceText(superlative ?? "")) {
      addSurface(surfaces, surfaceForm, { partOfSpeech: "adjective", degree: "superlative", gradable: true });
    }
  }
}

function parseTable(
  $: cheerio.CheerioAPI,
  table: Element,
  pos: MorphologicalMetadata["partOfSpeech"],
  surfaces: Map<string, WiktionaryInflectionSurface>,
) {
  let activeVerbTense: MorphologicalMetadata["tense"] | undefined;

  $(table).find("tr").each((_, row) => {
    const rowText = cleanCell($, row);
    const rowCase = caseFromText(rowText);
    const rowTense = tenseFromText(rowText);
    const rowMood = moodFromText(rowText);
    if (pos === "verb" && rowTense) activeVerbTense = rowTense;
    if (pos === "adjective" && isNotComparable(rowText)) return;

    $(row).children("td").each((cellIndex, cell) => {
      const text = cleanCell($, cell);
      const contextNumber = numberFromContext(rowText, cellIndex);
      const verbTense = rowMood === "imperative" ? undefined : rowTense ?? activeVerbTense;
      const formSpans = $(cell).find("[class*='form-of'][lang='de']").toArray();

      if (formSpans.length) {
        for (const formSpan of formSpans) {
          const className = $(formSpan).attr("class") ?? "";
          const forms = splitSurfaceText(cleanCell($, formSpan));
          for (const surfaceForm of forms) {
            const morphology = morphologyFromFormClass(className, pos, verbTense, rowMood, text, contextNumber);
            if (pos === "noun") {
              morphology.case = rowCase;
              morphology.number = contextNumber;
            }
            addSurface(surfaces, surfaceForm, morphology);
          }
        }
        return;
      }

      const forms = splitSurfaceText(text);
      if (!forms.length) return;

      for (const surfaceForm of forms) {
        const morphology: MorphologicalMetadata = { partOfSpeech: pos };
        if (pos === "noun") {
          morphology.case = rowCase;
          morphology.number = contextNumber;
        } else if (pos === "verb") {
          morphology.tense = verbTense;
          morphology.mood = rowMood ?? "indicative";
          Object.assign(morphology, verbPersonNumberFromText(text, contextNumber));
        } else if (pos === "adjective") {
          morphology.degree = degreeFromText(rowText) ?? degreeFromText(text);
          morphology.gradable = !isNotComparable(rowText);
        }
        addSurface(surfaces, surfaceForm, morphology);
      }
    });
  });
}

export function parseGermanWiktionaryInflectionsHtml(word: string, html: string) {
  const page = cheerio.load(html);
  const germanHeading = page("h2")
    .filter((_, heading) => clean(page(heading).text()) === "German")
    .first()
    .closest(".mw-heading");

  if (!germanHeading.length) return [];

  const germanHtml = germanHeading.nextUntil(".mw-heading2").toString();
  const $ = cheerio.load(`<section id="german-entry">${germanHtml}</section>`);
  const surfaces = new Map<string, WiktionaryInflectionSurface>();

  for (const heading of $("h3, h4, h5").toArray()) {
    const headingText = clean($(heading).text());
    const pos = partOfSpeechFromHeading(headingText);
    if (!pos) continue;

    const contents = $(heading).closest(".mw-heading").nextUntil(POS_SECTION_HEADING_SELECTOR);
    const headwordText = clean(contents.filter(".headword-line").add(contents.find(".headword-line")).first().text());
    addSurface(surfaces, word.normalize("NFC"), {
      partOfSpeech: pos,
      ...(pos === "adjective" ? { degree: "positive" as const, gradable: !isNotComparable(headwordText) } : {}),
    });

    parseHeadwordLine(headwordText, pos, surfaces);
    contents.filter("table").add(contents.find("table")).each((_, table) => parseTable($, table, pos, surfaces));
  }

  return Array.from(surfaces.values());
}
