import axios, { AxiosHeaders, type AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseEnglishWiktionaryHtml,
  parseGermanWord,
  resetWiktionaryRuntimeForTests,
} from "./wiktionary";
import { getLearnerInflectionSummaryFromWiktionary } from "./learner-inflections";
import { parseGermanWiktionaryInflectionsHtml } from "./wiktionary-inflections";

function response<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

function entryHtml(body: string) {
  return `
    <div class="mw-heading mw-heading2"><h2>German</h2></div>
    ${body}
    <div class="mw-heading mw-heading2"><h2>References</h2></div>
  `;
}

function lexicalHtml(
  partOfSpeech: "Noun" | "Verb" | "Adjective" | "Suffix",
  definition: string,
) {
  return entryHtml(`
    <div class="mw-heading mw-heading3"><h3>${partOfSpeech}</h3></div>
    <p class="headword-line"><span class="gender"><abbr>m</abbr></span></p>
    <ol>
      <li>${definition}
        <dl class="h-usage-example">
          <dd><span class="e-example">Das ist ein Beispiel.</span></dd>
          <dd><span class="e-translation">This is an example.</span></dd>
        </dl>
      </li>
    </ol>
  `);
}

describe("parseEnglishWiktionaryHtml", () => {
  it("extracts clean definitions and examples for a suffix entry", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Suffix</h3></div>
      <style>.mw-parser-output .foo { color: red; }</style>
      <p class="headword-line"><strong>-er</strong></p>
      <ol>
        <li>Forms agent nouns from verbs.<span class="reference">[1]</span>
          <dl class="h-usage-example">
            <dd><span class="e-example">lehren + -er → Lehrer</span></dd>
          </dl>
        </li>
      </ol>
    `);

    const result = parseEnglishWiktionaryHtml("-er", html);

    expect(result.partOfSpeech).toBe("Suffix");
    expect(result.meanings).toEqual(["Forms agent nouns from verbs."]);
    expect(result.meanings.join(" ")).not.toContain("mw-parser-output");
    expect(result.examples[0].sentence).toContain("Lehrer");
    expect(result.morphemes[0]).toMatchObject({ lookup: "-er", kind: "suffix" });
  });

  it("parses a plus-only decomposition without an 'equivalent to' marker", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Etymology</h3></div>
      <p>
        <span lang="de"><a href="/wiki/freundlich#German">freundlich</a></span>
        +
        <span lang="de"><a href="/wiki/-keit#German">-keit</a></span>
      </p>
      <div class="mw-heading mw-heading3"><h3>Noun</h3></div>
      <p class="headword-line"><span class="gender"><abbr>f</abbr></span></p>
      <ol><li>friendliness</li></ol>
    `);

    const result = parseEnglishWiktionaryHtml("Freundlichkeit", html);

    expect(result.morphemes.map(({ lookup, kind }) => ({ lookup, kind }))).toEqual([
      { lookup: "freundlich", kind: "root" },
      { lookup: "-keit", kind: "suffix" },
    ]);
    expect(result.etymology).toBe("freundlich + -keit");
    expect(result.article).toBe("die");
    expect(result.articleReason).toContain("-keit 규칙");
  });

  it("uses linked lemmas and affix targets for equivalent-to decompositions", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Etymology</h3></div>
      <p>Equivalent to <span lang="de"><a href="/wiki/lehren#German">lehren</a></span>
        + <span lang="de"><a href="/wiki/-er#German">-er</a></span>.</p>
      <div class="mw-heading mw-heading3"><h3>Noun</h3></div>
      <p class="headword-line"><span class="gender"><abbr>m</abbr></span></p>
      <ol><li>teacher</li></ol>
    `);

    const result = parseEnglishWiktionaryHtml("Lehrer", html);

    expect(result.morphemes.map((part) => part.lookup)).toEqual(["lehren", "-er"]);
    expect(result.morphemes[1].targetUrl).toBe("https://en.wiktionary.org/wiki/-er#German");
  });

  it("maps plural-only nouns to the German plural article and grammar", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Noun</h3></div>
      <p class="headword-line"><span class="gender"><abbr>pl</abbr></span></p>
      <ol><li>people</li></ol>
    `);

    const result = parseEnglishWiktionaryHtml("Leute", html);

    expect(result.article).toBe("die");
    expect(result.examples).toEqual([{
      sentence: "Die Leute sind in diesem Zusammenhang wichtig.",
      translation: null,
      source: "generated",
    }]);
  });

  it("infers a visible suffix from single-linked From etymology without collecting unrelated text", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Etymology</h3></div>
      <p>From <span lang="de"><a href="/wiki/krank#German">krank</a></span>. Compare unrelated <span lang="de"><a href="/wiki/Haus#German">Haus</a></span>.</p>
      <div class="mw-heading mw-heading3"><h3>Adjective</h3></div>
      <ol><li>sick; ill</li></ol>
    `);

    const result = parseEnglishWiktionaryHtml("kranker", html);

    expect(result.morphemes.map(({ lookup, kind }) => ({ lookup, kind }))).toEqual([
      { lookup: "krank", kind: "root" },
      { lookup: "-er", kind: "suffix" },
    ]);
    expect(result.morphemes.map((part) => part.lookup)).not.toContain("Haus");
  });
});

describe("parseGermanWiktionaryInflectionsHtml", () => {
  it("extracts strong verb forms without generating impossible bitten forms", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Verb</h3></div>
      <p class="headword-line">bitten (class 5 strong, third-person singular present bittet, past tense bat, past participle gebeten, auxiliary haben)</p>
      <div class="mw-heading mw-heading4"><h4>Conjugation</h4></div>
      <table>
        <tr><th>present</th><td>ich bitte</td><td>wir bitten</td><td>du bittest</td><td>ihr bittet</td><td>er bittet</td><td>sie bitten</td></tr>
      </table>
    `);

    const surfaces = parseGermanWiktionaryInflectionsHtml("bitten", html).map((item) => item.surfaceForm);

    expect(surfaces).toEqual(expect.arrayContaining(["bitte", "bittest", "bittet", "bat", "gebeten"]));
    expect(surfaces).not.toEqual(expect.arrayContaining(["bittst", "bittt"]));
  });

  it("keeps present-tense person metadata from modern conjugation table classes", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Verb</h3></div>
      <p class="headword-line">existieren (weak, third-person singular present existiert, past tense existierte, past participle existiert, auxiliary haben)</p>
      <div class="mw-heading mw-heading4"><h4>Conjugation</h4></div>
      <table>
        <tr>
          <td><span class="Latn" lang="de">ich</span> <span class="Latn form-of lang-de 1|s|pres-form-of origin-existieren" lang="de">existiere</span></td>
          <td><span class="Latn" lang="de">wir</span> <span class="Latn form-of lang-de 1|p|pres-form-of origin-existieren" lang="de">existieren</span></td>
        </tr>
        <tr>
          <td><span class="Latn" lang="de">du</span> <span class="Latn form-of lang-de 2|s|pres-form-of origin-existieren" lang="de">existierst</span></td>
          <td><span class="Latn" lang="de">ihr</span> <span class="Latn form-of lang-de 2|p|pres-form-of origin-existieren" lang="de">existiert</span></td>
        </tr>
        <tr>
          <td><span class="Latn" lang="de">er</span> <span class="Latn form-of lang-de 3|s|pres-form-of origin-existieren" lang="de">existiert</span></td>
          <td><span class="Latn" lang="de">sie</span> <span class="Latn form-of lang-de 3|p|pres-form-of origin-existieren" lang="de">existieren</span></td>
        </tr>
      </table>
    `);

    const summary = getLearnerInflectionSummaryFromWiktionary("existieren", "Verb", parseGermanWiktionaryInflectionsHtml("existieren", html));

    expect(summary).toMatchObject({
      kind: "verb",
      auxiliary: "haben",
      present: {
        ich: "existiere",
        du: "existierst",
        erSieEs: "existiert",
        wir: "existieren",
        ihr: "existiert",
        sieSie: "existieren",
      },
    });
  });

  it("marks non-comparable adjectives instead of generating comparative forms", () => {
    const html = entryHtml(`
      <div class="mw-heading mw-heading3"><h3>Adjective</h3></div>
      <p class="headword-line">englisch (not comparable)</p>
      <ol><li>English</li></ol>
    `);

    const surfaces = parseGermanWiktionaryInflectionsHtml("englisch", html);
    const summary = getLearnerInflectionSummaryFromWiktionary("englisch", "Adjective", surfaces);

    expect(summary).toEqual({ kind: "adjective", positive: "englisch", gradable: false });
  });
});

describe("parseGermanWord", () => {
  beforeEach(() => {
    resetWiktionaryRuntimeForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("tries a lowercase page when the requested capitalization has no German entry", async () => {
    const get = vi.spyOn(axios, "get");
    get
      .mockResolvedValueOnce(response({ parse: { text: { "*": "<h2>English</h2>" } } }))
      .mockResolvedValueOnce(response({
        parse: { title: "freundlich", text: { "*": lexicalHtml("Adjective", "friendly") } },
      }));

    const result = await parseGermanWord("Freundlich");

    expect(result.word).toBe("freundlich");
    expect(result.partOfSpeech).toBe("Adjective");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 response with exponential backoff", async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error("Too Many Requests"), {
      isAxiosError: true,
      response: { status: 429, headers: {} },
    });
    const get = vi.spyOn(axios, "get");
    get
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(response({
        parse: { title: "lernen", text: { "*": lexicalHtml("Verb", "to learn") } },
      }));

    const pendingResult = parseGermanWord("lernen");
    await vi.runAllTimersAsync();

    await expect(pendingResult).resolves.toMatchObject({ word: "lernen", meanings: ["to learn"] });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
