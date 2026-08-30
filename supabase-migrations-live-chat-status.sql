-- Muter Assistant — status kirim pesan keluar di Live Chat (centang WA:
-- sent/delivered/read), diisi dari event messages.update Baileys.

ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS status text;
