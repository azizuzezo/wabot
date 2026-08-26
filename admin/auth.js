import bcrypt from "bcryptjs";
import { findAdminUser } from "./adminUsers.js";

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

export const adminAuthConfigured = Boolean(
  ADMIN_USERNAME && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH)
);

// Mengembalikan null kalau salah, atau { role, allowedGroups } kalau benar.
// 'super' (dari .env) selalu akses penuh; akun DB bisa 'super' atau 'scoped'
// (dibatasi ke grup-grup tertentu di allowedGroups).
export async function verifyCredentials(username, password) {
  const cleanUsername = String(username || "").trim();

  if (adminAuthConfigured && cleanUsername === ADMIN_USERNAME) {
    const ok = ADMIN_PASSWORD_HASH
      ? await bcrypt.compare(String(password || ""), ADMIN_PASSWORD_HASH)
      : String(password || "") === ADMIN_PASSWORD;

    if (ok) {
      return { role: "super", allowedGroups: null };
    }

    return null;
  }

  const user = await findAdminUser(cleanUsername).catch(() => null);

  if (!user) {
    return null;
  }

  const ok = await bcrypt.compare(String(password || ""), user.password_hash);

  if (!ok) {
    return null;
  }

  return {
    role: user.role === "super" ? "super" : "scoped",
    allowedGroups: Array.isArray(user.allowed_groups) ? user.allowed_groups : [],
  };
}

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }

  return res.status(401).json({ success: false, error: "Unauthorized" });
}

export function requireSuper(req, res, next) {
  if (req.session?.authenticated && req.session?.role === "super") {
    return next();
  }

  return res.status(403).json({ success: false, error: "Khusus super admin" });
}

// true kalau akun ini boleh menyentuh groupId tsb (super = semua, scoped = whitelist)
export function canAccessGroup(req, groupId) {
  if (req.session?.role === "super") {
    return true;
  }

  return Array.isArray(req.session?.allowedGroups) && req.session.allowedGroups.includes(groupId);
}

// Live Chat inbox: chat grup ikut aturan canAccessGroup (whitelist per akun
// scoped). Chat personal (DM) belum punya konsep scoping per-admin di data
// model — semua admin yang login (super maupun scoped) boleh akses.
export function canAccessChat(req, jid, isGroup) {
  if (!isGroup) {
    return true;
  }

  return canAccessGroup(req, jid);
}

export function requireGroupAccess(getGroupId) {
  return (req, res, next) => {
    const groupId = getGroupId(req);

    if (!canAccessGroup(req, groupId)) {
      return res.status(403).json({ success: false, error: "Tidak punya akses ke grup ini" });
    }

    next();
  };
}
