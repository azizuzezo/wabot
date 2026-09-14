-- Muter Assistant — Live Chat: tandai foto yang dikirim admin sebagai
-- "sekali lihat" (view once), biar keliatan di riwayat Live Chat kita sendiri
-- foto mana yang dikirim mode itu ke user.

ALTER TABLE bot_chat_messages ADD COLUMN IF NOT EXISTS media_view_once boolean NOT NULL DEFAULT false;
