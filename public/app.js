const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...(options.headers || {}) },
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || (data && data.success === false)) {
    throw new Error(data?.error || `Request gagal (${response.status})`);
  }

  return data;
}

function showScreen(authenticated) {
  $("#login-screen").classList.toggle("hidden", authenticated);
  $("#app-screen").classList.toggle("hidden", !authenticated);
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}j ${minutes}m online`;
}

// ---- Auth ----

let session = { role: null, allowedGroups: null, username: null, canAccessLiveChat: true };

function applyRoleUI() {
  const isScoped = session.role !== "super";

  $$(".super-only").forEach((el) => el.classList.toggle("hidden", isScoped));

  const inboxTabBtn = document.querySelector('.tab-btn[data-tab="inbox"]');
  if (inboxTabBtn) {
    inboxTabBtn.classList.toggle("hidden", !session.canAccessLiveChat);
  }

  const badge = $("#role-badge");
  badge.textContent = isScoped ? `scoped: ${(session.allowedGroups || []).join(", ")}` : "super admin";

  if (isScoped) {
    const firstGroup = (session.allowedGroups || [])[0] || "";

    for (const id of ["note-group-id", "doc-group-id", "knowledge-filter-group", "test-group-id"]) {
      const el = document.getElementById(id);
      if (el) {
        el.value = firstGroup;
        if (session.allowedGroups.length <= 1) el.readOnly = true;
      }
    }
  }
}

async function checkAuth() {
  const data = await api("/api/me");
  showScreen(data.authenticated);
  if (data.authenticated) {
    session = {
      role: data.role,
      allowedGroups: data.allowedGroups,
      username: data.username,
      canAccessLiveChat: data.canAccessLiveChat,
    };
    initApp();
  }
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  $("#login-error").textContent = "";

  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    const me = await api("/api/me");
    session = {
      role: me.role,
      allowedGroups: me.allowedGroups,
      username: me.username,
      canAccessLiveChat: me.canAccessLiveChat,
    };
    showScreen(true);
    initApp();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showScreen(false);
});

// ---- Tabs ----

$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach((b) => b.classList.remove("active"));
    $$(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---- Dashboard: status / QR / pairing ----

let appInitialized = false;
let statusStream = null;

function renderStatus(status) {
  const dot = $("#status-dot");
  const text = $("#status-text");

  dot.classList.toggle("on", status.connected);
  dot.classList.toggle("off", !status.connected);
  text.textContent = status.connected ? "Terhubung" : "Terputus";

  $("#connected-view").classList.toggle("hidden", !status.connected);
  $("#disconnected-view").classList.toggle("hidden", status.connected);

  if (status.connected) {
    $("#account-id").textContent = `Akun: ${status.accountId || "-"}`;
    $("#uptime").textContent = formatUptime(status.uptimeMs);
  } else {
    $("#qr-wrap").classList.toggle("hidden", !status.qr);
    $("#pairing-wrap").classList.toggle("hidden", !status.pairingCode);

    if (status.qr) {
      $("#qr-image").src = `/api/qr.png?t=${Date.now()}`;
    }

    if (status.pairingCode) {
      $("#pairing-code").textContent = status.pairingCode;
    }
  }
}

function connectStatusStream() {
  if (statusStream) return;

  statusStream = new EventSource("/api/status/stream");
  statusStream.onmessage = (event) => {
    try {
      renderStatus(JSON.parse(event.data));
    } catch {}
  };
  statusStream.onerror = () => {
    statusStream.close();
    statusStream = null;
    setTimeout(connectStatusStream, 3000);
  };
}

$("#send-test-btn").addEventListener("click", async () => {
  const groupId = $("#test-group-id").value.trim();
  const message = $("#test-message").value.trim();
  const result = $("#test-result");
  result.textContent = "Mengirim...";

  try {
    await api("/api/test-message", { method: "POST", body: JSON.stringify({ groupId, message }) });
    result.textContent = "✅ Terkirim";
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

// ---- Groups ----

const SETTINGS_FIELDS = [
  { key: "welcome", label: "Pesan selamat datang" },
  { key: "antiLink", label: "Anti-link" },
  { key: "aiEnabled", label: "AI aktif" },
  { key: "antiSpam", label: "Anti-spam" },
  { key: "imgModeration", label: "Moderasi gambar" },
];

async function loadGroups() {
  const { groups } = await api("/api/groups");
  const list = $("#groups-list");
  list.innerHTML = "";

  if (!groups.length) {
    list.innerHTML = '<p class="muted">Belum ada grup.</p>';
    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="main">
        <strong>${group.name || "(tanpa nama)"}</strong>
        <span>${group.groupId}</span>
      </div>
      <span class="tag ${group.enabled ? "on" : "off"}">${group.enabled ? "aktif" : "nonaktif"}</span>
      <button class="small-btn ghost-btn settings-btn">Pengaturan</button>
      <button class="small-btn ${group.enabled ? "danger" : ""}" data-action="${group.enabled ? "remove" : "add"}">
        ${group.enabled ? "Nonaktifkan" : "Aktifkan"}
      </button>
    `;

    row.querySelector('[data-action]').addEventListener("click", async () => {
      try {
        if (group.enabled) {
          await api(`/api/groups/${encodeURIComponent(group.groupId)}`, { method: "DELETE" });
        } else {
          await api("/api/groups", {
            method: "POST",
            body: JSON.stringify({ groupId: group.groupId, name: group.name }),
          });
        }
        loadGroups();
      } catch (error) {
        alert(error.message);
      }
    });

    row.querySelector(".settings-btn").addEventListener("click", () => openGroupSettings(group));

    list.appendChild(row);
  }
}

