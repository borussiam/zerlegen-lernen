create table if not exists runtime_words (
  normalized_word text primary key,
  word text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runtime_words_updated_at_idx
  on runtime_words (updated_at desc);

alter table runtime_words
  add column if not exists headword_key text;

alter table runtime_words
  add column if not exists part_of_speech text;

alter table runtime_words
  add column if not exists article text;

update runtime_words
set
  headword_key = lower(word),
  part_of_speech = result->>'partOfSpeech',
  article = result->>'article'
where headword_key is null;

create index if not exists runtime_words_headword_key_idx
  on runtime_words (headword_key);

create table if not exists lemmas (
  lemma_id text primary key,
  headword text not null,
  headword_key text not null,
  part_of_speech text,
  article text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lemmas_article_check check (article is null or article in ('der', 'die', 'das'))
);

create index if not exists lemmas_headword_key_idx
  on lemmas (headword_key);

create index if not exists lemmas_part_of_speech_idx
  on lemmas (part_of_speech);

create index if not exists lemmas_result_gin_idx
  on lemmas using gin (result jsonb_path_ops);

create table if not exists inflection_surface_forms (
  id bigserial primary key,
  surface_form text not null,
  surface_key text generated always as (lower(surface_form)) stored,
  lemma_id text not null references lemmas (lemma_id) on delete cascade,
  morphology jsonb not null default '{}'::jsonb,
  exact_case boolean not null default true,
  source text not null default 'runtime',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (surface_form, lemma_id, morphology)
);

create index if not exists inflection_surface_forms_surface_form_idx
  on inflection_surface_forms (surface_form);

create index if not exists inflection_surface_forms_surface_key_idx
  on inflection_surface_forms (surface_key);

create index if not exists inflection_surface_forms_lemma_id_idx
  on inflection_surface_forms (lemma_id);

create index if not exists inflection_surface_forms_morphology_gin_idx
  on inflection_surface_forms using gin (morphology jsonb_path_ops);
