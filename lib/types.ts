export type Article = "der" | "die" | "das" | null;

export type MorphemeKind = "prefix" | "root" | "suffix" | "compound";

export interface Morpheme {
  text: string;
  lookup: string;
  targetUrl: string;
  kind: MorphemeKind;
  meaning: string;
}

export interface WordExample {
  sentence: string;
  translation: string | null;
  source: "wiktionary" | "generated";
}

export interface ParseResult {
  word: string;
  article: Article;
  partOfSpeech: string | null;
  meanings: string[];
  examples: WordExample[];
  etymology: string | null;
  morphemes: Morpheme[];
  sourceUrl: string;
  compoundHint: string | null;
  articleReason: string | null;
}

export interface FavoriteWord {
  word: string;
  article: Article;
  meaning: string;
  decomposition?: string;
  partOfSpeech?: string | null;
  morphemes?: Morpheme[];
  articleReason?: string | null;
}

export interface GeneratedExercise {
  sentence: string;
  translation: string;
  answer: string;
  cloze: string;
  level: string;
}