let currentSettingsGroupId = null;

async function openGroupSettings(group) {
  const card = $("#group-settings-card");
  const body = $("#group-settings-body");
  card.classList.remove("hidden");
  $("#settings-group-name").textContent = group.name || group.groupId;
  body.innerHTML = '<p class="muted">Memuat...</p>';
  currentSettingsGroupId = group.groupId;

  const { settings } = await api(`/api/groups/${encodeURIComponent(group.groupId)}/settings`);
  body.innerHTML = "";

  $("#group-trigger-mode").value = settings.aiTriggerMode || "";
  $("#group-ai-model").value = settings.aiModel || "";
  $("#group-ai-result").textContent = "";

  for (const field of SETTINGS_FIELDS) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    row.innerHTML = `
      <span>${field.label}</span>
      <label><input type="checkbox" ${settings[field.key] ? "checked" : ""} /></label>
    `;

    row.querySelector("input").addEventListener("change", async (e) => {
      try {
        await api(`/api/groups/${encodeURIComponent(group.groupId)}/settings`, {
          method: "PUT",
          body: JSON.stringify({ [field.key]: e.target.checked }),
        });
      } catch (error) {
        alert(error.message);
        e.target.checked = !e.target.checked;
      }
    });

    body.appendChild(row);
  }
}

$("#add-group-btn").addEventListener("click", async () => {
  const groupId = $("#new-group-id").value.trim();
  const name = $("#new-group-name").value.trim();

  if (!groupId) return;

  try {
    await api("/api/groups", { method: "POST", body: JSON.stringify({ groupId, name }) });
    $("#new-group-id").value = "";
    $("#new-group-name").value = "";
    loadGroups();
  } catch (error) {
    alert(error.message);
  }
});

// ---- Owner admins ----

