import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { MorphologicalMetadata } from "./types";

const POS_SECTION_HEADING_SELECTOR = ".mw-heading2, .mw-heading3";
const SUBJECT_PRONOUN = String.raw`(?:ich|du|er|sie|es|wir|ihr|Sie|man)`;
const LEADING_SUBJECT_PRONOUNS = new RegExp(
  String.raw`^${SUBJECT_PRONOUN}(?:(?:\s*(?:\/|,|und)\s*|\s+)${SUBJECT_PRONOUN})*\s+`,
  "iu",
);
const STANDALONE_SUBJECT_PRONOUN = new RegExp(String.raw`^${SUBJECT_PRONOUN}$`, "iu");
const NOMINAL_DECLENSION_ARTICLE = String.raw`(?:der|die|das|des|dem|den|ein|eine|eines|einem|einen|einer)`;
const LEADING_NOMINAL_DECLENSION_ARTICLE = new RegExp(String.raw`^${NOMINAL_DECLENSION_ARTICLE}\s+`, "iu");
const STANDALONE_NOMINAL_DECLENSION_ARTICLE = new RegExp(String.raw`^${NOMINAL_DECLENSION_ARTICLE}$`, "iu");

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
    .replace(LEADING_SUBJECT_PRONOUNS, "")
    .replace(/^(?:er|sie|es|sie)\s+(?:ist|sind)\s+/u, "")
    .replace(LEADING_NOMINAL_DECLENSION_ARTICLE, "")
    .replace(/\s+$/, "")
    .normalize("NFC");

  if (!value || value === "-" || value === "—" || value === "―") return null;
  if (!/^[\p{L}ÄÖÜäöüßẞ]+(?: [\p{L}ÄÖÜäöüßẞ]+)?$/u.test(value)) return null;
  return value;
}

function isStandaloneSubjectPronoun(surfaceForm: string) {
  return STANDALONE_SUBJECT_PRONOUN.test(surfaceForm);
}

function isStandaloneNominalDeclensionArticle(surfaceForm: string) {
  return STANDALONE_NOMINAL_DECLENSION_ARTICLE.test(surfaceForm);
}

function splitSurfaceText(text: string) {
  return text
    .split(/\n|,|;| \/ |\bor\b/iu)
    .flatMap((part) => part.split(/\s{2,}/u))
    .map((part) => normalizeSurface(part))
    .filter((part): part is string => Boolean(part));
}

