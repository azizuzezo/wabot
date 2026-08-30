import { randomUUID } from "node:crypto";
import { database } from "./db.js";
import { botState, botEvents, setChatTakeover } from "./bridge.js";
import { saveMedia } from "./mediaStore.js";

const MESSAGE_HISTORY_LIMIT = 200;
const CHAT_LIST_LIMIT = 200;
const PREVIEW_LENGTH = 120;
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;

function ensureDatabase() {
  if (!database) {
    throw new Error("Database (Supabase) belum dikonfigurasi.");
  }
}

function buildMediaUrl(jid, filename) {
  if (!filename) return null;
  return `/api/media/${encodeURIComponent(jid)}/${filename}`;
}

function mediaPreviewText(mediaType, mediaFilename) {
  if (mediaType === "image") return "📷 Foto";
  if (mediaType === "document") return `📄 ${mediaFilename || "Dokumen"}`;
  return "";
}

const CHAT_SELECT =
  "jid,is_group,name,taken_over,taken_over_by,taken_over_at,last_message_at,last_message_preview,avatar_url";

function mapChatRow(row) {
  return {
    jid: row.jid,
    isGroup: Boolean(row.is_group),
    name: row.name,
    takenOver: Boolean(row.taken_over),
    takenOverBy: row.taken_over_by,
    takenOverAt: row.taken_over_at,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    avatarUrl: row.avatar_url || null,
  };
}

function mapMessageRow(row) {
  return {
    id: row.id,
    jid: row.jid,
    direction: row.direction,
    senderJid: row.sender_jid,
    pushName: row.push_name,
    text: row.text,
    fromBot: Boolean(row.from_bot),
    fromAdmin: row.from_admin,
    createdAt: row.created_at,
    mediaType: row.media_type || null,
    mediaUrl: buildMediaUrl(row.jid, row.media_path),
    mediaFilename: row.media_filename || null,
    mediaMimetype: row.media_mimetype || null,
  };
}

async function touchChatState({ jid, isGroup, name, preview, at }) {
  const row = {
    jid,
    is_group: Boolean(isGroup),
    last_message_at: at,
    last_message_preview: preview,
    updated_at: new Date().toISOString(),
  };

  if (name) {
    row.name = name;
  }

  const { error } = await database.from("bot_chat_state").upsert(row);

  if (error) {
    throw error;
  }
}

// Dipanggil dari index.js untuk setiap pesan masuk (DM & grup) maupun keluar
// (balasan AI, atau pesan manual dari admin panel). Insert pesan pakai id
// message WhatsApp asli (msg.key.id) supaya idempotent — kalau baileys
// re-deliver event yang sama, insert kedua akan gagal karena PK bentrok dan
// diabaikan diam-diam, bukan dobel tercatat.
// media (opsional): { mediaType: 'image'|'document', buffer, mimetype, filename }
// — file asli disimpan ke disk di sini (saveMedia), DB cuma nyimpan nama filenya.
export async function recordMessage({
  id,
  jid,
  direction,
  isGroup,
  senderJid,
  pushName,
  text,
  fromBot,
  fromAdmin,
  chatName,
  media,
}) {
  ensureDatabase();

  const messageId = id || randomUUID();
  const now = new Date().toISOString();

  let mediaType = null;
  let mediaPath = null;
  let mediaFilename = null;
  let mediaMimetype = null;

  if (media?.buffer) {
    mediaType = media.mediaType;
    mediaMimetype = media.mimetype || null;
    mediaFilename = media.filename || null;
    mediaPath = saveMedia(jid, media.buffer, media.mimetype);
  }

  const { error } = await database.from("bot_chat_messages").insert({
    id: messageId,
    jid,
    direction,
    sender_jid: senderJid || null,
    push_name: pushName || null,
    text: text || null,
    from_bot: Boolean(fromBot),
    from_admin: fromAdmin || null,
    created_at: now,
    media_type: mediaType,
    media_path: mediaPath,
    media_filename: mediaFilename,
    media_mimetype: mediaMimetype,
  });

  if (error && error.code !== "23505") {
    throw error;
  }

  const preview = String(text || "").slice(0, PREVIEW_LENGTH) || mediaPreviewText(mediaType, mediaFilename);
  await touchChatState({ jid, isGroup, name: chatName, preview, at: now });

  botEvents.emit("chat-message", {
    id: messageId,
    jid,
    direction,
    isGroup: Boolean(isGroup),
    senderJid: senderJid || null,
    pushName: pushName || null,
    text: text || null,
    fromBot: Boolean(fromBot),
    fromAdmin: fromAdmin || null,
    createdAt: now,
    preview,
    mediaType,
    mediaUrl: buildMediaUrl(jid, mediaPath),
    mediaFilename,
    mediaMimetype,
  });
}

