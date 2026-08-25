-- Muter Assistant — migration untuk admin dashboard: chat personal (DM),
-- mode trigger AI (command vs tanpa command), dan pilihan model AI.

-- 1. Override per-grup (NULL = ikuti pengaturan global)
ALTER TABLE bot_group_settings
  ADD COLUMN IF NOT EXISTS ai_trigger_mode text,
  ADD COLUMN IF NOT EXISTS ai_model text;

-- 2. Pengaturan global (satu baris tunggal, id = 'default')
CREATE TABLE IF NOT EXISTS bot_global_settings (
  id text PRIMARY KEY DEFAULT 'default',
  dm_enabled boolean NOT NULL DEFAULT false,
  ai_trigger_mode text NOT NULL DEFAULT 'command',
  ai_model text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO bot_global_settings (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;
