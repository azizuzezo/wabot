import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import express from "express";
import session from "express-session";
import multer from "multer";
import QRCode from "qrcode";

import { botState, botEvents, getStatusSnapshot, globalSettings, setAccountCoverPhotoId } from "./bridge.js";
import {
  adminAuthConfigured,
  verifyCredentials,
  requireAuth,
  requireSuper,
  canAccessGroup,
  canAccessChat,
  canAccessLiveChat,
} from "./auth.js";
import {
  listGroups,
  setGroupEnabled,
  getGroupSettingsWeb,
  updateGroupSettingsWeb,
  listOwnerAdmins,
  addOwnerAdminWeb,
  removeOwnerAdminWeb,
} from "./groups.js";
import {
  listKnowledge,
  listKnowledgeForGroups,
  getKnowledgeById,
  addNote,
  addDocument,
  deleteKnowledge,
} from "./knowledge.js";
import { loadGlobalSettings, updateGlobalSettings } from "./globalSettings.js";
import { testChatModel, synthesizeSpeech } from "./gemini.js";
import {
  listAdminUsers,
  createAdminUser,
  setAdminUserLiveChatAccess,
  deleteAdminUser,
} from "./adminUsers.js";
import {
  listChats,
  getMessages,
  setTakeover,
  sendChatMessage,
  sendChatMedia,
  deleteChatMessage,
  deleteAllChats,
  ensureAvatarUrl,
  refreshMissingAvatars,
} from "./conversations.js";
import { mediaFilePath } from "./mediaStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3400);
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadChatMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function extractTextFromUpload(file) {
  const name = String(file.originalname || "").toLowerCase();

  if (name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  }

  return file.buffer.toString("utf8");
}

function asyncRoute(handler) {
  return (req, res) => {
    handler(req, res).catch((error) => {
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    });
  };
}

