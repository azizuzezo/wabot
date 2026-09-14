-- Muter Assistant — Live Chat: tampilkan konteks reply/quote (baik reply
-- dari user WA maupun reply manual dari admin) di atas bubble pesan.
-- Denormalized (reply_to_text/reply_to_sender) biar render bubble tidak
-- perlu join/lookup pesan aslinya tiap kali (pesan yang di-quote bisa saja
-- di luar window riwayat yang dimuat, atau sudah lama).

ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS reply_to_id text;
ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS reply_to_text text;
ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS reply_to_sender text;
