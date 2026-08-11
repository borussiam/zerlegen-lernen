export type Article = "der" | "die" | "das" | null;

export type CefrLevel = "A1" | "A2" | "B1" | "B2";

export type MorphemeKind = "prefix" | "root" | "suffix" | "compound";

export type FavoriteType = "meaning" | "article";

export interface Morpheme {
  text: string;
  lookup: string;
  targetUrl: string;
  kind: MorphemeKind;
  meaning: string;
}

export interface WordExample {
  sentence: string;
  /**
   * Always keep the translation field in serialized example data. A null value
   * means that a translation has not been supplied yet and can be replaced later.
   */
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
  level?: CefrLevel | null;
}

export interface FavoriteWord {
  word: string;
  article: Article;
  meaning: string;
  decomposition?: string;
  partOfSpeech?: string | null;
  morphemes?: Morpheme[];
  articleReason?: string | null;
  favoriteTypes?: FavoriteType[];
  level?: CefrLevel | null;
  addedAt?: number;
}

export interface VocabularyIndexEntry {
  word: string;
  article: Article;
  partOfSpeech: string | null;
  level: CefrLevel | null;
  meaning: string;
  articleReason: string | null;
}

export interface GeneratedExercise {
  sentence: string;
  translation: string;
  answer: string;
  cloze: string;
  level: string;
}
