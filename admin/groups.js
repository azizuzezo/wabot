import { database } from "./db.js";
import { botState, allowedGroups, ownerAdminJids, groupSettingsCache } from "./bridge.js";

function ensureDatabase() {
  if (!database) {
    throw new Error("Database (Supabase) belum dikonfigurasi.");
  }
}

function defaultSettings(groupId) {
  return {
    groupId,
    welcome: true,
    antiLink: true,
    aiEnabled: true,
    antiSpam: true,
    imgModeration: false,
    badWords: [],
    aiTriggerMode: null,
    aiModel: null,
  };
}

function normalizePhoneToJid(value) {
  if (!value) return null;

  const raw = String(value).trim();

  if (raw.includes("@")) {
    return raw;
  }

  const digits = raw.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  return `${digits}@s.whatsapp.net`;
}

async function fetchLiveGroupNames() {
  if (!botState.sock) {
    return new Map();
  }

  try {
    const metadata = await botState.sock.groupFetchAllParticipating();
    const names = new Map();

    for (const [jid, info] of Object.entries(metadata || {})) {
      names.set(jid, info?.subject || null);
    }

    return names;
  } catch {
    return new Map();
  }
}

export async function listGroups() {
  ensureDatabase();

  const [{ data, error }, liveNames] = await Promise.all([
    database
      .from("bot_allowed_groups")
      .select("group_id,name,enabled,added_by,updated_at")
      .order("updated_at", { ascending: false }),
    fetchLiveGroupNames(),
  ]);

  if (error) {
    throw error;
  }

  const known = new Set((data || []).map((row) => row.group_id));

  const rows = (data || []).map((row) => ({
    groupId: row.group_id,
    name: liveNames.get(row.group_id) || row.name || null,
    enabled: Boolean(row.enabled),
    addedBy: row.added_by,
    updatedAt: row.updated_at,
    memberCount: null,
  }));

  for (const [jid, name] of liveNames) {
    if (!known.has(jid)) {
      rows.push({
        groupId: jid,
        name,
        enabled: false,
        addedBy: null,
        updatedAt: null,
        isCandidate: true,
      });
    }
  }

  return rows;
}

export async function setGroupEnabled(groupId, enabled, name, addedBy) {
  ensureDatabase();

  if (enabled) {
    allowedGroups.add(groupId);
  } else {
    allowedGroups.delete(groupId);
  }

  const { error } = await database.from("bot_allowed_groups").upsert({
    group_id: groupId,
    name: name || null,
    enabled,
    added_by: addedBy || null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

export async function getGroupSettingsWeb(groupId) {
  ensureDatabase();

  const { data, error } = await database
    .from("bot_group_settings")
    .select(
      "group_id,welcome,anti_link,ai_enabled,anti_spam,img_moderation,bad_words,ai_trigger_mode,ai_model"
    )
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const settings = data
    ? {
        groupId: data.group_id,
        welcome: Boolean(data.welcome),
        antiLink: Boolean(data.anti_link),
        aiEnabled: Boolean(data.ai_enabled),
        antiSpam: data.anti_spam === null ? true : Boolean(data.anti_spam),
        imgModeration: Boolean(data.img_moderation),
        badWords: Array.isArray(data.bad_words) ? data.bad_words : [],
        aiTriggerMode: data.ai_trigger_mode || null,
        aiModel: data.ai_model || null,
      }
    : defaultSettings(groupId);

  groupSettingsCache.set(groupId, settings);
  return settings;
}

export async function updateGroupSettingsWeb(groupId, patch) {
  ensureDatabase();

  const current = groupSettingsCache.get(groupId) || (await getGroupSettingsWeb(groupId));
  const updated = { ...current, ...patch, groupId };

  groupSettingsCache.set(groupId, updated);

  const { error } = await database.from("bot_group_settings").upsert({
    group_id: groupId,
    welcome: updated.welcome,
    anti_link: updated.antiLink,
    ai_enabled: updated.aiEnabled,
    anti_spam: updated.antiSpam,
    img_moderation: updated.imgModeration,
    bad_words: updated.badWords,
    ai_trigger_mode: updated.aiTriggerMode || null,
    ai_model: updated.aiModel || null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }

  return updated;
}

export async function listOwnerAdmins() {
  ensureDatabase();

  const { data, error } = await database
    .from("bot_owner_admins")
    .select("user_jid,added_by,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function addOwnerAdminWeb(phoneOrJid, addedBy) {
  ensureDatabase();

  const jid = normalizePhoneToJid(phoneOrJid);

  if (!jid) {
    throw new Error("Nomor tidak valid.");
  }

  ownerAdminJids.add(jid);

  const { error } = await database.from("bot_owner_admins").upsert({
    user_jid: jid,
    added_by: addedBy || null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }

  return jid;
}

export async function removeOwnerAdminWeb(userJid) {
  ensureDatabase();

  ownerAdminJids.delete(userJid);

  const { error } = await database.from("bot_owner_admins").delete().eq("user_jid", userJid);

  if (error) {
    throw error;
  }
}
