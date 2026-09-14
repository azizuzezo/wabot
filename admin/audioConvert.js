import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import ffmpeg from "@ffmpeg-installer/ffmpeg";

// WhatsApp cuma nampilin bubble "voice note" asli (ikon mic, gelombang suara,
// bisa dipercepat) kalau audionya Ogg/Opus — format lain (webm hasil rekam
// browser, mp3/wav upload, wav hasil Gemini TTS) tetap terkirim kalau dipaksa
// ptt:true, tapi seringnya cuma tampil sebagai lampiran audio biasa. Makanya
// semua audio keluar dari Live Chat selalu ditranscode ke sini dulu sebelum
// dikirim, apapun format aslinya.
export async function convertToVoiceNote(buffer) {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `${randomUUID()}-in`);
  const outputPath = path.join(tmpDir, `${randomUUID()}-out.ogg`);

  await fs.writeFile(inputPath, buffer);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg.path, [
        "-y",
        "-i", inputPath,
        "-c:a", "libopus",
        "-b:a", "64k",
        "-ar", "48000",
        "-ac", "1",
        "-vn",
        outputPath,
      ]);

      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
        }
      });
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