function partOfSpeechFromHeading(heading: string): MorphologicalMetadata["partOfSpeech"] | null {
  if (/\bverb\b/i.test(heading)) return "verb";
  if (/\bpronoun\b/i.test(heading)) return "pronoun";
  if (/\barticle\b/i.test(heading)) return "article";
  if (/\bdeterminer\b/i.test(heading)) return "determiner";
  if (/\badjective\b/i.test(heading)) return "adjective";
  if (/\b(?:noun|proper noun)\b/i.test(heading)) return "noun";
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

function numberFromText(text: string): MorphologicalMetadata["number"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (lowered.includes("plural")) return "plural";
  if (lowered.includes("singular")) return "singular";
  return undefined;
}

function genderFromText(text: string): MorphologicalMetadata["gender"] | undefined {
  const lowered = text.toLocaleLowerCase("en-US");
  if (/\bmasculine\b|\bm\b/.test(lowered)) return "masculine";
  if (/\bfeminine\b|\bf\b/.test(lowered)) return "feminine";
  if (/\bneuter\b|\bn\b/.test(lowered)) return "neuter";
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
  if (morphology.partOfSpeech === "verb" && isStandaloneSubjectPronoun(surfaceForm)) return;
  if (
    (morphology.partOfSpeech === "noun" || morphology.partOfSpeech === "adjective")
    && isStandaloneNominalDeclensionArticle(surfaceForm)
  ) return;
  surfaces.set(`${surfaceForm}\n${JSON.stringify(morphology)}`, { surfaceForm, morphology });
}

function surfaceFormsFromCell(
  $: cheerio.CheerioAPI,
  cell: Element,
  fallbackText: string,
  pos?: MorphologicalMetadata["partOfSpeech"],
) {
  const linkedForms = $(cell).find("[lang='de']").toArray()
    .flatMap((item) => splitSurfaceText(cleanCell($, item)));
  const fallbackForms = splitSurfaceText(fallbackText);
  if (pos === "verb") {
    return Array.from(new Set([...fallbackForms, ...linkedForms].filter((surfaceForm) => (
      !isStandaloneSubjectPronoun(surfaceForm)
    ))));
  }
  if (pos === "noun" || pos === "adjective") {
    return Array.from(new Set([...fallbackForms, ...linkedForms].filter((surfaceForm) => (
      !isStandaloneNominalDeclensionArticle(surfaceForm)
    ))));
  }
  if (linkedForms.length) return Array.from(new Set(linkedForms));
  return fallbackForms;
}

interface TableCell {
  element: Element;
  text: string;
  header: boolean;
  row: number;
  column: number;
  rowspan: number;
  colspan: number;
}

function tableGrid($: cheerio.CheerioAPI, table: Element) {
  const grid: Array<Array<TableCell | undefined>> = [];
  $(table).find("tr").each((rowIndex, row) => {
    grid[rowIndex] ??= [];
    let columnIndex = 0;
    $(row).children("th, td").each((_, cell) => {
      while (grid[rowIndex]?.[columnIndex]) columnIndex += 1;
      const colspan = Math.max(1, Number($(cell).attr("colspan") ?? "1") || 1);
      const rowspan = Math.max(1, Number($(cell).attr("rowspan") ?? "1") || 1);
      const item: TableCell = {
        element: cell,
        text: cleanCell($, cell),
        header: cell.tagName.toLocaleLowerCase("en-US") === "th",
        row: rowIndex,
        column: columnIndex,
        rowspan,
        colspan,
      };
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ??= [];
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          grid[rowIndex + rowOffset][columnIndex + columnOffset] = item;
        }
      }
      columnIndex += colspan;
    });
  });
  return grid;
}

function tableCellContext(grid: Array<Array<TableCell | undefined>>, cell: TableCell) {
  const labels: string[] = [];
  const row = grid[cell.row] ?? [];
  for (let column = 0; column < cell.column; column += 1) {
    const candidate = row[column];
    if (candidate?.header && candidate.text && !labels.includes(candidate.text)) labels.push(candidate.text);
  }
  for (let rowIndex = 0; rowIndex < cell.row; rowIndex += 1) {
    const candidate = grid[rowIndex]?.[cell.column];
    if (candidate?.header && candidate.text && !labels.includes(candidate.text)) labels.push(candidate.text);
  }
  return labels.join(" ");
}

function nominalTableMorphology(
  pos: MorphologicalMetadata["partOfSpeech"],
  context: string,
  fallbackNumber?: MorphologicalMetadata["number"],
): MorphologicalMetadata {
  return {
    partOfSpeech: pos,
    case: caseFromText(context),
    number: numberFromText(context) ?? fallbackNumber,
    gender: genderFromText(context),
  };
}

