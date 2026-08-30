-- Muter Assistant — override mode trigger AI (command vs tanpa command) per
-- fitur (obrolan umum, reminder, catatan, kirim pesan ke nomor lain),
-- terpisah dari ai_trigger_mode yang cuma satu switch untuk semuanya.
-- Disimpan sebagai jsonb: { chat, reminder, note, sendMessage } masing-masing
-- "command" | "always" | null (null/absent = ikut ai_trigger_mode).

ALTER TABLE bot_global_settings
  ADD COLUMN IF NOT EXISTS ai_feature_modes jsonb;

ALTER TABLE bot_group_settings
  ADD COLUMN IF NOT EXISTS ai_feature_modes jsonb;
