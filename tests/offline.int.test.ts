// Offline-Warteschlange: Verschlüsselung wie im Browser (WebCrypto), Verbuchen gegen die Testdatenbank.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { hashSecret } from "../lib/crypto";
import { assessOffline, offlinePublicKey, processOfflineBatch, type OfflineEvidence, type OfflineItem } from "../lib/offline";
import { stamp } from "../lib/stamp";
import { berlinToInstant, dbDate } from "../lib/time";

const DAY = "2026-11-10";
const t = (hm: string) => berlinToInstant(DAY, hm);
let terminalId = "";
let deptId = "";
let spki = "";

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(b)).toString("base64");
/** Genau wie app/terminal/offline-queue.ts im Browser */
async function seal(secret: object) {
  const pub = await crypto.subtle.importKey("spki", Buffer.from(spki, "base64"), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(secret)));
  const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, await crypto.subtle.exportKey("raw", aes));
  return { wrappedKey: b64(wrappedKey), iv: b64(iv), data: b64(data) };
}
// iPad-Uhr geht 7 Min. vor; letzte Synchronisierung um 12:00 Serverzeit, dann Netz weg
const SYNC = t("12:00").getTime();
const DRIFT = 7 * 60_000;
const ev = (at: Date, over: Partial<OfflineEvidence> = {}): OfflineEvidence => ({
  recordedDeviceAt: at.getTime() + DRIFT, syncServerAt: SYNC, syncDeviceAt: SYNC + DRIFT, syncPerf: 1000, recordedPerf: 1000 + (at.getTime() - SYNC), samePage: true, ...over,
});
async function item(employeeId: string, type: string, at: Date, pin = "482915", over: Partial<OfflineEvidence> = {}, breakTaken: boolean | null = null): Promise<OfflineItem> {
  return { id: randomUUID(), sealed: await seal({ employeeId, pin, type, breakTaken }), evidence: ev(at, over) };
}
async function newEmployee(name: string) {
  return prisma.employee.create({
    data: {
      personnelNumber: `O-${randomUUID().slice(0, 8)}`, firstName: name, lastName: "Test", displayName: name, employmentType: "FESTANGESTELLT",
      primaryDeptId: deptId, entryDate: dbDate("2026-01-01"), credential: { create: { pinHash: await hashSecret("482915"), mustSetPin: false } },
    },
  });
}

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
  terminalId = (await prisma.terminalDevice.create({ data: { name: "Offline-Test", tokenHash: randomUUID() } })).id;
  spki = await offlinePublicKey(prisma);
});

describe("Zeitpunkt rekonstruieren", () => {
  it("gleiche Seitensitzung: monotone Uhr zählt, iPad-Abweichung egal → vertrauenswürdig", () => {
    const a = assessOffline(ev(t("13:30")), t("23:00"));
    expect(a.effectiveAt.toISOString()).toBe(t("13:30").toISOString());
    expect(a.trust).toBe("TRUSTED");
  });
  it("iPad-Uhr zwischendurch verstellt → monotone Zeit gilt, aber zur Prüfung markiert", () => {
    const a = assessOffline(ev(t("13:30"), { recordedDeviceAt: t("11:00").getTime() }), t("23:00"));
    expect(a.effectiveAt.toISOString()).toBe(t("13:30").toISOString());
    expect(a.trust).toBe("UNTRUSTED");
    expect(a.reasons.join()).toMatch(/verstellt/);
  });
  it("nach Neuladen nur iPad-Uhr als Beleg → Abweichung herausgerechnet, aber zur Prüfung", () => {
    const a = assessOffline(ev(t("13:30"), { samePage: false }), t("23:00"));
    expect(a.effectiveAt.toISOString()).toBe(t("13:30").toISOString());
    expect(a.trust).toBe("UNTRUSTED");
  });
  it("Zeit in der Zukunft wird auf Empfangszeit begrenzt", () => {
    const a = assessOffline(ev(t("23:30")), t("23:00"));
    expect(a.effectiveAt.getTime()).toBe(t("23:00").getTime());
    expect(a.trust).toBe("UNTRUSTED");
  });
});

