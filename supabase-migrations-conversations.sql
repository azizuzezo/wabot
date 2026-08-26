-- Muter Assistant — migration untuk fitur "Live Chat" di admin dashboard:
-- riwayat pesan (DM & grup) dan status takeover (bot vs manusia) per
-- percakapan, supaya admin bisa ambil alih chat dan bot otomatis berhenti
-- menjawab sampai dilepas kembali.

CREATE TABLE IF NOT EXISTS bot_chat_state (
  jid text PRIMARY KEY,
  is_group boolean NOT NULL DEFAULT false,
  name text,
  taken_over boolean NOT NULL DEFAULT false,
  taken_over_by text,
  taken_over_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_chat_state_last_message_idx
  ON bot_chat_state (last_message_at DESC);

CREATE TABLE IF NOT EXISTS bot_chat_messages (
  id text PRIMARY KEY,
  jid text NOT NULL,
  direction text NOT NULL,
  sender_jid text,
  push_name text,
  text text,
  from_bot boolean NOT NULL DEFAULT false,
  from_admin text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_chat_messages_jid_created_idx
  ON bot_chat_messages (jid, created_at);
