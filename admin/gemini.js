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

// TTS juga selalu ke endpoint resmi Google + GEMINI_API_KEY, sama seperti
// embedText di atas — proxy chat pihak ketiga (AI_BASE_URL/AI_API_KEY) belum
// tentu mendukung endpoint /interactions ini.
const TTS_BASE_URL = EMBED_BASE_URL;
const TTS_API_KEY = EMBED_API_KEY;
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";
// Gemini TTS tidak punya field API terpisah buat gaya bicara (beda dari
// "Director's note" Style/Pace/Accent di AI Studio, yang sebenarnya cuma
// UI buat menyusun instruksi bahasa natural) — jadi gaya bicara dikontrol
// dengan menempelkan instruksi ini di depan teks sebelum dikirim.
const TTS_STYLE =
  process.env.GEMINI_TTS_STYLE ||
  "Say in an empathetic tone, at a natural pace, with a neutral accent";

// Gemini TTS balikin audio sebagai PCM mentah (mono, 16-bit, 24kHz) via
// base64, bukan file audio yang siap diputar — makanya perlu dibungkus
// header WAV manual di sini (44 byte, format PCM standar) biar bisa
// diputar di browser maupun dikirim sebagai voice note WhatsApp.
function pcmToWav(pcmBuffer, { sampleRate = 24000, channels = 1, bitDepth = 16 } = {}) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Dipakai admin panel Live Chat: ubah teks jadi voice note bersuara AI
// (Gemini 3.1 Flash TTS) sebelum dikirim ke WhatsApp. Beda dari generateContent
// biasa, TTS Gemini lewat endpoint /interactions (bukan /models/{model}:generateContent).
export async function synthesizeSpeech(text, { voice } = {}) {
  if (!TTS_API_KEY) {
    throw new Error("GEMINI_API_KEY tidak dikonfigurasi");
  }

  const response = await fetch(`${TTS_BASE_URL}/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": TTS_API_KEY,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: TTS_STYLE ? `${TTS_STYLE}: ${text}` : text,
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice: voice || TTS_VOICE }],
      },
    }),
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`TTS API invalid response: ${raw}`);
  }

  if (!response.ok) {
    throw new Error(`TTS API error ${response.status}: ${data?.error?.message || raw}`);
  }

  // Bentuk respons /interactions: audio ada di steps[].content[] (item
  // dengan type "audio"), bukan di field "output_audio" seperti contoh di
  // dokumentasi publik Google — dicek langsung ke API dan ternyata beda.
  const audioContent = (data?.steps || [])
    .flatMap((step) => step?.content || [])
    .find((item) => item?.type === "audio" && item?.data);

  if (!audioContent) {
    throw new Error("TTS API tidak mengembalikan audio");
  }

  return pcmToWav(Buffer.from(audioContent.data, "base64"), {
    sampleRate: audioContent.sample_rate || 24000,
    channels: audioContent.channels || 1,
  });
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