describe("Offline-Buchungen verbuchen", () => {
  it("Ein- und Ausstempeln offline → Schicht mit rekonstruierten Zeiten, PIN geprüft, doppelt gesendet = einmal gebucht", async () => {
    const e = await newEmployee("Offline");
    const items = [await item(e.id, "CLOCK_OUT", t("22:00"), "482915", {}, true), await item(e.id, "CLOCK_IN", t("13:30"))]; // Reihenfolge egal
    const r = await processOfflineBatch(terminalId, items, prisma, t("22:30"));
    expect(r.map((x) => x.status)).toEqual(["BOOKED", "BOOKED"]);
    const events = await prisma.timeClockEvent.findMany({ where: { employeeId: e.id }, orderBy: { effectiveAt: "asc" } });
    expect(events.map((x) => [x.type, x.effectiveAt.toISOString(), x.isOffline, x.offlineTrust])).toEqual([
      ["CLOCK_IN", t("13:30").toISOString(), true, "TRUSTED"], ["CLOCK_OUT", t("22:00").toISOString(), true, "TRUSTED"],
    ]);
    expect(events[0].serverReceivedAt.toISOString()).toBe(t("22:30").toISOString());
    const s = await prisma.workSession.findFirstOrThrow({ where: { employeeId: e.id } });
    expect([s.status, s.workedMinutes, s.breakConfirmation]).toEqual(["CLOSED", 480, "YES"]);
    const again = await processOfflineBatch(terminalId, items, prisma, t("22:31"));
    expect(again.map((x) => x.status)).toEqual(["DUPLICATE", "DUPLICATE"]);
  });

  it("falscher PIN → nicht gebucht, Hinweis für die Leitung, Fehlversuch gezählt", async () => {
    const e = await newEmployee("FalschPin");
    const [r] = await processOfflineBatch(terminalId, [await item(e.id, "CLOCK_IN", t("13:30"), "000000")], prisma, t("14:00"));
    expect(r.status).toBe("REJECTED");
    expect(await prisma.timeClockEvent.count({ where: { employeeId: e.id } })).toBe(0);
    expect(await prisma.complianceFinding.count({ where: { employeeId: e.id, code: "OFFLINE_REJECTED" } })).toBe(1);
    expect((await prisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: e.id } })).failedAttempts).toBe(1);
  });

  it("Offline-Buchung vor einer späteren Online-Buchung wird nicht eingeschoben; unsichere Zeit → Prüfhinweis", async () => {
    const e = await newEmployee("Reihenfolge");
    await stamp({ employeeId: e.id, terminalId, type: "CLOCK_IN", idempotencyKey: randomUUID(), testNow: t("14:00") });
    const [late] = await processOfflineBatch(terminalId, [await item(e.id, "CLOCK_OUT", t("13:50"))], prisma, t("14:10"));
    expect(late.status).toBe("REJECTED");
    const [ok] = await processOfflineBatch(terminalId, [await item(e.id, "CLOCK_OUT", t("20:00"), "482915", { samePage: false })], prisma, t("20:30"));
    expect(ok.status).toBe("BOOKED");
    expect(await prisma.complianceFinding.count({ where: { employeeId: e.id, code: "OFFLINE_UNTRUSTED" } })).toBe(1);
  });

  it("manipulierte Daten → abgelehnt, nichts gebucht", async () => {
    const e = await newEmployee("Kaputt");
    const it0 = await item(e.id, "CLOCK_IN", t("13:30"));
    it0.sealed.data = Buffer.from("x".repeat(40)).toString("base64");
    const [r] = await processOfflineBatch(terminalId, [it0], prisma, t("14:00"));
    expect(r.status).toBe("REJECTED");
    expect(await prisma.timeClockEvent.count({ where: { employeeId: e.id } })).toBe(0);
  });
});
