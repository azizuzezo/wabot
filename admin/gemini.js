// Embeddings selalu memakai endpoint resmi Google + GEMINI_API_KEY (bukan
// AI_BASE_URL/AI_API_KEY, yang di proyek ini sering diarahkan ke proxy chat
// pihak ketiga yang belum tentu mendukung endpoint embedContent).
const EMBED_BASE_URL = (
  process.env.GEMINI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/+$/, "");

const EMBED_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.AI_API_KEY ||
  ""
).trim();

const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "gemini-embedding-001";

// taskType: "RETRIEVAL_DOCUMENT" saat menyimpan knowledge, "RETRIEVAL_QUERY"
// saat mencari — embedding asimetris ini jauh lebih akurat untuk RAG
// dibanding menyamakan tipe keduanya.
export async function embedText(text, taskType = "RETRIEVAL_DOCUMENT") {
  if (!EMBED_API_KEY) {
    throw new Error("GEMINI_API_KEY tidak dikonfigurasi");
  }

  const url = `${EMBED_BASE_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(
    EMBED_API_KEY
  )}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text }],
      },
      taskType,
    }),
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Embedding API invalid response: ${raw}`);
  }

  if (!response.ok) {
    throw new Error(`Embedding API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data?.embedding?.values || [];
}

// Dipakai admin dashboard untuk validasi nama model chat (AI_BASE_URL/AI_API_KEY,
// endpoint yang sama dipakai callGeminiGenerate di index.js) sebelum disimpan,
// supaya typo nama model ketahuan langsung bukan pas bot lagi dipakai user.
const CHAT_BASE_URL = (
  process.env.AI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/+$/, "");

const CHAT_API_KEY = (
  process.env.AI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  ""
).trim();

export async function testChatModel(model, { baseUrl, apiKey } = {}) {
  if (!model) {
    return { ok: true };
  }

  const effectiveBaseUrl = (baseUrl || CHAT_BASE_URL).replace(/\/+$/, "");
  const effectiveApiKey = apiKey || CHAT_API_KEY;

  if (!effectiveApiKey) {
    return { ok: true };
  }

  try {
    const url = `${effectiveBaseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });

    const data = await response.json().catch(() => null);

    if (response.ok && !data?.error) {
      return { ok: true };
    }

    return { ok: false, error: data?.error?.message || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
