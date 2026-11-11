"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { hashSecret, randomToken } from "./crypto";
import { ADD_SESSION_PERMISSION } from "./corrections";
import type { FormState } from "./admin-actions-auth";
import { OWNER_ONLY_PERMISSIONS } from "./permissions";

/** Fotofunktion ein/aus und Löschfrist (Tage). Jede Änderung der Freigabe wird als neuer Datensatz dokumentiert. */
export async function savePhotoSettings(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("settings.manage");
  const enabled = fd.get("enabled") === "on";
  const days = Number(fd.get("retentionDays"));
  const purpose = String(fd.get("purpose") ?? "").trim().slice(0, 500);
  const legalBasis = String(fd.get("legalBasis") ?? "").trim().slice(0, 500);
  const documentRef = String(fd.get("documentRef") ?? "").trim().slice(0, 300) || null;
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: "Löschfrist bitte als ganze Zahl von 1 bis 365 Tagen." };
  if (enabled && (purpose.length < 10 || legalBasis.length < 5)) return { error: "Zum Einschalten bitte Zweck und Rechtsgrundlage angeben." };
  const current = await prisma.dataProtectionApproval.findFirst({ where: { feature: "PHOTO_CAPTURE", status: "APPROVED", revokedAt: null }, orderBy: { approvedAt: "desc" } });
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const changed = !current || current.retentionDays !== days || current.purpose !== purpose || current.legalBasis !== legalBasis || current.documentRef !== documentRef;
  await prisma.$transaction(async (tx) => {
    if (enabled && changed) {
      if (current) await tx.dataProtectionApproval.update({ where: { id: current.id }, data: { status: "REVOKED", revokedAt: new Date() } });
      await tx.dataProtectionApproval.create({ data: { feature: "PHOTO_CAPTURE", status: "APPROVED", purpose, legalBasis, retentionDays: days, documentRef, approvedById: admin.id, approvedAt: new Date() } });
    }
    if (current && current.retentionDays !== days && enabled) {
      // Frist gilt auch für vorhandene Fotos (kürzer → werden beim nächsten Löschlauf entfernt)
      await tx.$executeRaw`UPDATE clock_event_photos SET "deleteAfter" = "capturedAt" + make_interval(days => ${days}::int) WHERE "deletedAt" IS NULL`;
    }
    await tx.systemSetting.upsert({ where: { key: "photo.enabled" }, update: { value: enabled, updatedById: admin.id }, create: { key: "photo.enabled", value: enabled, updatedById: admin.id } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "PHOTO_SETTINGS_CHANGED", entityType: "SystemSetting", entityId: "photo.enabled",
      before: { enabled: undefined, retentionDays: current?.retentionDays }, after: { enabled, retentionDays: days }, ip });
  });
  revalidatePath("/admin/einstellungen");
  return { ok: enabled ? `Fotofunktion an, Löschfrist ${days} Tage.` : "Fotofunktion aus. Bereits gespeicherte Fotos werden nach ihrer Frist gelöscht." };
}

/** Einzelrecht "Schichten nachtragen" für eine Person an/aus (z. B. Melanie) */
export async function toggleAddSessionRight(fd: FormData) {
  const admin = await requireAdmin("admins.manage");
  const id = String(fd.get("id"));
  const u = await prisma.adminUser.findUniqueOrThrow({ where: { id } });
  const has = u.extraPermissions.includes(ADD_SESSION_PERMISSION);
  const next = has ? u.extraPermissions.filter((p) => p !== ADD_SESSION_PERMISSION) : [...u.extraPermissions, ADD_SESSION_PERMISSION];
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id }, data: { extraPermissions: next } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "ADMIN_RIGHT_CHANGED", entityType: "AdminUser", entityId: id, before: { extra: u.extraPermissions }, after: { extra: next } });
  });
  revalidatePath("/admin/administratoren");
}

/** Einmaliger Einrichtungslink (24 Std.) für ein neues Backoffice-Konto */
export async function createAdminInvite(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("admins.manage");
  const roleKey = String(fd.get("role"));
  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!role) return { error: "Bitte eine Rolle wählen." };
  const token = randomToken(24);
  const value = { hash: await hashSecret(token), expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(), role: role.key };
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({ where: { key: "admin.setupToken" }, update: { value, updatedById: admin.id }, create: { key: "admin.setupToken", value, updatedById: admin.id } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "ADMIN_INVITE_CREATED", entityType: "Role", entityId: role.key });
  });
  const h = await headers();
  const base = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return { ok: `Einrichtungslink für „${role.name}“ (einmalig, 24 Std. gültig, nur persönlich weitergeben): ${base}/admin/setup?token=${token}` };
}

/** Rechte einer Person einzeln festlegen (nur Inhaber). Häkchen = darf; Unterschied zur Rolle wird als Einzelfreigabe/-sperre gespeichert. */
export async function setAdminPermissions(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("admins.manage");
  if (admin.roleKey !== "OWNER") return { error: "Rechte darf nur der Inhaber vergeben." };
  const id = String(fd.get("id"));
  const u = await prisma.adminUser.findUniqueOrThrow({ where: { id }, include: { role: { include: { permissions: true } } } });
  if (u.role.key === "OWNER") return { error: "Der Inhaber hat immer alle Rechte." };
  const all = (await prisma.permission.findMany()).map((p) => p.key).filter((k) => !OWNER_ONLY_PERMISSIONS.includes(k));
  const wanted = new Set(fd.getAll("perm").map(String).filter((k) => all.includes(k)));
  const fromRole = new Set(u.role.permissions.map((p) => p.permissionKey));
  const extra = all.filter((k) => wanted.has(k) && !fromRole.has(k));
  const revoked = [...fromRole].filter((k) => !wanted.has(k));
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id }, data: { extraPermissions: extra, revokedPermissions: revoked } });
    await tx.session.updateMany({ where: { adminUserId: id, kind: "ADMIN" }, data: { reauthAt: null } }).catch(() => undefined);
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "ADMIN_RIGHT_CHANGED", entityType: "AdminUser", entityId: id, before: { extra: u.extraPermissions, revoked: u.revokedPermissions }, after: { extra, revoked } });
  });
  revalidatePath("/admin/administratoren");
  return { ok: `Rechte für ${u.name} gespeichert. Sie gelten ab dem nächsten Seitenaufruf.` };
}
