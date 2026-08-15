create table if not exists runtime_words (
  normalized_word text primary key,
  word text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runtime_words_updated_at_idx
  on runtime_words (updated_at desc);
