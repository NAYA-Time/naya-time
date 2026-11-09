// Offline-Warteschlange am iPad (Phase 7).
// Fällt das Netz aus, verschlüsselt das iPad die Buchung (inkl. PIN) mit dem öffentlichen Schlüssel des Servers
// und legt sie lokal ab. Das iPad selbst kann die gespeicherten Daten nicht mehr lesen – PIN-Prüfung und Buchung
// passieren erst, wenn der Server wieder erreichbar ist. Der Zeitpunkt wird aus der letzten Serverzeit-Synchronisierung
// rekonstruiert; ist das nicht sicher belegbar, wird die Buchung als "nicht vertrauenswürdig" zur Prüfung markiert.
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import type { ClockEventType, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { openSecret, sealSecret, verifySecret } from "./crypto";
import { lockMinutes } from "./pin";
import { HttpError } from "./terminal";
import { stamp } from "./stamp";
import { berlinDate, dbDate } from "./time";

const KEY_SETTING = "terminal.offlineKey";
const TYPES: ClockEventType[] = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"];
export const OFFLINE_MAX_AGE_H = 72; // ältere Offline-Buchungen werden nicht mehr automatisch gebucht

/** Öffentlicher Schlüssel (SPKI, base64) für die Verschlüsselung am iPad; wird beim ersten Abruf erzeugt. */
export async function offlinePublicKey(db: PrismaClient = prisma): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key: KEY_SETTING } });
  if (row) return (row.value as { publicKey: string }).publicKey;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const value = {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKeySealed: Buffer.from(sealSecret(privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toString("base64"),
  };
  // Zwei gleichzeitige Erstaufrufe: der erste gewinnt
  await db.systemSetting.upsert({ where: { key: KEY_SETTING }, update: {}, create: { key: KEY_SETTING, value } });
  return ((await db.systemSetting.findUniqueOrThrow({ where: { key: KEY_SETTING } })).value as { publicKey: string }).publicKey;
}

async function privateKeyPem(db: PrismaClient): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key: KEY_SETTING } });
  if (!row) throw new Error("Offline-Schlüssel fehlt");
  return openSecret(Buffer.from((row.value as { privateKeySealed: string }).privateKeySealed, "base64"));
}

export interface SealedRecord { wrappedKey: string; iv: string; data: string } // base64; data = AES-GCM Chiffre + 16 Byte Tag (WebCrypto)
export interface OfflineSecret { employeeId?: string; personnelNumber?: string; pin: string; type: ClockEventType; breakTaken: boolean | null }

export function openRecord(pem: string, r: SealedRecord): OfflineSecret {
  const key = privateDecrypt({ key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(r.wrappedKey, "base64"));
  const raw = Buffer.from(r.data, "base64");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(r.iv, "base64"));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString("utf8"));
}

/** Zeitnachweis vom iPad. Gerätezeiten in ms (Date.now), monotone Zeit (performance.now) nur innerhalb derselben Seitensitzung vergleichbar. */
export interface OfflineEvidence {
  recordedDeviceAt: number; // iPad-Uhr bei der Buchung
  syncServerAt: number | null; // Serverzeit bei der letzten erfolgreichen Synchronisierung
  syncDeviceAt: number | null; // iPad-Uhr im selben Moment
  syncPerf: number | null; recordedPerf: number | null; // performance.now() bei Sync und Buchung
  samePage: boolean; // Sync und Buchung in derselben Seitensitzung (kein Neuladen dazwischen)
}

/** Zeitpunkt rekonstruieren und bewerten. Rein rechnerisch, damit testbar. */
export function assessOffline(ev: OfflineEvidence, receivedAt: Date): { effectiveAt: Date; trust: "TRUSTED" | "UNTRUSTED"; reasons: string[] } {
  const reasons: string[] = [];
  let at: number;
  if (ev.syncServerAt == null || ev.syncDeviceAt == null) {
    reasons.push("keine Serverzeit-Synchronisierung vorhanden");
    at = ev.recordedDeviceAt;
  } else {
    const wallDelta = ev.recordedDeviceAt - ev.syncDeviceAt;
    const monoDelta = ev.samePage && ev.syncPerf != null && ev.recordedPerf != null ? ev.recordedPerf - ev.syncPerf : null;
    if (monoDelta != null) {
      at = ev.syncServerAt + monoDelta; // monotone Uhr lässt sich nicht verstellen
      if (Math.abs(wallDelta - monoDelta) > 120_000) reasons.push("iPad-Uhr wurde verstellt");
    } else {
      at = ev.syncServerAt + wallDelta;
      reasons.push("Terminal wurde zwischendurch neu geladen (nur iPad-Uhr als Beleg)");
    }
    if (wallDelta < 0) reasons.push("Buchung liegt vor der letzten Synchronisierung");
    if (at - ev.syncServerAt > 24 * 3600_000) reasons.push("letzte Synchronisierung mehr als 24 Std. vorher");
  }
  if (at > receivedAt.getTime() + 60_000) { reasons.push("Zeitpunkt liegt in der Zukunft"); at = receivedAt.getTime(); }
  return { effectiveAt: new Date(Math.floor(at / 1000) * 1000), trust: reasons.length ? "UNTRUSTED" : "TRUSTED", reasons };
}

