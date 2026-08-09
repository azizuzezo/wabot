import "dotenv/config";

console.log("=================================");
console.log("TEST GEMINI");
console.log("=================================");

console.log("Node:", process.version);

const baseUrl = (
  process.env.AI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/+$/, "");

const apiKey = (
  process.env.AI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  ""
).trim();

const model =
  process.env.AI_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-3.6-flash";

if (!apiKey) {
  console.error("❌ AI_API_KEY / GEMINI_API_KEY tidak ditemukan.");
  console.error("Pastikan file .env ada di folder project.");
  process.exit(1);
}

console.log(
  "✅ API Key terbaca:",
  apiKey.substring(0, 5) + "..."
);
console.log("🌐 Base URL:", baseUrl);
console.log("🧠 Model:", model);

console.log("🚀 Mengirim request ke Gemini...");

const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, 15000);

try {
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: "Balas hanya dengan tulisan: Gemini berhasil terhubung!" }],
        },
      ],
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  console.log("📡 HTTP Status:", response.status);

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    console.log("Response mentah:");
    console.log(raw);
    process.exit(1);
  }

  if (!response.ok) {
    console.error("❌ Gemini API Error:");
    console.dir(data, {
      depth: null,
    });

    process.exit(1);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("\n").trim();

  console.log("");
  console.log("=================================");
  console.log("✅ GEMINI CONNECTED");
  console.log("=================================");
  console.log("");

  console.log(
    text || "Request berhasil, tetapi tidak ada output text."
  );

  console.log("");

} catch (error) {
  clearTimeout(timeout);

  if (error.name === "AbortError") {
    console.error("");
    console.error(
      "❌ TIMEOUT: Gemini tidak merespons dalam 15 detik."
    );

    console.error(
      "Kemungkinan masalah koneksi, firewall, DNS, VPN, atau akses Google API."
    );
  } else {
    console.error("");
    console.error("❌ REQUEST ERROR:");
    console.error(error);
  }

  process.exit(1);
}