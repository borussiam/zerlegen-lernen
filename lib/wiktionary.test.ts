import axios, { AxiosHeaders, type AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseEnglishWiktionaryHtml,
  parseGermanWord,
  resetWiktionaryRuntimeForTests,
} from "./wiktionary";

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
