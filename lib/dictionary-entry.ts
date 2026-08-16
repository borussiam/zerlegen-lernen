import type { Article, DecompositionOption, DictionaryVariant, Morpheme, ParseResult } from "./types";

function normalized(value: string) {
  return value.trim().normalize("NFC").toLocaleLowerCase("de-DE");
}

export function headwordKeyFor(word: string) {
  return normalized(word);
}

export function variantLabel(variant: Pick<DictionaryVariant, "word" | "article">) {
  return variant.article ? `${variant.article} ${variant.word}` : variant.word;
}

function decompositionKey(morphemes: Morpheme[]) {
  return morphemes.map((part) => `${part.lookup}:${part.kind}`).join("+");
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dictionaryVariantFromResult(result: ParseResult): DictionaryVariant {
  return {
    word: result.word,
    article: result.article,
    partOfSpeech: result.partOfSpeech,
    meanings: result.meanings,
    examples: result.examples,
    etymology: result.etymology,
    morphemes: result.morphemes,
    articleReason: result.articleReason,
    level: result.level ?? null,
    sourceUrl: result.sourceUrl,
  };
}

export function decompositionOptionsFromVariants(variants: DictionaryVariant[]): DecompositionOption[] {
  return uniqueBy(
    variants.flatMap((variant): DecompositionOption[] => {
      if (!variant.morphemes.length) return [];
      return [{
        id: `${variant.word}:${variant.partOfSpeech ?? "unknown"}:${decompositionKey(variant.morphemes)}`,
        label: variantLabel(variant),
        word: variant.word,
        article: variant.article,
        partOfSpeech: variant.partOfSpeech,
        meanings: variant.meanings,
        etymology: variant.etymology,
        morphemes: variant.morphemes,
      }];
    }),
    (option) => `${normalized(option.label)}:${decompositionKey(option.morphemes)}`,
  );
}

export function displayHeadwordFor(variants: DictionaryVariant[]) {
  return uniqueBy(
    [...variants].sort((left, right) => Number(!left.article) - Number(!right.article)),
    (variant) => variantLabel(variant).toLocaleLowerCase("de-DE"),
  ).map(variantLabel).join(" / ");
}

export function mergeParseResults(results: ParseResult[]): ParseResult {
  if (results.length <= 1) {
    const result = results[0];
    const variants = result.variants?.length ? result.variants : [dictionaryVariantFromResult(result)];
    return {
      ...result,
      headwordKey: result.headwordKey ?? headwordKeyFor(result.word),
      displayHeadword: result.displayHeadword ?? displayHeadwordFor(variants),
      variants,
      decompositionOptions: result.decompositionOptions?.length
        ? result.decompositionOptions
        : decompositionOptionsFromVariants(variants),
    };
  }

  const variants = uniqueBy(
    results.flatMap((result) => result.variants?.length ? result.variants : [dictionaryVariantFromResult(result)]),
    (variant) => `${normalized(variant.word)}:${variant.partOfSpeech ?? "unknown"}:${variant.article ?? "none"}`,
  );
  const primary = variants.find((variant) => variant.article)
    ?? variants.find((variant) => /noun/i.test(variant.partOfSpeech ?? ""))
    ?? variants[0];
  const meanings = uniqueBy(
    variants.flatMap((variant) => variant.meanings.map((meaning) => `${variantLabel(variant)}: ${meaning}`)),
    (meaning) => meaning.toLocaleLowerCase("de-DE"),
  );

  return {
    word: primary.word,
    article: primary.article,
    partOfSpeech: primary.partOfSpeech,
    meanings: meanings.length ? meanings : primary.meanings,
    examples: primary.examples,
    etymology: primary.etymology,
    morphemes: primary.morphemes,
    sourceUrl: primary.sourceUrl,
    compoundHint: null,
    articleReason: primary.articleReason,
    level: primary.level ?? null,
    headwordKey: headwordKeyFor(primary.word),
    displayHeadword: displayHeadwordFor(variants),
    variants,
    decompositionOptions: decompositionOptionsFromVariants(variants),
  };
}

export function articleForQuiz(entry: Pick<ParseResult, "article" | "variants">): Article {
  if (entry.article) return entry.article;
  return entry.variants?.find((variant) => variant.article)?.article ?? null;
}
