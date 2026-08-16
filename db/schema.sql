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
