import { EventEmitter } from "node:events";

// Shared live-state bridge between the WhatsApp bot (index.js) and the
// admin web server. index.js pushes updates in; admin/server.js reads them.

export const botEvents = new EventEmitter();
botEvents.setMaxListeners(50);

// Shared live collections — mutated directly by both index.js (bot runtime
// checks) and the admin server (CRUD from the dashboard), so changes made
// in the admin UI take effect immediately without restarting the bot.
export const allowedGroups = new Set();
export const ownerAdminJids = new Set();
export const groupSettingsCache = new Map();

// Global AI config (chat personal/DM, mode trigger, model default, branding,
// system prompt, API key/base URL override) — satu objek dipakai bersama
// oleh index.js (baca) dan admin dashboard (tulis).
export const globalSettings = {
  dmEnabled: false,
  aiTriggerMode: "command",
  aiModel: null,
  botName: null,
  botCredit: null,
  aiSystemPrompt: null,
  aiApiKey: null,
  aiBaseUrl: null,
};

export const botState = {
  sock: null,
  connected: false,
  qr: null,
  pairingCode: null,
  botName: null,
  startedAt: Date.now(),
};

export function setSock(sock) {
  botState.sock = sock;
  botEvents.emit("update");
}

export function setConnected(connected) {
  botState.connected = connected;

  if (connected) {
    botState.qr = null;
    botState.pairingCode = null;
  }

  botEvents.emit("update");
}

export function setQr(qr) {
  botState.qr = qr;
  botState.pairingCode = null;
  botEvents.emit("update");
}

export function setPairingCode(code) {
  botState.pairingCode = code;
  botState.qr = null;
  botEvents.emit("update");
}

export function setBotName(name) {
  botState.botName = name;
}

export function getStatusSnapshot() {
  return {
    connected: botState.connected,
    qr: botState.qr,
    pairingCode: botState.pairingCode,
    botName: botState.botName,
    accountId: botState.sock?.user?.id || null,
    uptimeMs: Date.now() - botState.startedAt,
  };
}
