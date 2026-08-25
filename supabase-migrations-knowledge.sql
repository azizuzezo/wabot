-- Muter Assistant — migration untuk admin dashboard: knowledge base (notes + RAG documents).
-- Jalankan file ini sekali di Supabase SQL Editor sebelum menggunakan halaman admin.

CREATE TABLE IF NOT EXISTS bot_knowledge (
  id text PRIMARY KEY,
  group_id text,                       -- NULL = berlaku untuk semua grup
  type text NOT NULL DEFAULT 'note',   -- 'note' (teks singkat) | 'document' (potongan dokumen RAG)
  title text,
  content text NOT NULL,
  embedding jsonb,                     -- vector embedding (array of float), dipakai untuk pencarian RAG
  source_filename text,
  chunk_index integer NOT NULL DEFAULT 0,
  chunk_count integer NOT NULL DEFAULT 1,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_knowledge_group_id_idx ON bot_knowledge (group_id);
CREATE INDEX IF NOT EXISTS bot_knowledge_type_idx ON bot_knowledge (type);
