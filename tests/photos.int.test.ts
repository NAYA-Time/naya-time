// Fotos: Ansehen wird protokolliert, nach Ablauf der Frist wird die Bilddatei gelöscht (Datensatz bleibt als Nachweis).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";
import { hashSecret } from "../lib/crypto";
import { purgeExpiredPhotos, viewPhoto } from "../lib/photos";
import { stamp } from "../lib/stamp";
import { blobStore } from "../lib/storage";
import { berlinToInstant, dbDate } from "../lib/time";

const ADMIN = "00000000-0000-4000-8000-000000000001";
let terminalId = "";
let deptId = "";

beforeAll(async () => {
  deptId = (await prisma.department.upsert({ where: { key: "KUECHE" }, update: {}, create: { key: "KUECHE", name: "Küche", kind: "MAIN" } })).id;
  terminalId = (await prisma.terminalDevice.create({ data: { name: "Foto-Test", tokenHash: randomUUID() } })).id;
  await prisma.systemSetting.upsert({ where: { key: "photo.enabled" }, update: { value: true }, create: { key: "photo.enabled", value: true } });
  if (!(await prisma.dataProtectionApproval.findFirst({ where: { status: "APPROVED" } }))) {
    await prisma.dataProtectionApproval.create({ data: { feature: "PHOTO_CAPTURE", status: "APPROVED", purpose: "Test", legalBasis: "Test", retentionDays: 30, approvedAt: new Date() } });
  }
});

describe("Fotos", () => {
  it("ansehen → entschlüsselt + protokolliert; nach Frist gelöscht", async () => {
    const e = await prisma.employee.create({
      data: { personnelNumber: `F-${randomUUID().slice(0, 8)}`, firstName: "Foto", lastName: "Test", displayName: "Foto", employmentType: "FESTANGESTELLT",
        primaryDeptId: deptId, entryDate: dbDate("2026-01-01"), credential: { create: { pinHash: await hashSecret("482915"), mustSetPin: false } } },
    });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4000, 7)]);
    const at = berlinToInstant("2026-09-01", "10:00");
    const r = await stamp({ employeeId: e.id, terminalId, type: "CLOCK_IN", idempotencyKey: randomUUID(), photo: { data: jpeg, mime: "image/jpeg" }, testNow: at });
    const v = await viewPhoto(prisma, ADMIN, r.eventId, null);
    expect(v?.data.equals(jpeg)).toBe(true);
    const p = await prisma.clockEventPhoto.findUniqueOrThrow({ where: { clockEventId: r.eventId } });
    expect(await prisma.auditLog.count({ where: { action: "PHOTO_VIEWED", entityId: p.id } })).toBe(1);

    expect(await purgeExpiredPhotos(prisma, new Date(at.getTime() + 29 * 86400000))).toBe(0); // Frist (30 Tage) läuft noch
    expect(await purgeExpiredPhotos(prisma, new Date(at.getTime() + 31 * 86400000))).toBeGreaterThanOrEqual(1);
    expect((await prisma.clockEventPhoto.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).not.toBeNull();
    await expect(blobStore.get(p.storageKey)).rejects.toThrow();
    expect(await viewPhoto(prisma, ADMIN, r.eventId, null)).toBeNull();
  });
});