async function loadOwnerAdmins() {
  const { admins } = await api("/api/owner-admins");
  const list = $("#admins-list");
  list.innerHTML = "";

  if (!admins.length) {
    list.innerHTML = '<p class="muted">Belum ada owner admin tambahan.</p>';
    return;
  }

  for (const admin of admins) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="main">
        <strong>${admin.user_jid}</strong>
        <span>ditambahkan oleh ${admin.added_by || "-"}</span>
      </div>
      <button class="small-btn danger">Hapus</button>
    `;

    row.querySelector("button").addEventListener("click", async () => {
      try {
        await api(`/api/owner-admins/${encodeURIComponent(admin.user_jid)}`, { method: "DELETE" });
        loadOwnerAdmins();
      } catch (error) {
        alert(error.message);
      }
    });

    list.appendChild(row);
  }
}

$("#add-admin-btn").addEventListener("click", async () => {
  const phone = $("#new-admin-phone").value.trim();
  if (!phone) return;

  try {
    await api("/api/owner-admins", { method: "POST", body: JSON.stringify({ phone }) });
    $("#new-admin-phone").value = "";
    loadOwnerAdmins();
  } catch (error) {
    alert(error.message);
  }
});

// ---- Knowledge base ----

async function loadKnowledge(groupId) {
  const query = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
  const { knowledge } = await api(`/api/knowledge${query}`);
  const list = $("#knowledge-list");
  list.innerHTML = "";

  if (!knowledge.length) {
    list.innerHTML = '<p class="muted">Belum ada knowledge.</p>';
    return;
  }

  const grouped = new Map();

  for (const item of knowledge) {
    const key = item.type === "document" ? `doc:${item.source_filename}:${item.group_id || "global"}` : `note:${item.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, { ...item, chunkCount: item.type === "document" ? item.chunk_count : 1, ids: [item.id] });
    } else {
      grouped.get(key).ids.push(item.id);
    }
  }

  for (const item of grouped.values()) {
    const row = document.createElement("div");
    row.className = "list-item";
    const preview = item.content.length > 120 ? `${item.content.slice(0, 120)}…` : item.content;

    row.innerHTML = `
      <div class="main">
        <strong>${item.type === "document" ? "📄" : "📝"} ${item.title || item.source_filename || "(tanpa judul)"}</strong>
        <span>${item.group_id ? `Grup: ${item.group_id}` : "Berlaku global"} ${item.type === "document" ? `· ${item.chunkCount} bagian` : ""}</span>
        <span>${preview}</span>
      </div>
      <button class="small-btn danger">Hapus</button>
    `;

    row.querySelector("button").addEventListener("click", async () => {
      try {
        await Promise.all(item.ids.map((id) => api(`/api/knowledge/${id}`, { method: "DELETE" })));
        loadKnowledge($("#knowledge-filter-group").value.trim());
      } catch (error) {
        alert(error.message);
      }
    });

    list.appendChild(row);
  }
}

$("#knowledge-filter-btn").addEventListener("click", () => {
  loadKnowledge($("#knowledge-filter-group").value.trim());
});

