import "dotenv/config";

console.log("=================================");
console.log("TEST GEMINI");
console.log("=================================");

console.log("Node:", process.version);

const apiKey = process.env.GEMINI_API_KEY?.trim();

if (!apiKey) {
  console.error("❌ GEMINI_API_KEY tidak ditemukan.");
  console.error("Pastikan file .env ada di folder project.");
  process.exit(1);
}

console.log(
  "✅ API Key terbaca:",
  apiKey.substring(0, 5) + "..."
);

console.log("🚀 Mengirim request ke Gemini...");

const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, 15000);

try {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },

      body: JSON.stringify({
        model: "gemini-3.6-flash",
        input: "Balas hanya dengan tulisan: Gemini berhasil terhubung!",
        store: false,
      }),

      signal: controller.signal,
    }
  );

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

  const modelOutput =
    data.steps?.find(
      (step) => step.type === "model_output"
    );

  const text =
    modelOutput?.content?.find(
      (content) => content.type === "text"
    )?.text;

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