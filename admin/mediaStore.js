import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Lampiran Live Chat (gambar/dokumen, masuk & keluar) disimpan di disk lokal
// per-jid, bukan Supabase Storage — konsisten dengan auth_info_baileys yang
// juga disimpan lokal (bot ini jalan sebagai proses tunggal di satu server).
const MEDIA_DIR = path.join(process.cwd(), "media-cache");

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

function extFromMime(mimetype) {
  if (EXT_BY_MIME[mimetype]) return EXT_BY_MIME[mimetype];
  const sub = String(mimetype || "").split("/")[1] || "bin";
  return sub.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
}

function dirFor(jid) {
  return path.join(MEDIA_DIR, encodeURIComponent(jid));
}

export function saveMedia(jid, buffer, mimetype) {
  const dir = dirFor(jid);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}.${extFromMime(mimetype)}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return filename;
}

// path.basename() di sini penting: filename datang dari URL request (lihat
// route GET /api/media/:jid/:filename di admin/server.js), jadi harus dicegah
// dari path traversal (../../auth_info_baileys/creds.json dst).
export function mediaFilePath(jid, filename) {
  return path.join(dirFor(jid), path.basename(filename));
}
