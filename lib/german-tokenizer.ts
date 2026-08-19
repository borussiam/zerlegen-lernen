export interface GermanToken {
  raw: string;
  clean: string;
  index: number;
  start: number;
  end: number;
  word: boolean;
}

const WORD_PATTERN = /[\p{L}ÄÖÜäöüßẞ]+(?:[-'][\p{L}ÄÖÜäöüßẞ]+)*/gu;
const SURROUNDING_PUNCTUATION = /^[\s"'„“”‘’‚«»‹›.,!?;:()[\]{}…]+|[\s"'„“”‘’‚«»‹›.,!?;:()[\]{}…]+$/gu;

export function stripGermanToken(token: string) {
  return token
    .replace(SURROUNDING_PUNCTUATION, "")
    .replace(/^[‐‑‒–—―-]+|[‐‑‒–—―-]+$/gu, "")
    .normalize("NFC");
}

export function startsWithUppercaseGermanLetter(token: string) {
  const firstLetter = stripGermanToken(token).match(/\p{L}/u)?.[0];
  return Boolean(
    firstLetter
      && firstLetter === firstLetter.toLocaleUpperCase("de-DE")
      && firstLetter !== firstLetter.toLocaleLowerCase("de-DE"),
  );
}

export function capitalizeGermanToken(token: string) {
  const clean = stripGermanToken(token);
  const firstLetterIndex = clean.search(/\p{L}/u);
  if (firstLetterIndex < 0) return clean;
  const firstLetter = clean[firstLetterIndex];
  return `${clean.slice(0, firstLetterIndex)}${firstLetter.toLocaleUpperCase("de-DE")}${clean.slice(firstLetterIndex + firstLetter.length)}`;
}

export function tokenizeGermanText(text: string): GermanToken[] {
  const tokens: GermanToken[] = [];
  let cursor = 0;
  let wordIndex = 0;

  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index ?? 0;
    const rawWord = match[0];
    if (start > cursor) {
      tokens.push({ raw: text.slice(cursor, start), clean: "", index: -1, start: cursor, end: start, word: false });
    }
    tokens.push({
      raw: rawWord,
      clean: stripGermanToken(rawWord),
      index: wordIndex,
      start,
      end: start + rawWord.length,
      word: true,
    });
    wordIndex += 1;
    cursor = start + rawWord.length;
  }

  if (cursor < text.length) {
    tokens.push({ raw: text.slice(cursor), clean: "", index: -1, start: cursor, end: text.length, word: false });
  }

  return tokens;
}
