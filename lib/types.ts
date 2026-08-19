export type Article = "der" | "die" | "das" | null;

export type CefrLevel = "A1" | "A2" | "B1" | "B2";

export type MorphemeKind = "prefix" | "root" | "suffix" | "compound";

export type FavoriteType = "meaning" | "article";

export type ReviewStep = 0 | 1 | 2 | 3;

export interface MasteryProgress {
  masteredAt: number;
  reviewStep: ReviewStep;
  nextReviewAt: number;
  lastReviewedAt?: number;
  lastMeaningKnown?: boolean;
  lastArticleKnown?: boolean | null;
  previousFavoriteTypes: FavoriteType[];
}

export interface PracticeProgress {
  articleCorrectStreak: number;
  lastArticleAnsweredAt?: number;
}

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
  kind?: "sentence" | "word";
}

export type MorphologicalPartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "preposition"
  | "conjunction"
  | "particle"
  | "other";

export interface MorphologicalMetadata {
  partOfSpeech: MorphologicalPartOfSpeech;
  case?: "nominative" | "accusative" | "dative" | "genitive";
  tense?: "present" | "preterite" | "perfect" | "past-participle";
  mood?: "indicative" | "imperative" | "subjunctive-i" | "subjunctive-ii";
  person?: "1" | "2" | "3";
  number?: "singular" | "plural";
  gender?: "masculine" | "feminine" | "neuter";
  degree?: "positive" | "comparative" | "superlative";
  gradable?: boolean;
  separablePrefix?: string;
  auxiliary?: "haben" | "sein";
  register?: "informal" | "formal";
  contraction?: {
    preposition: string;
    article: "der" | "das" | "dem";
  };
}

export interface InflectionCandidate {
  surfaceForm: string;
  lemmaId: string;
  lemma: string;
  article: Article;
  partOfSpeech: string | null;
  meaning: string;
  dictionaryEntry?: ParseResult;
  morphology: MorphologicalMetadata;
  exactCase: boolean;
  source: "surface-map" | "dictionary" | "related-separable" | "wiktionary-inflection";
}

export interface SentenceLookupResult {
  surfaceForm: string;
  token: string;
  candidates: InflectionCandidate[];
  relatedCandidates: InflectionCandidate[];
}

export interface VerbInflectionSummary {
  kind: "verb";
  infinitive: string;
  preteriteThirdPerson?: string;
  pastParticiple?: string;
  auxiliary?: "haben" | "sein";
  present: {
    ich: string;
    du: string;
    erSieEs: string;
    wir: string;
    ihr: string;
    sieSie: string;
  };
  imperative: {
    du: string;
    ihr: string;
    sie: string;
  };
  konjunktivII?: Array<{ label: string; form: string }>;
}

export interface AdjectiveInflectionSummary {
  kind: "adjective";
  positive: string;
  comparative?: string;
  superlative?: string;
  gradable: boolean;
}

export type LearnerInflectionSummary = VerbInflectionSummary | AdjectiveInflectionSummary;

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
  headwordKey?: string;
  displayHeadword?: string;
  variants?: DictionaryVariant[];
  decompositionOptions?: DecompositionOption[];
  learnerInflection?: LearnerInflectionSummary;
}

export interface FavoriteWord {
  id: string;
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
  mastery?: MasteryProgress;
  practice?: PracticeProgress;
  headwordKey?: string;
  displayHeadword?: string;
  variants?: DictionaryVariant[];
  decompositionOptions?: DecompositionOption[];
}

export interface WordbookState {
  version: 2;
  words: FavoriteWord[];
}

export interface VocabularyIndexEntry {
  word: string;
  article: Article;
  partOfSpeech: string | null;
  level: CefrLevel | null;
  meaning: string;
  articleReason: string | null;
  headwordKey?: string;
  displayHeadword?: string;
  variants?: DictionaryVariant[];
  decompositionOptions?: DecompositionOption[];
}

export interface GeneratedExercise {
  sentence: string;
  translation: string;
  answer: string;
  cloze: string;
  level: string;
}

export interface DictionaryVariant {
  word: string;
  article: Article;
  partOfSpeech: string | null;
  meanings: string[];
  examples: WordExample[];
  etymology: string | null;
  morphemes: Morpheme[];
  articleReason: string | null;
  level?: CefrLevel | null;
  sourceUrl: string;
  learnerInflection?: LearnerInflectionSummary;
}

export interface DecompositionOption {
  id: string;
  label: string;
  word: string;
  article: Article;
  partOfSpeech: string | null;
  meanings: string[];
  etymology: string | null;
  morphemes: Morpheme[];
}
