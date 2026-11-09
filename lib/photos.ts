// Buchungsfotos: Ansehen (nur mit Recht photos.view, jeder Abruf protokolliert) und Löschen nach Ablauf der Frist.
import type { PrismaClient } from "@prisma/client";
import { audit } from "./audit";
import { decryptPhoto } from "./crypto";
import { blobStore } from "./storage";

/** Abgelaufene Fotos endgültig löschen. Der Datensatz bleibt als Nachweis (Prüfsumme, Zeitpunkt), die Bilddatei ist weg. */
export async function purgeExpiredPhotos(db: PrismaClient, now = new Date()) {
  const due = await db.clockEventPhoto.findMany({ where: { deletedAt: null, deleteAfter: { lte: now } }, take: 1000 });
  for (const p of due) {
    await blobStore.delete(p.storageKey);
    await db.$transaction(async (tx) => {
      await tx.clockEventPhoto.update({ where: { id: p.id }, data: { deletedAt: now } });
      await audit(tx, { actorKind: "SYSTEM", action: "PHOTO_DELETED", entityType: "ClockEventPhoto", entityId: p.id, after: { clockEventId: p.clockEventId, deleteAfter: p.deleteAfter.toISOString() } });
    });
  }
  return due.length;
}

export async function viewPhoto(db: PrismaClient, adminId: string, clockEventId: string, ip: string | null) {
  const p = await db.clockEventPhoto.findUnique({ where: { clockEventId }, include: { clockEvent: true } });
  if (!p || p.deletedAt) return null;
  const raw = await blobStore.get(p.storageKey);
  const data = decryptPhoto(raw, Buffer.from(p.iv), Buffer.from(p.authTag));
  await db.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "PHOTO_VIEWED", entityType: "ClockEventPhoto", entityId: p.id, employeeId: p.clockEvent.employeeId, ip }));
  return { data, mime: p.mimeType };
}