function isMorphologyTable($: cheerio.CheerioAPI, table: Element, pos: MorphologicalMetadata["partOfSpeech"]) {
  const className = $(table).attr("class") ?? "";
  const caption = clean($(table).find("caption").first().text());
  const text = cleanCell($, table).toLocaleLowerCase("en-US");
  if (/\b(?:inflection|conjugation|declension)\b/i.test(`${className} ${caption}`)) return true;
  if ($(table).find("[class*='form-of'][lang='de']").length) return true;
  if (pos === "verb") return true;
  if (pos === "noun" || pos === "article" || pos === "determiner" || pos === "pronoun") {
    return /\b(?:nominative|accusative|dative|genitive)\b/.test(text);
  }
  if (pos === "adjective") return /\b(?:comparative|superlative)\b/.test(text);
  return false;
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
  word: string,
  pos: MorphologicalMetadata["partOfSpeech"],
  surfaces: Map<string, WiktionaryInflectionSurface>,
) {
  let activeVerbTense: MorphologicalMetadata["tense"] | undefined;
  const grid = tableGrid($, table);
  const normalizedWord = word.toLocaleLowerCase("de-DE");
  const pronounWordColumns = new Set<number>();
  if (pos === "pronoun") {
    for (const row of grid) {
      for (const cell of row) {
        if (!cell) continue;
        const forms = surfaceFormsFromCell($, cell.element, cell.text, pos)
          .map((surfaceForm) => surfaceForm.toLocaleLowerCase("de-DE"));
        if (!forms.includes(normalizedWord)) continue;
        for (let offset = 0; offset < cell.colspan; offset += 1) {
          pronounWordColumns.add(cell.column + offset);
        }
      }
    }
  }

  $(table).find("tr").each((_, row) => {
    const rowText = cleanCell($, row);
    const rowCase = caseFromText(rowText);
    const rowTense = tenseFromText(rowText);
    const rowMood = moodFromText(rowText);
    if (pos === "verb" && rowTense) activeVerbTense = rowTense;
    if (pos === "adjective" && isNotComparable(rowText)) return;
    if (pos === "pronoun" && pronounWordColumns.size === 0) {
      const rowForms = $(row).children("td").toArray()
        .flatMap((cell) => surfaceFormsFromCell($, cell, cleanCell($, cell), pos))
        .map((surfaceForm) => surfaceForm.toLocaleLowerCase("de-DE"));
      if (rowForms.length && !rowForms.includes(normalizedWord)) return;
    }

    $(row).children("td").each((cellIndex, cell) => {
      const text = cleanCell($, cell);
      const contextNumber = numberFromContext(rowText, cellIndex);
      const verbTense = rowMood === "imperative" ? undefined : rowTense ?? activeVerbTense;
      const formSpans = $(cell).find("[class*='form-of'][lang='de']").toArray();
      const gridCell = grid.flat().find((item) => item?.element === cell);
      if (pos === "pronoun" && pronounWordColumns.size && gridCell && !pronounWordColumns.has(gridCell.column)) return;
      const nominalContext = gridCell ? `${rowText} ${tableCellContext(grid, gridCell)}` : rowText;

      if (formSpans.length) {
        for (const formSpan of formSpans) {
          const className = $(formSpan).attr("class") ?? "";
          const forms = splitSurfaceText(cleanCell($, formSpan));
          for (const surfaceForm of forms) {
            const morphology = morphologyFromFormClass(className, pos, verbTense, rowMood, text, contextNumber);
            if (pos === "noun") {
              morphology.case = rowCase;
              morphology.number = contextNumber;
            } else if (pos === "article" || pos === "determiner" || pos === "pronoun") {
              Object.assign(morphology, nominalTableMorphology(pos, nominalContext, contextNumber));
            }
            addSurface(surfaces, surfaceForm, morphology);
          }
        }
        return;
      }

      const forms = surfaceFormsFromCell($, cell, text, pos);
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
          if (!morphology.tense && !morphology.person && morphology.mood !== "imperative") continue;
        } else if (pos === "adjective") {
          morphology.degree = degreeFromText(rowText) ?? degreeFromText(text);
          morphology.gradable = !isNotComparable(rowText);
        } else if (pos === "article" || pos === "determiner" || pos === "pronoun") {
          Object.assign(morphology, nominalTableMorphology(pos, nominalContext, contextNumber));
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
    contents.filter("table").add(contents.find("table")).each((_, table) => {
      if (isMorphologyTable($, table, pos)) parseTable($, table, word, pos, surfaces);
    });
  }

  return Array.from(surfaces.values());
}