export function startAdminServer({ botName } = {}) {
  if (!adminAuthConfigured) {
    console.warn(
      "⚠️ ADMIN_USERNAME/ADMIN_PASSWORD belum diset di .env — halaman admin dinonaktifkan."
    );
    return;
  }

  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 12 * 60 * 60 * 1000,
      },
    })
  );

  // ---- Auth ----

  app.post(
    "/api/login",
    asyncRoute(async (req, res) => {
      const { username, password } = req.body || {};
      const result = await verifyCredentials(username, password);

      if (!result) {
        return res.status(401).json({ success: false, error: "Username atau password salah" });
      }

      req.session.authenticated = true;
      req.session.username = String(username || "").trim();
      req.session.role = result.role;
      req.session.allowedGroups = result.allowedGroups;
      req.session.canAccessLiveChat = result.canAccessLiveChat;
      res.json({ success: true });
    })
  );

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get("/api/me", (req, res) => {
    if (!req.session?.authenticated) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      username: req.session.username,
      role: req.session.role,
      allowedGroups: req.session.allowedGroups,
      canAccessLiveChat: canAccessLiveChat(req),
    });
  });

  // ---- Everything below requires login ----

  app.use("/api", requireAuth);

  app.get(
    "/api/qr.png",
    asyncRoute(async (req, res) => {
      if (!botState.qr) {
        return res.status(404).json({ success: false, error: "QR tidak tersedia" });
      }

      const dataUrl = await QRCode.toDataURL(botState.qr, { margin: 1, scale: 6 });
      const buffer = Buffer.from(dataUrl.split(",")[1], "base64");

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    })
  );

  app.get("/api/status", (req, res) => {
    res.json({ success: true, status: { ...getStatusSnapshot(), botName: botName || botState.botName } });
  });

  app.get("/api/status/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = () => {
      res.write(`data: ${JSON.stringify(getStatusSnapshot())}\n\n`);
    };

    send();
    botEvents.on("update", send);

    const keepAlive = setInterval(() => res.write(":\n\n"), 25_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      botEvents.off("update", send);
    });
  });

  // ---- Groups ----

  app.get(
    "/api/groups",
    asyncRoute(async (req, res) => {
      const groups = await listGroups();

      if (req.session.role !== "super") {
        return res.json({
          success: true,
          groups: groups.filter((g) => req.session.allowedGroups.includes(g.groupId)),
        });
      }

      res.json({ success: true, groups });
    })
  );

  app.post(
    "/api/groups",
    asyncRoute(async (req, res) => {
      const { groupId, name } = req.body || {};

      if (!groupId) {
        return res.status(400).json({ success: false, error: "groupId wajib diisi" });
      }

      if (!canAccessGroup(req, groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      await setGroupEnabled(groupId, true, name, req.session.username);
      res.json({ success: true });
    })
  );

  app.delete(
    "/api/groups/:groupId",
    asyncRoute(async (req, res) => {
      if (!canAccessGroup(req, req.params.groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      await setGroupEnabled(req.params.groupId, false);
      res.json({ success: true });
    })
  );

  // Keluar beneran dari grup WhatsApp (bukan cuma nonaktifkan bot di grup itu
  // — groupLeave bikin bot kepentok grup dan butuh diundang ulang kalau mau balik).
  app.post(
    "/api/groups/:groupId/leave",
    asyncRoute(async (req, res) => {
      if (!canAccessGroup(req, req.params.groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      await botState.sock.groupLeave(req.params.groupId);
      await setGroupEnabled(req.params.groupId, false);
      res.json({ success: true });
    })
  );

  app.get(
    "/api/groups/:groupId/settings",
    asyncRoute(async (req, res) => {
      if (!canAccessGroup(req, req.params.groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      res.json({ success: true, settings: await getGroupSettingsWeb(req.params.groupId) });
    })
  );

  app.put(
    "/api/groups/:groupId/settings",
    asyncRoute(async (req, res) => {
      if (!canAccessGroup(req, req.params.groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      const patch = req.body || {};

      if (patch.aiModel) {
        const test = await testChatModel(patch.aiModel, {
          baseUrl: globalSettings.aiBaseUrl,
          apiKey: globalSettings.aiApiKey,
        });

        if (!test.ok) {
          return res.status(400).json({ success: false, error: `Model tidak valid: ${test.error}` });
        }
      }

      const updated = await updateGroupSettingsWeb(req.params.groupId, patch);
      res.json({ success: true, settings: updated });
    })
  );

  // ---- Global AI settings (chat personal/DM, trigger mode, model default) ----
  // Khusus super admin — bot-wide, tidak cocok untuk akun scoped per-grup.

  app.get(
    "/api/global-settings",
    requireSuper,
    asyncRoute(async (req, res) => {
      const settings = await loadGlobalSettings();
      res.json({
        success: true,
        settings: {
          ...settings,
          aiApiKey: undefined,
          aiApiKeySet: Boolean(settings.aiApiKey),
          aiApiKeyPreview: settings.aiApiKey ? `••••${settings.aiApiKey.slice(-4)}` : null,
        },
      });
    })
  );

  app.put(
    "/api/global-settings",
    requireSuper,
    asyncRoute(async (req, res) => {
      const patch = req.body || {};

      if (patch.aiModel) {
        const test = await testChatModel(patch.aiModel, {
          baseUrl: patch.aiBaseUrl === undefined ? globalSettings.aiBaseUrl : patch.aiBaseUrl,
          apiKey: patch.aiApiKey === undefined ? globalSettings.aiApiKey : patch.aiApiKey,
        });

        if (!test.ok) {
          return res.status(400).json({ success: false, error: `Model tidak valid: ${test.error}` });
        }
      }

      const updated = await updateGlobalSettings(patch);
      res.json({ success: true, settings: updated });
    })
  );

  // ---- Akun WhatsApp: foto profil, banner (WA Business), nama, status,
  // privacy (khusus super admin — bot-wide, satu akun WA per bot) ----

  app.get(
    "/api/account",
    requireSuper,
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      const jid = botState.sock.user?.id;
      const [photoUrl, privacy, statusList] = await Promise.all([
        botState.sock.profilePictureUrl(jid, "image").catch(() => null),
        botState.sock.fetchPrivacySettings(true).catch(() => ({})),
        botState.sock.fetchStatus(jid).catch(() => null),
      ]);

      res.json({
        success: true,
        account: {
          jid,
          name: botState.sock.user?.name || null,
          status: statusList?.[0]?.status?.status || null,
          photoUrl,
          hasCoverPhotoId: Boolean(botState.accountCoverPhotoId),
          privacy,
        },
      });
    })
  );

  app.post(
    "/api/account/photo",
    requireSuper,
    upload.single("file"),
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: "File wajib diunggah" });
      }

      await botState.sock.updateProfilePicture(botState.sock.user.id, req.file.buffer);
      res.json({ success: true });
    })
  );

  app.delete(
    "/api/account/photo",
    requireSuper,
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      await botState.sock.removeProfilePicture(botState.sock.user.id);
      res.json({ success: true });
    })
  );

  // Banner/cover photo — cuma tampil di akun WhatsApp Business, bukan akun
  // personal biasa (WhatsApp tidak punya "banner" untuk akun personal).
  app.post(
    "/api/account/cover-photo",
    requireSuper,
    upload.single("file"),
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: "File wajib diunggah" });
      }

      const fbid = await botState.sock.updateCoverPhoto(req.file.buffer);
      setAccountCoverPhotoId(String(fbid));
      res.json({ success: true });
    })
  );

  app.delete(
    "/api/account/cover-photo",
    requireSuper,
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      if (!botState.accountCoverPhotoId) {
        return res.status(400).json({
          success: false,
          error: "ID banner tidak diketahui (bot baru restart) — upload banner baru dulu untuk bisa hapus dari sini.",
        });
      }

      await botState.sock.removeCoverPhoto(botState.accountCoverPhotoId);
      setAccountCoverPhotoId(null);
      res.json({ success: true });
    })
  );

  app.put(
    "/api/account/name",
    requireSuper,
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      const name = String(req.body?.name || "").trim();

      if (!name) {
        return res.status(400).json({ success: false, error: "Nama wajib diisi" });
      }

      await botState.sock.updateProfileName(name);
      res.json({ success: true });
    })
  );

  app.put(
    "/api/account/status",
    requireSuper,
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      await botState.sock.updateProfileStatus(String(req.body?.status || "").trim());
      res.json({ success: true });
    })
  );

  app.put(
    "/api/account/privacy",
    requireSuper,
    asyncRoute(async (req, res) => {
      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      const patch = req.body || {};
      const ops = [];

      if (patch.last) ops.push(botState.sock.updateLastSeenPrivacy(patch.last));
      if (patch.online) ops.push(botState.sock.updateOnlinePrivacy(patch.online));
      if (patch.profile) ops.push(botState.sock.updateProfilePicturePrivacy(patch.profile));
      if (patch.status) ops.push(botState.sock.updateStatusPrivacy(patch.status));
      if (patch.readreceipts) ops.push(botState.sock.updateReadReceiptsPrivacy(patch.readreceipts));
      if (patch.groupadd) ops.push(botState.sock.updateGroupsAddPrivacy(patch.groupadd));

      await Promise.all(ops);
      const privacy = await botState.sock.fetchPrivacySettings(true);
      res.json({ success: true, privacy });
    })
  );

  // ---- Owner admins (khusus super admin — bot-wide) ----

  app.get(
    "/api/owner-admins",
    requireSuper,
    asyncRoute(async (req, res) => {
      res.json({ success: true, admins: await listOwnerAdmins() });
    })
  );

  app.post(
    "/api/owner-admins",
    requireSuper,
    asyncRoute(async (req, res) => {
      const { phone } = req.body || {};

      if (!phone) {
        return res.status(400).json({ success: false, error: "phone wajib diisi" });
      }

      const jid = await addOwnerAdminWeb(phone, req.session.username);
      res.json({ success: true, jid });
    })
  );

  app.delete(
    "/api/owner-admins/:userJid",
    requireSuper,
    asyncRoute(async (req, res) => {
      await removeOwnerAdminWeb(req.params.userJid);
      res.json({ success: true });
    })
  );

  // ---- Admin users (khusus super admin) ----

  app.get(
    "/api/admin-users",
    requireSuper,
    asyncRoute(async (req, res) => {
      res.json({ success: true, users: await listAdminUsers() });
    })
  );

  app.post(
    "/api/admin-users",
    requireSuper,
    asyncRoute(async (req, res) => {
      const { username, password, role, allowedGroups, canAccessLiveChat } = req.body || {};
      const user = await createAdminUser({
        username,
        password,
        role,
        allowedGroups,
        canAccessLiveChat,
        createdBy: req.session.username,
      });
      res.json({ success: true, user });
    })
  );

  app.patch(
    "/api/admin-users/:username/live-chat-access",
    requireSuper,
    asyncRoute(async (req, res) => {
      await setAdminUserLiveChatAccess(req.params.username, Boolean(req.body?.canAccessLiveChat));
      res.json({ success: true });
    })
  );

  app.delete(
    "/api/admin-users/:username",
    requireSuper,
    asyncRoute(async (req, res) => {
      await deleteAdminUser(req.params.username);
      res.json({ success: true });
    })
  );

  // ---- Knowledge base ----

  app.get(
    "/api/knowledge",
    asyncRoute(async (req, res) => {
      const groupId = req.query.groupId || null;

      if (req.session.role !== "super") {
        if (groupId && !req.session.allowedGroups.includes(groupId)) {
          return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
        }

        const groups = groupId ? [groupId] : req.session.allowedGroups;
        return res.json({ success: true, knowledge: await listKnowledgeForGroups(groups) });
      }

      res.json({ success: true, knowledge: await listKnowledge(groupId) });
    })
  );

  app.post(
    "/api/knowledge/note",
    asyncRoute(async (req, res) => {
      const { groupId, title, content } = req.body || {};

      if (!canAccessGroup(req, groupId || null)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      const row = await addNote({
        groupId: groupId || null,
        title,
        content,
        createdBy: req.session.username,
      });
      res.json({ success: true, knowledge: row });
    })
  );

  app.post(
    "/api/knowledge/document",
    upload.single("file"),
    asyncRoute(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "File wajib diunggah" });
      }

      const groupId = req.body?.groupId || null;

      if (!canAccessGroup(req, groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      const text = await extractTextFromUpload(req.file);
      const result = await addDocument({
        groupId,
        title: req.body?.title || req.file.originalname,
        sourceFilename: req.file.originalname,
        fullText: text,
        createdBy: req.session.username,
      });

      res.json({ success: true, ...result });
    })
  );

  app.delete(
    "/api/knowledge/:id",
    asyncRoute(async (req, res) => {
      if (req.session.role !== "super") {
        const row = await getKnowledgeById(req.params.id);

        if (!row || !req.session.allowedGroups.includes(row.group_id)) {
          return res.status(403).json({ success: false, error: "Tidak punya akses ke knowledge ini" });
        }
      }

      await deleteKnowledge(req.params.id);
      res.json({ success: true });
    })
  );

  // ---- Live Chat inbox (DM + grup, dengan takeover manusia) ----

  app.get(
    "/api/chats",
    asyncRoute(async (req, res) => {
      if (!canAccessLiveChat(req)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke Live Chat" });
      }

      const allowedGroups = req.session.role === "super" ? null : req.session.allowedGroups || [];
      const chats = await listChats({ allowedGroups });
      refreshMissingAvatars(chats);
      res.json({ success: true, chats });
    })
  );

  app.get(
    "/api/chats/:jid/messages",
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      const [messages, avatarUrl] = await Promise.all([
        getMessages(jid),
        ensureAvatarUrl(jid, { isGroup }),
      ]);

      res.json({ success: true, messages, avatarUrl });
    })
  );

  app.post(
    "/api/chats/:jid/media",
    uploadChatMedia.single("file"),
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: "File wajib diunggah" });
      }

      const caption = String(req.body?.caption || "").trim();
      const replyToId = String(req.body?.replyToId || "").trim();

      await sendChatMedia({
        jid,
        isGroup,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        filename: req.file.originalname,
        caption,
        fromAdmin: req.session.username,
        replyTo: replyToId
          ? {
              id: replyToId,
              sender: req.body?.replyToSender || null,
              fromMe: req.body?.replyToFromMe === "true",
              text: req.body?.replyToText || null,
            }
          : null,
        viewOnce: req.body?.viewOnce === "true",
      });

      res.json({ success: true });
    })
  );

  // Voice note dari teks pakai suara Gemini 3.1 Flash TTS. Cuma generate &
  // balikin file WAV mentah (belum dikirim/direkam) — dipakai admin panel
  // buat preview dulu, dikirim lewat /api/chats/:jid/media (endpoint yang
  // sama dipakai lampiran manual) begitu admin klik kirim.
  app.post(
    "/api/chats/:jid/tts",
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      const text = String(req.body?.text || "").trim();

      if (!text) {
        return res.status(400).json({ success: false, error: "Teks wajib diisi" });
      }

      const wavBuffer = await synthesizeSpeech(text);

      res.set("Content-Type", "audio/wav");
      res.send(wavBuffer);
    })
  );

  app.get("/api/media/:jid/:filename", (req, res) => {
    const jid = req.params.jid;
    const isGroup = jid.endsWith("@g.us");

    if (!canAccessChat(req, jid, isGroup)) {
      return res.status(403).end();
    }

    res.sendFile(mediaFilePath(jid, req.params.filename), (error) => {
      if (error && !res.headersSent) {
        res.status(404).end();
      }
    });
  });

  app.post(
    "/api/chats/:jid/messages",
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");
      const text = String(req.body?.text || "").trim();

      if (!text) {
        return res.status(400).json({ success: false, error: "Pesan tidak boleh kosong" });
      }

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      const replyToId = req.body?.replyToId ? String(req.body.replyToId) : "";

      await sendChatMessage({
        jid,
        isGroup,
        text,
        fromAdmin: req.session.username,
        replyTo: replyToId
          ? {
              id: replyToId,
              sender: req.body?.replyToSender || null,
              fromMe: Boolean(req.body?.replyToFromMe),
              text: req.body?.replyToText || null,
            }
          : null,
      });
      res.json({ success: true });
    })
  );

  // "Hapus untuk semua orang" — cuma buat pesan yang kita/bot kirim sendiri
  // (WhatsApp tidak mengizinkan revoke pesan orang lain).
  app.delete(
    "/api/chats/:jid/messages/:id",
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      await deleteChatMessage({ jid, isGroup, id: req.params.id });
      res.json({ success: true });
    })
  );

  app.post(
    "/api/chats/:jid/takeover",
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      const result = await setTakeover(jid, { takenOver: true, byAdmin: req.session.username, isGroup });
      res.json({ success: true, ...result });
    })
  );

  app.post(
    "/api/chats/:jid/release",
    asyncRoute(async (req, res) => {
      const jid = req.params.jid;
      const isGroup = jid.endsWith("@g.us");

      if (!canAccessChat(req, jid, isGroup)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke chat ini" });
      }

      const result = await setTakeover(jid, { takenOver: false, isGroup });
      res.json({ success: true, ...result });
    })
  );

  // Hapus semua chat & pesan Live Chat sekaligus (termasuk lampiran di
  // disk). Ireversibel & bot-wide, jadi dibatasi ke super admin saja.
  app.delete(
    "/api/chats",
    requireSuper,
    asyncRoute(async (req, res) => {
      await deleteAllChats();
      res.json({ success: true });
    })
  );

  app.get("/api/chats/stream", (req, res) => {
    if (!canAccessLiveChat(req)) {
      return res.status(403).json({ success: false, error: "Tidak punya akses ke Live Chat" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (type, payload) => {
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    const onMessage = (payload) => {
      if (canAccessChat(req, payload.jid, payload.isGroup)) {
        sendEvent("message", payload);
      }
    };

    const onTakeover = (payload) => {
      if (canAccessChat(req, payload.jid, payload.jid.endsWith("@g.us"))) {
        sendEvent("takeover", payload);
      }
    };

    const onAvatar = (payload) => {
      if (canAccessChat(req, payload.jid, payload.jid.endsWith("@g.us"))) {
        sendEvent("avatar", payload);
      }
    };

    const onStatus = (payload) => {
      if (canAccessChat(req, payload.jid, payload.jid.endsWith("@g.us"))) {
        sendEvent("status", payload);
      }
    };

    const onDeleted = (payload) => {
      if (canAccessChat(req, payload.jid, payload.jid.endsWith("@g.us"))) {
        sendEvent("deleted", payload);
      }
    };

    const onChatsCleared = () => {
      sendEvent("chats-cleared", {});
    };

    botEvents.on("chat-message", onMessage);
    botEvents.on("chat-takeover", onTakeover);
    botEvents.on("chat-avatar", onAvatar);
    botEvents.on("chat-status", onStatus);
    botEvents.on("chat-deleted", onDeleted);
    botEvents.on("chats-cleared", onChatsCleared);

    const keepAlive = setInterval(() => res.write(":\n\n"), 25_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      botEvents.off("chat-message", onMessage);
      botEvents.off("chat-takeover", onTakeover);
      botEvents.off("chat-avatar", onAvatar);
      botEvents.off("chat-status", onStatus);
      botEvents.off("chat-deleted", onDeleted);
      botEvents.off("chats-cleared", onChatsCleared);
    });
  });

  // ---- Test message ----

  app.post(
    "/api/test-message",
    asyncRoute(async (req, res) => {
      const { groupId, message } = req.body || {};

      if (!groupId || !message) {
        return res.status(400).json({ success: false, error: "groupId dan message wajib diisi" });
      }

      if (!canAccessGroup(req, groupId)) {
        return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
      }

      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      await botState.sock.sendMessage(groupId, { text: message });
      res.json({ success: true });
    })
  );

  app.use(express.static(PUBLIC_DIR));

  app.use((req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.listen(ADMIN_PORT, () => {
    console.log(`🖥️  Admin dashboard listening on port ${ADMIN_PORT}`);
  });
}
