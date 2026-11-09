"use server";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { audit } from "./audit";
import { hashSecret } from "./crypto";
import { requireAdmin } from "./admin-auth";
import type { FormState } from "./admin-actions-auth";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function createPairingCode(_: FormState): Promise<FormState> {
  const admin = await requireAdmin("terminal.manage");
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + 15 * 60000);
  const value = { hash: await hashSecret(code), expiresAt: expiresAt.toISOString() };
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({ where: { key: "terminal.pairingCode" }, update: { value }, create: { key: "terminal.pairingCode", value } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "TERMINAL_PAIRING_CODE", entityType: "TerminalDevice" });
  });
  return { ok: `Kopplungscode: ${code} – gültig bis ${expiresAt.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr. Am iPad /terminal öffnen und den Code eingeben.` };
}

export async function toggleTerminal(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin("terminal.manage");
  const id = String(fd.get("id"));
  const active = fd.get("active") === "true";
  await prisma.$transaction(async (tx) => {
    await tx.terminalDevice.update({ where: { id }, data: { active } });
    await audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: active ? "TERMINAL_ENABLED" : "TERMINAL_DISABLED", entityType: "TerminalDevice", entityId: id });
  });
  revalidatePath("/admin/terminals");
  return { ok: active ? "Terminal freigegeben." : "Terminal gesperrt. Dieses Gerät kann nicht mehr stempeln." };
}
