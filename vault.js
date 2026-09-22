import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.NOVA_DB_PATH || path.join(__dirname, "nova.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_keys (
    tenant_id TEXT PRIMARY KEY,
    enc_api_key TEXT NOT NULL,
    enc_api_secret TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const MASTER_SECRET = process.env.VAULT_MASTER_KEY;
if (!MASTER_SECRET) {
  console.error("VAULT_MASTER_KEY not set — refusing to start vault");
  process.exit(1);
}

function deriveKey(tenantId) {
  return crypto.pbkdf2Sync(MASTER_SECRET, tenantId, 100_000, 32, "sha256");
}

function encrypt(tenantId, text) {
  const key = deriveKey(tenantId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${enc}`;
}

function decrypt(tenantId, payload) {
  const [ivHex, tagHex, encHex] = payload.split(":");
  const key = deriveKey(tenantId);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let dec = decipher.update(encHex, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

export function storeTenantKeys(tenantId, apiKey, apiSecret) {
  const stmt = db.prepare(`
    INSERT INTO tenant_keys (tenant_id, enc_api_key, enc_api_secret)
    VALUES (?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      enc_api_key = excluded.enc_api_key,
      enc_api_secret = excluded.enc_api_secret
  `);
  stmt.run(tenantId, encrypt(tenantId, apiKey), encrypt(tenantId, apiSecret));
}

export function getTenantKeys(tenantId) {
  if (!tenantId) return null;
  const row = db.prepare(
    "SELECT enc_api_key, enc_api_secret FROM tenant_keys WHERE tenant_id = ?"
  ).get(tenantId);
  if (!row) return null;
  try {
    return {
      apiKey: decrypt(tenantId, row.enc_api_key),
      apiSecret: decrypt(tenantId, row.enc_api_secret),
    };
  } catch (err) {
    console.error(`[vault] decrypt failed for ${tenantId}:`, err.message);
    return null;
  }
}

export function listTenants() {
  return db.prepare("SELECT tenant_id, created_at FROM tenant_keys ORDER BY created_at").all();
}
