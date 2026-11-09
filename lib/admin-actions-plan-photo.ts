"use server";
// Dienstplan per Foto: 1) Foto lesen → Vorschlag, 2) nach Prüfung speichern.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./admin-auth";
import { extractPlanFromPhoto, PlanPhotoError } from "./plan-photo";
import { planEmployees, proposalFor, savePlanImport, type SaveInput } from "./plan-import";
import type { ExtractedPlan, Proposal } from "./calc/plan-import";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Nur für die lokale Probe-Kopie ohne API-Schlüssel: ausgelesene Tabelle aus Datei statt Bilderkennung. Auf dem Server nie gesetzt. */
async function probeFixture(fileName: string): Promise<ExtractedPlan | null> {
  const dir = process.env.PLAN_PHOTO_TEST_FIXTURE_DIR;
  if (!dir || !process.env.DATABASE_URL?.includes("naya_time_probe")) return null;
  try { return JSON.parse(await readFile(path.join(dir, path.basename(fileName).replace(/\.[^.]+$/, "") + ".json"), "utf8")); } catch { return null; }
}

export async function readPlanPhoto(fd: FormData): Promise<{ proposal?: Proposal; error?: string }> {
  const admin = await requireAdmin("schedule.manage");
  const file = fd.get("photo");
  const monday = String(fd.get("monday") ?? "");
  const originalName = String(fd.get("originalName") ?? "");
  if (!(file instanceof File) || !file.size) return { error: "Bitte ein Foto auswählen." };
  if (file.size > MAX_BYTES) return { error: "Das Foto ist zu groß (höchstens 5 MB)." };
  const type = TYPES.find((t) => t === file.type);
  if (!type) return { error: "Bitte ein Foto als JPG, PNG oder WebP." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return { error: "Ungültige Woche." };
  try {
    const emps = await planEmployees();
    const plan = (await probeFixture(originalName)) ?? (await extractPlanFromPhoto(Buffer.from(await file.arrayBuffer()), type, { employeeNames: emps.map((e) => `${e.firstName} ${e.lastName}`), weekHint: monday }));
    const proposal = await proposalFor(plan, monday);
    // Das Foto selbst wird nicht gespeichert; protokolliert wird nur, dass gelesen wurde
    await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "SCHEDULE_PHOTO_READ", entityType: "WorkSchedule", after: { monday: proposal.monday, rows: proposal.rows.length, bytes: file.size } }));
    return { proposal };
  } catch (e) {
    if (e instanceof PlanPhotoError) return { error: e.message };
    console.error("Dienstplan-Foto", e);
    return { error: "Das Foto konnte nicht ausgewertet werden. Bitte erneut versuchen." };
  }
}

export async function confirmPlanImport(input: SaveInput): Promise<{ ok?: string; error?: string }> {
  const admin = await requireAdmin("schedule.manage");
  const res = await savePlanImport(admin.id, input);
  if (res.ok) revalidatePath("/admin/dienstplan");
  return res;
}
