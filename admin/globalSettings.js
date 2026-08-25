import { database } from "./db.js";
import { globalSettings } from "./bridge.js";

function ensureDatabase() {
  if (!database) {
    throw new Error("Database (Supabase) belum dikonfigurasi.");
  }
}

function applyRow(row) {
  globalSettings.dmEnabled = Boolean(row.dm_enabled);
  globalSettings.aiTriggerMode = row.ai_trigger_mode || "command";
  globalSettings.aiModel = row.ai_model || null;
  return { ...globalSettings };
}

export async function loadGlobalSettings() {
  if (!database) {
    return { ...globalSettings };
  }

  const { data, error } = await database
    .from("bot_global_settings")
    .select("dm_enabled,ai_trigger_mode,ai_model")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    applyRow(data);
  }

  return { ...globalSettings };
}

export async function updateGlobalSettings(patch) {
  ensureDatabase();

  const next = {
    dmEnabled: patch.dmEnabled ?? globalSettings.dmEnabled,
    aiTriggerMode: patch.aiTriggerMode ?? globalSettings.aiTriggerMode,
    aiModel: patch.aiModel === undefined ? globalSettings.aiModel : patch.aiModel || null,
  };

  const { error } = await database.from("bot_global_settings").upsert({
    id: "default",
    dm_enabled: next.dmEnabled,
    ai_trigger_mode: next.aiTriggerMode,
    ai_model: next.aiModel,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }

  globalSettings.dmEnabled = next.dmEnabled;
  globalSettings.aiTriggerMode = next.aiTriggerMode;
  globalSettings.aiModel = next.aiModel;

  return { ...globalSettings };
}
