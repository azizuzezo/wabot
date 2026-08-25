import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/run-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error("SUPABASE_DB_URL tidak ditemukan di .env");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new Client({ connectionString });

await client.connect();

try {
  await client.query(sql);
  console.log(`✅ Migration applied: ${file}`);
} finally {
  await client.end();
}
