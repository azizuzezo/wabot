import { randomUUID } from "node:crypto";
import { database } from "./db.js";
import { embedText, cosineSimilarity } from "./gemini.js";

const CHUNK_SIZE = 1_100;
const CHUNK_OVERLAP = 150;
const RAG_TOP_K = 4;
const RAG_MIN_SCORE = 0.62;
const NOTES_MAX_CHARS = 4_000;

function chunkText(text) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();

  if (!clean) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push(clean.slice(start, end).trim());

    if (end >= clean.length) {
      break;
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks.filter(Boolean);
}

function ensureDatabase() {
  if (!database) {
    throw new Error("Database (Supabase) belum dikonfigurasi.");
  }
}

// group_id null = knowledge berlaku global (semua grup)
export async function listKnowledge(groupId) {
  ensureDatabase();

  let query = database
    .from("bot_knowledge")
    .select(
      "id,group_id,type,title,source_filename,chunk_index,chunk_count,content,created_by,created_at"
    )
    .order("created_at", { ascending: false });

  if (groupId) {
    query = query.or(`group_id.eq.${groupId},group_id.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

// Dipakai akun 'scoped' — hanya grup-grup yang diizinkan, TANPA knowledge global.
export async function listKnowledgeForGroups(groupIds) {
  ensureDatabase();

  if (!Array.isArray(groupIds) || !groupIds.length) {
    return [];
  }

  const { data, error } = await database
    .from("bot_knowledge")
    .select(
      "id,group_id,type,title,source_filename,chunk_index,chunk_count,content,created_by,created_at"
    )
    .in("group_id", groupIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function getKnowledgeById(id) {
  ensureDatabase();

  const { data, error } = await database
    .from("bot_knowledge")
    .select("id,group_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function addNote({ groupId, title, content, createdBy }) {
  ensureDatabase();

  const text = String(content || "").trim();

  if (!text) {
    throw new Error("Isi knowledge tidak boleh kosong.");
  }

  let embedding = null;

  try {
    embedding = await embedText(`${title || ""}\n${text}`.trim());
  } catch {
    embedding = null;
  }

  const row = {
    id: randomUUID(),
    group_id: groupId || null,
    type: "note",
    title: title || null,
    content: text,
    embedding,
    source_filename: null,
    chunk_index: 0,
    chunk_count: 1,
    created_by: createdBy || null,
    created_at: new Date().toISOString(),
  };

  const { error } = await database.from("bot_knowledge").insert(row);

  if (error) {
    throw error;
  }

  return row;
}

export async function addDocument({ groupId, title, sourceFilename, fullText, createdBy }) {
  ensureDatabase();

  const chunks = chunkText(fullText);

  if (!chunks.length) {
    throw new Error("Dokumen tidak berisi teks yang bisa diproses.");
  }

  const rows = [];

  for (let i = 0; i < chunks.length; i++) {
    let embedding = null;

    try {
      embedding = await embedText(chunks[i]);
    } catch {
      embedding = null;
    }

    rows.push({
      id: randomUUID(),
      group_id: groupId || null,
      type: "document",
      title: title || sourceFilename || "Dokumen",
      content: chunks[i],
      embedding,
      source_filename: sourceFilename || null,
      chunk_index: i,
      chunk_count: chunks.length,
      created_by: createdBy || null,
      created_at: new Date().toISOString(),
    });
  }

  const { error } = await database.from("bot_knowledge").insert(rows);

  if (error) {
    throw error;
  }

  return { chunkCount: rows.length };
}

export async function deleteKnowledge(id) {
  ensureDatabase();

  const { error } = await database.from("bot_knowledge").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deleteKnowledgeGroup({ groupId, sourceFilename, title }) {
  ensureDatabase();

  let query = database.from("bot_knowledge").delete();

  query = groupId ? query.eq("group_id", groupId) : query.is("group_id", null);

  if (sourceFilename) {
    query = query.eq("source_filename", sourceFilename);
  } else if (title) {
    query = query.eq("title", title);
  }

  const { error } = await query;

  if (error) {
    throw error;
  }
}

// Dibangun untuk disisipkan ke system prompt AI: catatan (note) selalu
// disertakan penuh, potongan dokumen diambil lewat pencarian kemiripan (RAG).
export async function buildKnowledgeContext(groupId, query) {
  if (!database) {
    return "";
  }

  let rows;

  try {
    rows = await listKnowledge(groupId);
  } catch {
    return "";
  }

  if (!rows.length) {
    return "";
  }

  const notes = rows.filter((row) => row.type === "note");
  const documents = rows.filter((row) => row.type === "document" && Array.isArray(row.embedding));

  const sections = [];

  if (notes.length) {
    let notesText = notes
      .map((note) => `- ${note.title ? `${note.title}: ` : ""}${note.content}`)
      .join("\n");

    if (notesText.length > NOTES_MAX_CHARS) {
      notesText = `${notesText.slice(0, NOTES_MAX_CHARS)}\n…`;
    }

    sections.push(`Catatan / aturan yang wajib kamu ikuti:\n${notesText}`);
  }

  if (documents.length && query) {
    try {
      const queryEmbedding = await embedText(query, "RETRIEVAL_QUERY");

      const ranked = documents
        .map((doc) => ({
          doc,
          score: cosineSimilarity(queryEmbedding, doc.embedding),
        }))
        .filter((item) => item.score >= RAG_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, RAG_TOP_K);

      if (ranked.length) {
        const docText = ranked
          .map(
            (item) =>
              `[Sumber: ${item.doc.title || item.doc.source_filename || "Dokumen"}]\n${item.doc.content}`
          )
          .join("\n\n");

        sections.push(`Potongan dokumen referensi yang relevan dengan pertanyaan:\n${docText}`);
      }
    } catch {
      // Retrieval opsional — abaikan jika embedding query gagal.
    }
  }

  if (!sections.length) {
    return "";
  }

  return `\n\nInformasi tambahan (knowledge base):\n${sections.join("\n\n")}\n`;
}
