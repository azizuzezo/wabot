-- Muter Assistant — migration untuk multi-akun admin dashboard dengan hak akses terbatas.
-- role 'super'  = akses penuh (setara ADMIN_USERNAME/ADMIN_PASSWORD di .env)
-- role 'scoped' = hanya bisa kelola grup yang ada di allowed_groups, tidak bisa
--                 akses Owner Admin, Pengaturan AI global, atau grup lain.

CREATE TABLE IF NOT EXISTS bot_admin_users (
  username text PRIMARY KEY,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'scoped',
  allowed_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text,
  created_at timestamptz DEFAULT now()
);
