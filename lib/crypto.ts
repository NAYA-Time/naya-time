import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Nicht rückrechenbarer Hash für PINs und Kennwörter (scrypt, Salt pro Wert) */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = await scrypt(secret, Buffer.from(saltB64, "base64"), 32, { ...SCRYPT, N: Number(n) });
  const expected = Buffer.from(keyB64, "base64");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen)");
  return s;
}

/** Kurzlebiges, signiertes Ticket (z. B. nach erfolgreicher PIN-Prüfung) */
export function signTicket(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  const sig = createHmac("sha256", appSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyTicket<T extends Record<string, unknown>>(ticket: string): T | null {
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", appSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp: number };
  if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
  return data;
}

// ── Fotoverschlüsselung AES-256-GCM ──
export const PHOTO_KEY_VERSION = 1;
function photoKey(): Buffer {
  const k = Buffer.from(process.env.PHOTO_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("PHOTO_KEY fehlt (32 Byte, base64)");
  return k;
}

export function encryptPhoto(plain: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", photoKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: PHOTO_KEY_VERSION };
}

export function decryptPhoto(ciphertext: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", photoKey(), iv);
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

// ── Verschlüsselung kleiner Geheimnisse (z. B. TOTP-Schlüssel) mit aus APP_SECRET abgeleitetem Schlüssel ──
import { hkdfSync } from "node:crypto";
function secretsKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret(), "naya-time", "secrets-v1", 32));
}
export function sealSecret(plain: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretsKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), ct]));
}
export function openSecret(sealed: Buffer | Uint8Array): string {
  const b = Buffer.from(sealed);
  const d = createDecipheriv("aes-256-gcm", secretsKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
