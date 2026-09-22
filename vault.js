const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.NOVA_DB_PATH || path.join(__dirname, '../nova.db');
const db = new Database(dbPath);

// Initialize DB schema for tenant keys
db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_keys (
    tenant_id TEXT PRIMARY KEY,
    enc_api_key TEXT NOT NULL,
    enc_api_secret TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const MASTER_SECRET = process.env.VAULT_MASTER_KEY || 'default-fallback-master-secret-change-me';

function deriveKey(tenantId) {
  return crypto.pbkdf2Sync(MASTER_SECRET, tenantId, 100000, 32, 'sha256');
}

function encrypt(tenantId, text) {
  const key = deriveKey(tenantId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(tenantId, cipherText) {
  const [ivHex, tagHex, encryptedHex] = cipherText.split(':');
  const key = deriveKey(tenantId);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function storeTenantKeys(tenantId, apiKey, apiSecret) {
  const stmt = db.prepare(`
    INSERT INTO tenant_keys (tenant_id, enc_api_key, enc_api_secret)
    VALUES (?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      enc_api_key = excluded.enc_api_key,
      enc_api_secret = excluded.enc_api_secret
  `);
  stmt.run(tenantId, encrypt(tenantId, apiKey), encrypt(tenantId, apiSecret));
}

function getTenantKeys(tenantId) {
  const stmt = db.prepare('SELECT enc_api_key, enc_api_secret FROM tenant_keys WHERE tenant_id = ?');
  const row = stmt.get(tenantId);
  
  if (!row) return null;
  
  return {
    apiKey: decrypt(tenantId, row.enc_api_key),
    apiSecret: decrypt(tenantId, row.enc_api_secret)
  };
}

module.exports = { storeTenantKeys, getTenantKeys };
