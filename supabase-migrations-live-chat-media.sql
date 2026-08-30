-- Muter Assistant — tambahan untuk Live Chat: foto profil WhatsApp (cache)
-- dan lampiran gambar/dokumen (metadata; file asli disimpan di disk lokal
-- lewat admin/mediaStore.js).

ALTER TABLE bot_chat_state ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE bot_chat_state ADD COLUMN IF NOT EXISTS avatar_fetched_at timestamptz;

ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS media_path text;
ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS media_filename text;
ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS media_mimetype text;
