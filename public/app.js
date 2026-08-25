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

let session = { role: null, allowedGroups: null, username: null };

function applyRoleUI() {
  const isScoped = session.role !== "super";

  $$(".super-only").forEach((el) => el.classList.toggle("hidden", isScoped));

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
    session = { role: data.role, allowedGroups: data.allowedGroups, username: data.username };
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
    session = { role: me.role, allowedGroups: me.allowedGroups, username: me.username };
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
}

$("#save-global-settings-btn").addEventListener("click", async () => {
  const result = $("#global-settings-result");
  result.textContent = "Menyimpan...";

  try {
    await api("/api/global-settings", {
      method: "PUT",
      body: JSON.stringify({
        dmEnabled: $("#global-dm-enabled").checked,
        aiTriggerMode: $("#global-trigger-mode").value,
        aiModel: $("#global-ai-model").value.trim() || null,
      }),
    });
    result.textContent = "✅ Tersimpan";
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
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="main">
        <strong>${user.username} <span class="tag">${user.role}</span></strong>
        <span>${user.role === "super" ? "Akses penuh" : (user.allowed_groups || []).join(", ")}</span>
      </div>
      <button class="small-btn danger">Hapus</button>
    `;

    row.querySelector("button").addEventListener("click", async () => {
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
  const result = $("#admin-user-result");

  result.textContent = "Membuat akun...";

  try {
    await api("/api/admin-users", {
      method: "POST",
      body: JSON.stringify({ username, password, role, allowedGroups }),
    });
    result.textContent = "✅ Akun dibuat";
    $("#new-admin-user-username").value = "";
    $("#new-admin-user-password").value = "";
    $("#new-admin-user-groups").value = "";
    loadAdminUsers();
  } catch (error) {
    result.textContent = `❌ ${error.message}`;
  }
});

// ---- Init ----

function initApp() {
  applyRoleUI();

  if (appInitialized) {
    connectStatusStream();
    return;
  }

  appInitialized = true;
  connectStatusStream();
  loadGroups();
  loadKnowledge(session.allowedGroups?.[0] || "");

  if (session.role === "super") {
    loadOwnerAdmins();
    loadGlobalSettings();
    loadAdminUsers();
  }
}

checkAuth();
