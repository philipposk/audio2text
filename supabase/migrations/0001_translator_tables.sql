-- Translator app schema for Supabase (production / Vercel persistence).
--
-- Tables are prefixed `translator_` so they coexist with other apps in a shared
-- Supabase project. The server reaches them ONLY via the service_role key, which
-- bypasses RLS — so RLS is enabled with no policies (anon/authenticated get zero
-- access). Security for the app's data lives at the API layer (x-api-key auth),
-- not at the row level.
--
-- Apply with: supabase db push   (or paste into the Supabase SQL editor).

CREATE TABLE IF NOT EXISTS public.translator_jobs (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  type        TEXT,
  source_name TEXT,
  language    TEXT,
  task        TEXT,
  method      TEXT,
  duration    FLOAT,
  text        TEXT,
  segments    JSONB DEFAULT '[]',
  meta        JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.translator_api_keys (
  id            TEXT PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  label         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  revoked       BOOLEAN DEFAULT FALSE,
  quota_seconds INTEGER DEFAULT 36000
);

CREATE TABLE IF NOT EXISTS public.translator_usage (
  id        SERIAL PRIMARY KEY,
  key       TEXT NOT NULL,
  day       TEXT NOT NULL,
  seconds   FLOAT DEFAULT 0,
  calls     INTEGER DEFAULT 0,
  endpoints JSONB DEFAULT '{}',
  UNIQUE (key, day)
);

CREATE TABLE IF NOT EXISTS public.translator_glossaries (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_lang TEXT,
  target_lang TEXT,
  entries     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tj_created  ON public.translator_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tj_language ON public.translator_jobs(language);
CREATE INDEX IF NOT EXISTS idx_tj_task     ON public.translator_jobs(task);
CREATE INDEX IF NOT EXISTS idx_tj_type     ON public.translator_jobs(type);
CREATE INDEX IF NOT EXISTS idx_tu_key_day  ON public.translator_usage(key, day);

ALTER TABLE public.translator_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translator_api_keys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translator_usage      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translator_glossaries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.translator_jobs       IS 'Translator app: transcription/translation jobs. Service-role access only.';
COMMENT ON TABLE public.translator_glossaries IS 'Translator app: translation glossaries. Service-role access only.';