// allowedGroups: null = super (semua chat), array = scoped (semua DM + grup
// yang diizinkan). DM belum punya konsep scoping per-admin — lihat
// canAccessChat di admin/auth.js.
export async function listChats({ allowedGroups }) {
  ensureDatabase();

  if (!Array.isArray(allowedGroups)) {
    const { data, error } = await database
      .from("bot_chat_state")
      .select(CHAT_SELECT)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(CHAT_LIST_LIMIT);

    if (error) throw error;
    return (data || []).map(mapChatRow);
  }

  const [dmResult, groupResult] = await Promise.all([
    database
      .from("bot_chat_state")
      .select(CHAT_SELECT)
      .eq("is_group", false)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(CHAT_LIST_LIMIT),
    allowedGroups.length
      ? database
          .from("bot_chat_state")
          .select(CHAT_SELECT)
          .eq("is_group", true)
          .in("jid", allowedGroups)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(CHAT_LIST_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (dmResult.error) throw dmResult.error;
  if (groupResult.error) throw groupResult.error;

  const merged = [...(dmResult.data || []), ...(groupResult.data || [])];
  merged.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

  return merged.map(mapChatRow);
}

export async function getMessages(jid, { limit = MESSAGE_HISTORY_LIMIT } = {}) {
  ensureDatabase();

  const { data, error } = await database
    .from("bot_chat_messages")
    .select(
      "id,jid,direction,sender_jid,push_name,text,from_bot,from_admin,created_at,media_type,media_path,media_filename,media_mimetype"
    )
    .eq("jid", jid)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).reverse().map(mapMessageRow);
}

export async function setTakeover(jid, { takenOver, byAdmin, isGroup, name }) {
  ensureDatabase();

  const now = new Date().toISOString();

  const row = {
    jid,
    is_group: Boolean(isGroup),
    taken_over: Boolean(takenOver),
    taken_over_by: takenOver ? byAdmin || null : null,
    taken_over_at: takenOver ? now : null,
    updated_at: now,
  };

  if (name) {
    row.name = name;
  }

  const { error } = await database.from("bot_chat_state").upsert(row);

  if (error) {
    throw error;
  }

  setChatTakeover(jid, row.taken_over);
  botEvents.emit("chat-takeover", { jid, takenOver: row.taken_over, byAdmin: row.taken_over_by });

  return { jid, takenOver: row.taken_over, takenOverBy: row.taken_over_by, takenOverAt: row.taken_over_at };
}

// Dipanggil saat bot startup supaya cache in-memory (dibaca sinkron oleh
// index.js) selaras dengan state di DB setelah restart.
export async function loadChatTakeoverState() {
  if (!database) {
    return;
  }

  const { data, error } = await database
    .from("bot_chat_state")
    .select("jid,taken_over")
    .eq("taken_over", true);

  if (error) {
    throw error;
  }

  for (const row of data || []) {
    setChatTakeover(row.jid, true);
  }
}

// Dipakai admin panel utk kirim pesan manual ke sebuah chat. Kirim manual =
// otomatis ambil alih chat ini dari bot (lihat setTakeover di bawah), supaya
// bot tidak ikut menjawab bersamaan dengan admin.
export async function sendChatMessage({ jid, isGroup, text, fromAdmin, chatName }) {
  ensureDatabase();

  if (!botState.sock) {
    throw new Error("WhatsApp belum terhubung");
  }

  const sent = await botState.sock.sendMessage(jid, { text });

  await recordMessage({
    id: sent?.key?.id,
    jid,
    direction: "out",
    isGroup,
    text,
    fromAdmin,
    chatName,
  });

  await setTakeover(jid, { takenOver: true, byAdmin: fromAdmin, isGroup, name: chatName });
}

// Sama seperti sendChatMessage tapi dengan lampiran gambar/dokumen. Tipe
// ditentukan dari mimetype upload-nya: image/* -> pesan gambar (caption
// opsional), selain itu -> pesan dokumen (perlu fileName).
export async function sendChatMedia({ jid, isGroup, buffer, mimetype, filename, caption, fromAdmin, chatName }) {
  ensureDatabase();

  if (!botState.sock) {
    throw new Error("WhatsApp belum terhubung");
  }

  const isImage = String(mimetype || "").startsWith("image/");
  const mediaType = isImage ? "image" : "document";

  const payload = isImage
    ? { image: buffer, mimetype, caption: caption || undefined }
    : { document: buffer, mimetype, fileName: filename || "document", caption: caption || undefined };

  const sent = await botState.sock.sendMessage(jid, payload);

  await recordMessage({
    id: sent?.key?.id,
    jid,
    direction: "out",
    isGroup,
    text: caption || null,
    fromAdmin,
    chatName,
    media: { mediaType, buffer, mimetype, filename },
  });

  await setTakeover(jid, { takenOver: true, byAdmin: fromAdmin, isGroup, name: chatName });
}

// Ambil (dan cache 24 jam di bot_chat_state) URL foto profil WhatsApp untuk
// sebuah jid — dipakai admin panel biar avatar di Live Chat mirip WA asli.
// URL dari Baileys sudah berupa link CDN publik (pps.whatsapp.net), jadi
// cukup dipakai langsung sebagai <img src>, tidak perlu di-proxy.
export async function ensureAvatarUrl(jid, { isGroup = false, force = false } = {}) {
  ensureDatabase();

  const { data, error: selectError } = await database
    .from("bot_chat_state")
    .select("avatar_url,avatar_fetched_at")
    .eq("jid", jid)
    .maybeSingle();

  if (selectError) throw selectError;

  const fetchedAt = data?.avatar_fetched_at ? new Date(data.avatar_fetched_at).getTime() : 0;
  const isFresh = !force && Date.now() - fetchedAt < AVATAR_TTL_MS;

  if (isFresh) {
    return data.avatar_url;
  }

  if (!botState.sock) {
    return data?.avatar_url || null;
  }

  let avatarUrl = null;

  try {
    avatarUrl = await botState.sock.profilePictureUrl(jid, "image");
  } catch {
    avatarUrl = null;
  }

  const { error } = await database.from("bot_chat_state").upsert({
    jid,
    is_group: Boolean(isGroup),
    avatar_url: avatarUrl,
    avatar_fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;

  botEvents.emit("chat-avatar", { jid, avatarUrl });

  return avatarUrl;
}

// Best-effort, non-blocking: dipanggil setelah listChats() supaya chat yang
// belum punya avatar_url ter-cache langsung diisi di background, lalu
// dikirim ke client via SSE ("chat-avatar") begitu selesai.
export function refreshMissingAvatars(chats) {
  for (const chat of chats) {
    if (!chat.avatarUrl) {
      ensureAvatarUrl(chat.jid, { isGroup: chat.isGroup }).catch(() => {});
    }
  }
}
