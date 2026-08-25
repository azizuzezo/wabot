import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import express from "express";
import session from "express-session";
import multer from "multer";
import QRCode from "qrcode";

import { botState, botEvents, getStatusSnapshot } from "./bridge.js";
import { adminAuthConfigured, verifyCredentials, requireAuth } from "./auth.js";
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
  addNote,
  addDocument,
  deleteKnowledge,
} from "./knowledge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3400);
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

async function extractTextFromUpload(file) {
  const name = String(file.originalname || "").toLowerCase();

  if (name.endsWith(".pdf")) {
    const { default: pdfParse } = await import("pdf-parse");
    const result = await pdfParse(file.buffer);
    return result.text || "";
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
      const ok = await verifyCredentials(username, password);

      if (!ok) {
        return res.status(401).json({ success: false, error: "Username atau password salah" });
      }

      req.session.authenticated = true;
      req.session.username = username;
      res.json({ success: true });
    })
  );

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get("/api/me", (req, res) => {
    res.json({ authenticated: Boolean(req.session?.authenticated) });
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
      res.json({ success: true, groups: await listGroups() });
    })
  );

  app.post(
    "/api/groups",
    asyncRoute(async (req, res) => {
      const { groupId, name } = req.body || {};

      if (!groupId) {
        return res.status(400).json({ success: false, error: "groupId wajib diisi" });
      }

      await setGroupEnabled(groupId, true, name, req.session.username);
      res.json({ success: true });
    })
  );

  app.delete(
    "/api/groups/:groupId",
    asyncRoute(async (req, res) => {
      await setGroupEnabled(req.params.groupId, false);
      res.json({ success: true });
    })
  );

  app.get(
    "/api/groups/:groupId/settings",
    asyncRoute(async (req, res) => {
      res.json({ success: true, settings: await getGroupSettingsWeb(req.params.groupId) });
    })
  );

  app.put(
    "/api/groups/:groupId/settings",
    asyncRoute(async (req, res) => {
      const updated = await updateGroupSettingsWeb(req.params.groupId, req.body || {});
      res.json({ success: true, settings: updated });
    })
  );

  // ---- Owner admins ----

  app.get(
    "/api/owner-admins",
    asyncRoute(async (req, res) => {
      res.json({ success: true, admins: await listOwnerAdmins() });
    })
  );

  app.post(
    "/api/owner-admins",
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
    asyncRoute(async (req, res) => {
      await removeOwnerAdminWeb(req.params.userJid);
      res.json({ success: true });
    })
  );

  // ---- Knowledge base ----

  app.get(
    "/api/knowledge",
    asyncRoute(async (req, res) => {
      const groupId = req.query.groupId || null;
      res.json({ success: true, knowledge: await listKnowledge(groupId) });
    })
  );

  app.post(
    "/api/knowledge/note",
    asyncRoute(async (req, res) => {
      const { groupId, title, content } = req.body || {};
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

      const text = await extractTextFromUpload(req.file);
      const result = await addDocument({
        groupId: req.body?.groupId || null,
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
      await deleteKnowledge(req.params.id);
      res.json({ success: true });
    })
  );

  // ---- Test message ----

  app.post(
    "/api/test-message",
    asyncRoute(async (req, res) => {
      const { groupId, message } = req.body || {};

      if (!botState.sock) {
        return res.status(503).json({ success: false, error: "WhatsApp belum terhubung" });
      }

      if (!groupId || !message) {
        return res.status(400).json({ success: false, error: "groupId dan message wajib diisi" });
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
