-- Muter Assistant — migration untuk fitur baru:
-- filter spam, moderasi gambar, note, poll, trivia, statistik grup.
-- Jalankan file ini sekali di Supabase SQL Editor sebelum restart bot.

-- 1. Kolom baru di bot_group_settings (toggle antispam / img moderation / badword list)
ALTER TABLE bot_group_settings
  ADD COLUMN IF NOT EXISTS anti_spam boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS img_moderation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bad_words jsonb DEFAULT '[]'::jsonb;

-- 2. Catatan grup (!note)
CREATE TABLE IF NOT EXISTS bot_notes (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  content text NOT NULL,
  creator_jid text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_notes_group_id_idx ON bot_notes (group_id);

-- 3. Polling (!poll / !vote / !pollclose)
CREATE TABLE IF NOT EXISTS bot_polls (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  votes jsonb NOT NULL DEFAULT '{}'::jsonb,
  creator_jid text,
  status text NOT NULL DEFAULT 'open',
  close_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_polls_group_status_idx ON bot_polls (group_id, status);

-- 4. Skor trivia (!trivia / !jawab / !triviascore)
CREATE TABLE IF NOT EXISTS bot_trivia_scores (
  group_id text NOT NULL,
  user_jid text NOT NULL,
  correct_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_jid)
);

-- 5. Statistik aktivitas grup (!stats / !statsreset)
CREATE TABLE IF NOT EXISTS bot_group_stats (
  group_id text NOT NULL,
  user_jid text NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_jid)
);