export interface OfflineItem { id: string; sealed: SealedRecord; evidence: OfflineEvidence }
export type OfflineResult = { id: string; status: "BOOKED" | "DUPLICATE" | "REJECTED"; message?: string };

async function reject(db: PrismaClient, terminalId: string, item: OfflineItem, employeeId: string | null, at: Date, message: string) {
  await db.$transaction(async (tx) => {
    if (employeeId) {
      const workDate = dbDate(berlinDate(at));
      await tx.complianceFinding.upsert({
        where: { code_employeeId_workDate_refId: { code: "OFFLINE_REJECTED", employeeId, workDate, refId: item.id } },
        update: {},
        create: { code: "OFFLINE_REJECTED", isLegal: false, severity: "WARNING", employeeId, workDate, refType: "OfflineStamp", refId: item.id,
          message: `Offline-Buchung nicht übernommen: ${message} – bitte im Backoffice prüfen/nachtragen`, details: { at: at.toISOString() } },
      });
    }
    await audit(tx, { actorKind: "TERMINAL", actorId: terminalId, action: "OFFLINE_STAMP_REJECTED", entityType: "OfflineStamp", entityId: item.id, employeeId, after: { at: at.toISOString(), message } });
  });
  return { id: item.id, status: "REJECTED" as const, message };
}

/** Warteschlange eines iPads verbuchen – chronologisch, jede Buchung einzeln (eine Ablehnung blockiert nicht den Rest). */
export async function processOfflineBatch(terminalId: string, items: OfflineItem[], db: PrismaClient = prisma, receivedAt = new Date()): Promise<OfflineResult[]> {
  const pem = await privateKeyPem(db);
  const prepared = items.map((it) => ({ it, a: assessOffline(it.evidence, receivedAt) })).sort((x, y) => x.a.effectiveAt.getTime() - y.a.effectiveAt.getTime());
  const out: OfflineResult[] = [];
  for (const { it, a } of prepared) {
    if (!/^[A-Za-z0-9-]{16,64}$/.test(it.id)) { out.push({ id: it.id, status: "REJECTED", message: "Ungültige Kennung" }); continue; }
    const existing = await db.timeClockEvent.findUnique({ where: { idempotencyKey: it.id } });
    if (existing) { out.push({ id: it.id, status: "DUPLICATE" }); continue; }
    let secret: OfflineSecret;
    try { secret = openRecord(pem, it.sealed); } catch { out.push(await reject(db, terminalId, it, null, a.effectiveAt, "Daten nicht lesbar")); continue; }
    if (!TYPES.includes(secret.type)) { out.push(await reject(db, terminalId, it, null, a.effectiveAt, "Unbekannte Buchungsart")); continue; }
    const emp = await db.employee.findFirst({
      where: { active: true, ...(secret.employeeId ? { id: secret.employeeId } : { personnelNumber: secret.personnelNumber ?? "-" }) },
      include: { credential: true },
    });
    if (!emp?.credential?.pinHash) { out.push(await reject(db, terminalId, it, emp?.id ?? null, a.effectiveAt, "Mitarbeiter unbekannt oder ohne PIN")); continue; }
    if (receivedAt.getTime() - a.effectiveAt.getTime() > OFFLINE_MAX_AGE_H * 3600_000) {
      out.push(await reject(db, terminalId, it, emp.id, a.effectiveAt, `älter als ${OFFLINE_MAX_AGE_H} Std.`)); continue;
    }
    if (!(await verifySecret(secret.pin, emp.credential.pinHash))) {
      const failed = emp.credential.failedAttempts + 1;
      const lock = lockMinutes(failed);
      await db.employeeCredential.update({ where: { employeeId: emp.id }, data: { failedAttempts: failed, lockedUntil: lock ? new Date(Date.now() + lock * 60000) : emp.credential.lockedUntil } });
      out.push(await reject(db, terminalId, it, emp.id, a.effectiveAt, "PIN falsch")); continue;
    }
    try {
      await stamp({
        employeeId: emp.id, terminalId, type: secret.type, idempotencyKey: it.id, photo: null, photoMissingReason: "Offline-Buchung (kein Foto gespeichert)",
        breakTaken: secret.breakTaken, testNow: receivedAt,
        offline: { effectiveAt: a.effectiveAt, clientRecordedAt: new Date(it.evidence.recordedDeviceAt), evidence: { ...it.evidence }, trust: a.trust, reasons: a.reasons },
      });
      out.push({ id: it.id, status: "BOOKED" });
    } catch (e) {
      if (e instanceof HttpError) out.push(await reject(db, terminalId, it, emp.id, a.effectiveAt, e.message));
      else throw e;
    }
  }
  return out;
}
