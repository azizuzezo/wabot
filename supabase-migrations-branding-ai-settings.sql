-- Muter Assistant — migration untuk admin dashboard: nama bot & credit
-- (branding), system prompt AI custom, dan override API key / base URL AI
-- chat, semuanya bisa diatur lewat tab "Pengaturan AI" tanpa perlu edit .env.

ALTER TABLE bot_global_settings
  ADD COLUMN IF NOT EXISTS bot_name text,
  ADD COLUMN IF NOT EXISTS bot_credit text,
  ADD COLUMN IF NOT EXISTS ai_system_prompt text,
  ADD COLUMN IF NOT EXISTS ai_api_key text,
  ADD COLUMN IF NOT EXISTS ai_base_url text;
