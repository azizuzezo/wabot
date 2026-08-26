import bcrypt from "bcryptjs";
import { database } from "./db.js";

function ensureDatabase() {
  if (!database) {
    throw new Error("Database (Supabase) belum dikonfigurasi.");
  }
}

// Akun 'super' via .env (ADMIN_USERNAME/ADMIN_PASSWORD) selalu dicek dulu di
// admin/auth.js sebelum jatuh ke sini — modul ini khusus akun tambahan yang
// disimpan di DB, biasanya akun 'scoped' yang dibatasi ke grup tertentu.
export async function findAdminUser(username) {
  if (!database) {
    return null;
  }

  const { data, error } = await database
    .from("bot_admin_users")
    .select("username,password_hash,role,allowed_groups,can_access_live_chat")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function listAdminUsers() {
  ensureDatabase();

  const { data, error } = await database
    .from("bot_admin_users")
    .select("username,role,allowed_groups,can_access_live_chat,created_by,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function createAdminUser({ username, password, role, allowedGroups, canAccessLiveChat, createdBy }) {
  ensureDatabase();

  const cleanUsername = String(username || "").trim();

  if (!cleanUsername || !password) {
    throw new Error("Username dan password wajib diisi.");
  }

  const cleanRole = role === "super" ? "super" : "scoped";
  const cleanGroups = cleanRole === "super" ? [] : (Array.isArray(allowedGroups) ? allowedGroups : []).filter(Boolean);
  const cleanCanAccessLiveChat = canAccessLiveChat !== false;

  if (cleanRole === "scoped" && !cleanGroups.length) {
    throw new Error("Akun scoped wajib punya minimal 1 grup.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { error } = await database.from("bot_admin_users").insert({
    username: cleanUsername,
    password_hash: passwordHash,
    role: cleanRole,
    allowed_groups: cleanGroups,
    can_access_live_chat: cleanCanAccessLiveChat,
    created_by: createdBy || null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }

  return { username: cleanUsername, role: cleanRole, allowedGroups: cleanGroups, canAccessLiveChat: cleanCanAccessLiveChat };
}

export async function setAdminUserLiveChatAccess(username, canAccessLiveChat) {
  ensureDatabase();

  const cleanUsername = String(username || "").trim();

  if (!cleanUsername) {
    throw new Error("Username wajib diisi.");
  }

  const { error } = await database
    .from("bot_admin_users")
    .update({ can_access_live_chat: Boolean(canAccessLiveChat) })
    .eq("username", cleanUsername);

  if (error) {
    throw error;
  }
}

export async function deleteAdminUser(username) {
  ensureDatabase();

  const { error } = await database.from("bot_admin_users").delete().eq("username", username);

  if (error) {
    throw error;
  }
}