$("#add-note-btn").addEventListener("click", async () => {
  const groupId = $("#note-group-id").value.trim();
  const title = $("#note-title").value.trim();
  const content = $("#note-content").value.trim();
  const result = $("#note-result");

  if (!content) {
    result.textContent = "Isi catatan tidak boleh kosong.";
    return;
  }

  result.textContent = "Menyimpan...";

  try {
    await api("/api/knowledge/note", {
      method: "POST",
      body: JSON.stringify({ groupId: groupId || null, title, content }),
    });
    result.textContent = "✅ Tersimpan";
    $("#note-title").value = "";
    $("#note-content").value = "";
    loadKnowledge($("#knowledge-filter-group").value.trim());
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

$("#upload-doc-btn").addEventListener("click", async () => {
  const groupId = $("#doc-group-id").value.trim();
  const title = $("#doc-title").value.trim();
  const file = $("#doc-file").files[0];
  const result = $("#doc-result");

  if (!file) {
    result.textContent = "Pilih file terlebih dahulu.";
    return;
  }

  result.textContent = "Mengunggah & memproses...";

  const formData = new FormData();
  formData.append("file", file);
  if (groupId) formData.append("groupId", groupId);
  if (title) formData.append("title", title);

  try {
    const data = await api("/api/knowledge/document", { method: "POST", body: formData });
    result.textContent = `✅ Berhasil diproses jadi ${data.chunkCount} bagian`;
    $("#doc-title").value = "";
    $("#doc-file").value = "";
    loadKnowledge($("#knowledge-filter-group").value.trim());
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

// ---- Per-group AI trigger mode / model override ----

$("#save-group-ai-btn").addEventListener("click", async () => {
  if (!currentSettingsGroupId) return;

  const result = $("#group-ai-result");
  result.textContent = "Menyimpan...";

  try {
    await api(`/api/groups/${encodeURIComponent(currentSettingsGroupId)}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        aiTriggerMode: $("#group-trigger-mode").value || null,
        aiModel: $("#group-ai-model").value.trim() || null,
      }),
    });
    result.textContent = "✅ Tersimpan";
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

// ---- Global AI settings (chat personal/DM, trigger mode, model default) ----

async function loadGlobalSettings() {
  const { settings } = await api("/api/global-settings");
  $("#global-dm-enabled").checked = Boolean(settings.dmEnabled);
  $("#global-trigger-mode").value = settings.aiTriggerMode || "command";
  $("#global-ai-model").value = settings.aiModel || "";
  $("#global-bot-name").value = settings.botName || "";
  $("#global-bot-credit").value = settings.botCredit || "";
  $("#global-ai-system-prompt").value = settings.aiSystemPrompt || "";
  $("#global-ai-base-url").value = settings.aiBaseUrl || "";
  $("#global-ai-api-key").value = "";
  $("#global-ai-api-key-status").textContent = settings.aiApiKeySet
    ? `Tersimpan (${settings.aiApiKeyPreview})`
    : "Belum diset — pakai default dari env";
}

$("#save-global-settings-btn").addEventListener("click", async () => {
  const result = $("#global-settings-result");
  result.textContent = "Menyimpan...";

  try {
    const body = {
      dmEnabled: $("#global-dm-enabled").checked,
      aiTriggerMode: $("#global-trigger-mode").value,
      aiModel: $("#global-ai-model").value.trim() || null,
      botName: $("#global-bot-name").value.trim() || null,
      botCredit: $("#global-bot-credit").value.trim() || null,
      aiSystemPrompt: $("#global-ai-system-prompt").value.trim() || null,
      aiBaseUrl: $("#global-ai-base-url").value.trim() || null,
    };

    const apiKey = $("#global-ai-api-key").value.trim();
    if (apiKey) {
      body.aiApiKey = apiKey;
    }

    await api("/api/global-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    result.textContent = "✅ Tersimpan";
    loadGlobalSettings();
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

// ---- Admin users (super only) ----

$("#new-admin-user-role").addEventListener("change", (e) => {
  $("#new-admin-user-groups-wrap").classList.toggle("hidden", e.target.value === "super");
});

async function loadAdminUsers() {
  const { users } = await api("/api/admin-users");
  const list = $("#admin-users-list");
  list.innerHTML = "";

  if (!users.length) {
    list.innerHTML = '<p class="muted">Belum ada akun tambahan.</p>';
    return;
  }

  for (const user of users) {
    const canAccessLiveChat = user.can_access_live_chat !== false;

    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="main">
        <strong>${user.username} <span class="tag">${user.role}</span></strong>
        <span>${user.role === "super" ? "Akses penuh" : (user.allowed_groups || []).join(", ")}</span>
        <span>Live Chat: ${canAccessLiveChat ? "aktif" : "nonaktif"}</span>
      </div>
      <button class="small-btn ghost-btn toggle-live-chat-btn" type="button">
        ${canAccessLiveChat ? "Nonaktifkan Live Chat" : "Aktifkan Live Chat"}
      </button>
      <button class="small-btn danger">Hapus</button>
    `;

    row.querySelector(".toggle-live-chat-btn").addEventListener("click", async () => {
      try {
        await api(`/api/admin-users/${encodeURIComponent(user.username)}/live-chat-access`, {
          method: "PATCH",
          body: JSON.stringify({ canAccessLiveChat: !canAccessLiveChat }),
        });
        loadAdminUsers();
      } catch (error) {
        alert(error.message);
      }
    });

    row.querySelector(".danger").addEventListener("click", async () => {
      try {
        await api(`/api/admin-users/${encodeURIComponent(user.username)}`, { method: "DELETE" });
        loadAdminUsers();
      } catch (error) {
        alert(error.message);
      }
    });

    list.appendChild(row);
  }
}

$("#add-admin-user-btn").addEventListener("click", async () => {
  const username = $("#new-admin-user-username").value.trim();
  const password = $("#new-admin-user-password").value;
  const role = $("#new-admin-user-role").value;
  const allowedGroups = $("#new-admin-user-groups").value
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const canAccessLiveChat = $("#new-admin-user-live-chat").checked;
  const result = $("#admin-user-result");

  result.textContent = "Membuat akun...";

  try {
    await api("/api/admin-users", {
      method: "POST",
      body: JSON.stringify({ username, password, role, allowedGroups, canAccessLiveChat }),
    });
    result.textContent = "✅ Akun dibuat";
    $("#new-admin-user-username").value = "";
    $("#new-admin-user-password").value = "";
    $("#new-admin-user-groups").value = "";
    $("#new-admin-user-live-chat").checked = true;
    loadAdminUsers();
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

// ---- Live Chat inbox (DM + grup, dengan takeover) ----

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function formatChatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const AVATAR_PALETTE = ["#2564cf", "#6b46c1", "#0f766e", "#a35b00", "#be185d", "#4d7c0f", "#475569"];

function avatarColor(seed) {
  let hash = 0;
  const str = String(seed || "?");
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
}

// avatarUrl datang dari sock.profilePictureUrl() (link CDN pps.whatsapp.net
// milik WhatsApp) — kalau ada, ditumpuk di atas avatar inisial; kalau gagal
// dimuat (404/expired) atau memang belum ada foto profil, onerror
// menyembunyikan <img>-nya supaya inisial tetap kelihatan sebagai fallback.
function avatarHtml(name, seed, avatarUrl) {
  const initialsSpan = `<span class="avatar" style="background:${avatarColor(seed || name)}">${escapeHtml(initials(name))}</span>`;

  if (!avatarUrl) {
    return initialsSpan;
  }

  return `<span class="avatar-wrap">
    ${initialsSpan}
    <img class="avatar avatar-photo" src="${escapeHtml(avatarUrl)}" alt="" onerror="this.remove()" />
  </span>`;
}

function statusPillHtml(takenOver, takenOverBy) {
  const label = takenOver ? `Diambil alih${takenOverBy ? ` oleh ${escapeHtml(takenOverBy)}` : ""}` : "Bot aktif";
  return `<span class="status-pill inline"><span class="dot ${takenOver ? "warn" : "on"}"></span><span>${label}</span></span>`;
}

let chatStream = null;
let chats = [];
let activeChatJid = null;

function renderChatList() {
  const list = $("#inbox-chat-list");
  list.innerHTML = "";

  if (!chats.length) {
    list.innerHTML = '<p class="muted">Belum ada percakapan.</p>';
    return;
  }

  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = `chat-row${chat.jid === activeChatJid ? " active" : ""}`;
    const name = chat.name || chat.jid;
    row.innerHTML = `
      ${avatarHtml(name, chat.jid, chat.avatarUrl)}
      <div class="chat-row-body">
        <div class="chat-row-top">
          <span class="chat-row-name">${escapeHtml(name)}</span>
          <span class="chat-row-time">${formatChatTime(chat.lastMessageAt)}</span>
        </div>
        <div class="chat-row-bottom">
          <span class="chat-row-preview">${escapeHtml(chat.lastMessagePreview || "")}</span>
          <span class="dot ${chat.takenOver ? "warn" : "on"}" title="${chat.takenOver ? "Diambil alih" : "Bot aktif"}"></span>
        </div>
      </div>
    `;
    row.addEventListener("click", () => openChat(chat.jid));
    list.appendChild(row);
  }
}

async function loadChatList() {
  const { chats: data } = await api("/api/chats");
  chats = data;
  renderChatList();
}

function renderThreadHeader(chat) {
  const header = $("#inbox-thread-header");

  if (!chat) {
    header.innerHTML = '<span class="muted">Pilih percakapan di sebelah kiri</span>';
    return;
  }

  const name = chat.name || chat.jid;

  header.innerHTML = `
    <div class="thread-who">
      ${avatarHtml(name, chat.jid, chat.avatarUrl)}
      <div class="thread-title">
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(chat.jid)}</span>
      </div>
    </div>
    <div class="thread-actions">
      ${statusPillHtml(chat.takenOver, chat.takenOverBy)}
      <button id="inbox-toggle-takeover-btn" class="small-btn ${chat.takenOver ? "" : "ghost-btn"}" type="button">
        ${chat.takenOver ? "Lepas ke Bot" : "Ambil Alih"}
      </button>
    </div>
  `;

  $("#inbox-toggle-takeover-btn").addEventListener("click", async () => {
    try {
      const action = chat.takenOver ? "release" : "takeover";
      await api(`/api/chats/${encodeURIComponent(chat.jid)}/${action}`, { method: "POST" });
      await loadChatList();
      renderThreadHeader(chats.find((c) => c.jid === chat.jid) || chat);
    } catch (error) {
      alert(error.message);
    }
  });
}

let lastBubbleDateKey = null;

function formatDateLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  if (sameDay(d, today)) return "Hari ini";
  if (sameDay(d, yesterday)) return "Kemarin";

  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function maybeInsertDateDivider(iso) {
  if (!iso) return;

  const key = new Date(iso).toDateString();
  if (key === lastBubbleDateKey) return;

  lastBubbleDateKey = key;

  const divider = document.createElement("div");
  divider.className = "date-divider";
  divider.innerHTML = `<span>${escapeHtml(formatDateLabel(iso))}</span>`;
  $("#inbox-thread-messages").appendChild(divider);
}

function mediaBubbleHtml(msg) {
  if (!msg.mediaUrl) return "";

  const url = escapeHtml(msg.mediaUrl);

  if (msg.mediaType === "image") {
    return `<a href="${url}" target="_blank" rel="noopener"><img class="bubble-image" src="${url}" alt="" /></a>`;
  }

  if (msg.mediaType === "document") {
    return `
      <a class="bubble-document" href="${url}" target="_blank" rel="noopener" download>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>${escapeHtml(msg.mediaFilename || "Dokumen")}</span>
      </a>`;
  }

  return "";
}

// Centang WA — cuma dipasang di bubble keluar (kita yang kirim). "pending"
// dapat jam kecil, "sent"/tanpa status dapat satu centang, "delivered" dua
// centang abu-abu, "read" dua centang biru (ticks-read).
function ticksSvg(status) {
  if (status === "pending") {
    return `<svg class="bubble-ticks" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="5" /><path d="M6 3.2v3l2 1.3" /></svg>`;
  }

  if (status === "delivered" || status === "read") {
    const readClass = status === "read" ? " ticks-read" : "";
    return `<svg class="bubble-ticks${readClass}" viewBox="0 0 16 11" width="16" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,6 4.5,9.5 10,2" /><polyline points="6,6 9.5,9.5 15,2" /></svg>`;
  }

  return `<svg class="bubble-ticks" viewBox="0 0 12 11" width="12" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,6 4.5,9.5 11,2" /></svg>`;
}

function updateBubbleTicks(id, status) {
  if (!id) return;

  const bubble = document.querySelector(`.bubble[data-msg-id="${CSS.escape(String(id))}"]`);
  const meta = bubble?.querySelector(".bubble-meta");
  if (!meta) return;

  meta.querySelector(".bubble-ticks")?.remove();
  meta.insertAdjacentHTML("beforeend", ticksSvg(status));
}

function appendBubble(msg) {
  const container = $("#inbox-thread-messages");
  const empty = container.querySelector(".muted");
  if (empty) empty.remove();

  maybeInsertDateDivider(msg.createdAt);

  const isOut = msg.direction === "out";
  const hasMedia = Boolean(msg.mediaUrl);
  const bubble = document.createElement("div");
  bubble.className = `bubble ${isOut ? "bubble-out" : "bubble-in"}${isOut && msg.fromBot ? " bubble-bot" : ""}${hasMedia ? " bubble-media" : ""}`;
  if (msg.id) bubble.dataset.msgId = msg.id;

  const label = isOut ? (msg.fromBot ? "Bot" : msg.fromAdmin || "Admin") : msg.pushName || msg.senderJid || "";
  const textHtml = msg.text ? `<div class="bubble-text">${escapeHtml(msg.text)}</div>` : "";
  const ticks = isOut ? ticksSvg(msg.status) : "";

  bubble.innerHTML = `${mediaBubbleHtml(msg)}${textHtml}<span class="bubble-meta"><span>${escapeHtml(label)}</span><span>${formatChatTime(msg.createdAt)}</span>${ticks}</span>`;

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

async function openChat(jid) {
  activeChatJid = jid;
  lastBubbleDateKey = null;
  renderChatList();

  const chat = chats.find((c) => c.jid === jid) || { jid };
  renderThreadHeader(chat);
  $("#inbox-composer").classList.remove("hidden");
  clearPendingAttachment();

  const messagesEl = $("#inbox-thread-messages");
  messagesEl.innerHTML = '<p class="muted">Memuat...</p>';

  try {
    const { messages, avatarUrl } = await api(`/api/chats/${encodeURIComponent(jid)}/messages`);

    if (avatarUrl && chat.avatarUrl !== avatarUrl) {
      chat.avatarUrl = avatarUrl;
      if (!chats.includes(chat)) chats.push(chat);
      renderThreadHeader(chat);
      renderChatList();
    }

    messagesEl.innerHTML = "";

    if (!messages.length) {
      messagesEl.innerHTML = '<p class="muted">Belum ada pesan.</p>';
    } else {
      for (const msg of messages) {
        appendBubble(msg);
      }
    }
  } catch (error) {
    messagesEl.innerHTML = `<p class="muted">Gagal memuat pesan: ${escapeHtml(error.message)}</p>`;
  }
}

// ---- Live Chat: lampiran gambar/dokumen ----

let pendingAttachment = null;

function clearPendingAttachment() {
  pendingAttachment = null;
  $("#inbox-attach-preview").classList.add("hidden");
  const img = $("#inbox-attach-preview-img");
  img.classList.add("hidden");
  img.src = "";
  $("#inbox-attach-preview-icon").classList.add("hidden");
  $("#inbox-attach-preview-name").textContent = "";
  $("#inbox-attach-input").value = "";
}

function renderPendingAttachment() {
  if (!pendingAttachment) {
    clearPendingAttachment();
    return;
  }

  $("#inbox-attach-preview").classList.remove("hidden");
  $("#inbox-attach-preview-name").textContent =
    `${pendingAttachment.name} (${Math.ceil(pendingAttachment.size / 1024)} KB)`;

  const img = $("#inbox-attach-preview-img");
  const icon = $("#inbox-attach-preview-icon");

  if (pendingAttachment.type.startsWith("image/")) {
    img.src = URL.createObjectURL(pendingAttachment);
    img.classList.remove("hidden");
    icon.classList.add("hidden");
  } else {
    img.classList.add("hidden");
    img.src = "";
    icon.classList.remove("hidden");
  }
}

$("#inbox-attach-btn").addEventListener("click", () => {
  $("#inbox-attach-input").click();
});

$("#inbox-attach-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAttachment = file;
  renderPendingAttachment();
});

$("#inbox-attach-remove-btn").addEventListener("click", () => {
  clearPendingAttachment();
});

$("#inbox-send-btn").addEventListener("click", async () => {
  if (!activeChatJid) return;

  const textarea = $("#inbox-compose-text");
  const text = textarea.value.trim();

  if (pendingAttachment) {
    const file = pendingAttachment;
    const caption = text;
    textarea.value = "";
    clearPendingAttachment();

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (caption) formData.append("caption", caption);

      await api(`/api/chats/${encodeURIComponent(activeChatJid)}/media`, {
        method: "POST",
        body: formData,
      });
    } catch (error) {
      alert(error.message);
    }

    return;
  }

  if (!text) return;

  textarea.value = "";

  try {
    await api(`/api/chats/${encodeURIComponent(activeChatJid)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    alert(error.message);
    textarea.value = text;
  }
});

$("#inbox-compose-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#inbox-send-btn").click();
  }
});

$("#inbox-refresh-btn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  btn.classList.add("spinning");
  loadChatList().finally(() => btn.classList.remove("spinning"));
});

function connectChatStream() {
  if (chatStream) return;

  chatStream = new EventSource("/api/chats/stream");
  chatStream.onmessage = (event) => {
    let payload;

    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "message") {
      const preview = payload.preview ?? String(payload.text || "").slice(0, 120);
      const existing = chats.find((c) => c.jid === payload.jid);

      if (existing) {
        existing.lastMessagePreview = preview;
        existing.lastMessageAt = payload.createdAt;
      } else {
        chats.unshift({
          jid: payload.jid,
          isGroup: payload.isGroup,
          name: payload.pushName || payload.jid,
          takenOver: false,
          takenOverBy: null,
          avatarUrl: null,
          lastMessageAt: payload.createdAt,
          lastMessagePreview: preview,
        });
      }

      chats.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
      renderChatList();

      if (payload.jid === activeChatJid) {
        appendBubble(payload);
      }
    } else if (payload.type === "avatar") {
      const existing = chats.find((c) => c.jid === payload.jid);

      if (existing) {
        existing.avatarUrl = payload.avatarUrl;
        renderChatList();

        if (payload.jid === activeChatJid) {
          renderThreadHeader(existing);
        }
      }
    } else if (payload.type === "status") {
      if (payload.jid === activeChatJid) {
        updateBubbleTicks(payload.id, payload.status);
      }
    } else if (payload.type === "takeover") {
      const existing = chats.find((c) => c.jid === payload.jid);

      if (existing) {
        existing.takenOver = payload.takenOver;
        existing.takenOverBy = payload.byAdmin;
      }

      renderChatList();

      if (payload.jid === activeChatJid) {
        renderThreadHeader(
          chats.find((c) => c.jid === payload.jid) || {
            jid: payload.jid,
            takenOver: payload.takenOver,
            takenOverBy: payload.byAdmin,
          }
        );
      }
    }
  };

  chatStream.onerror = () => {
    chatStream.close();
    chatStream = null;
    setTimeout(connectChatStream, 3000);
  };
}

// ---- Init ----

function initApp() {
  applyRoleUI();

  if (appInitialized) {
    connectStatusStream();
    connectChatStream();
    return;
  }

  appInitialized = true;
  connectStatusStream();
  connectChatStream();
  loadGroups();
  loadChatList();
  loadKnowledge(session.allowedGroups?.[0] || "");

  if (session.role === "super") {
    loadOwnerAdmins();
    loadGlobalSettings();
    loadAdminUsers();
  }
}

checkAuth();
