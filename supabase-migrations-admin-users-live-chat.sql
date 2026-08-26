-- Tambah kolom untuk membatasi akses tab Live Chat per akun admin.
-- Default true supaya akun yang sudah ada tetap bisa akses seperti sebelumnya,
-- lalu super admin bisa menonaktifkannya per akun lewat tab "Akun Admin".
ALTER TABLE bot_admin_users
  ADD COLUMN IF NOT EXISTS can_access_live_chat boolean NOT NULL DEFAULT true;
