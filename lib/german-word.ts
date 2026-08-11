export function getGermanCaseCandidates(word: string) {
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
