import { database } from "./db.js";
import { globalSettings, botEvents } from "./bridge.js";

const COLUMNS =
  "dm_enabled,ai_trigger_mode,ai_model,bot_name,bot_credit,ai_system_prompt,ai_api_key,ai_base_url,ai_feature_modes";

function ensureDatabase() {
  if (!database) {
    throw new Error("Database (Supabase) belum dikonfigurasi.");
  }
}

function applyRow(row) {
  globalSettings.dmEnabled = Boolean(row.dm_enabled);
  globalSettings.aiTriggerMode = row.ai_trigger_mode || "command";
  globalSettings.aiModel = row.ai_model || null;
  globalSettings.botName = row.bot_name || null;
  globalSettings.botCredit = row.bot_credit || null;
  globalSettings.aiSystemPrompt = row.ai_system_prompt || null;
  globalSettings.aiApiKey = row.ai_api_key || null;
  globalSettings.aiBaseUrl = row.ai_base_url || null;
  globalSettings.aiFeatureModes = row.ai_feature_modes || null;
  return { ...globalSettings };
}

export async function loadGlobalSettings() {
  if (!database) {
    return { ...globalSettings };
  }

  const { data, error } = await database
    .from("bot_global_settings")
    .select(COLUMNS)
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
    botName: patch.botName === undefined ? globalSettings.botName : patch.botName || null,
    botCredit: patch.botCredit === undefined ? globalSettings.botCredit : patch.botCredit || null,
    aiSystemPrompt:
      patch.aiSystemPrompt === undefined ? globalSettings.aiSystemPrompt : patch.aiSystemPrompt || null,
    aiApiKey: patch.aiApiKey === undefined ? globalSettings.aiApiKey : patch.aiApiKey || null,
    aiBaseUrl: patch.aiBaseUrl === undefined ? globalSettings.aiBaseUrl : patch.aiBaseUrl || null,
    aiFeatureModes:
      patch.aiFeatureModes === undefined ? globalSettings.aiFeatureModes : patch.aiFeatureModes || null,
  };

  const { error } = await database.from("bot_global_settings").upsert({
    id: "default",
    dm_enabled: next.dmEnabled,
    ai_trigger_mode: next.aiTriggerMode,
    ai_model: next.aiModel,
    bot_name: next.botName,
    bot_credit: next.botCredit,
    ai_system_prompt: next.aiSystemPrompt,
    ai_api_key: next.aiApiKey,
    ai_base_url: next.aiBaseUrl,
    ai_feature_modes: next.aiFeatureModes,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }

  Object.assign(globalSettings, next);
  botEvents.emit("global-settings-updated");

  return { ...globalSettings };
}
