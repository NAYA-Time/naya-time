import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { viewPhoto } from "@/lib/photos";

// Buchungsfoto anzeigen – nur mit Recht "photos.view", jeder Abruf steht im Änderungsprotokoll
export async function GET(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const admin = await requireAdmin("photos.view");
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(eventId)) return new NextResponse("Nicht gefunden", { status: 404 });
  const h = await headers();
  const p = await viewPhoto(prisma, admin.id, eventId, h.get("x-forwarded-for")?.split(",")[0].trim() ?? null);
  if (!p) return new NextResponse("Kein Foto (nie aufgenommen oder nach Ablauf der Frist gelöscht)", { status: 404 });
  return new NextResponse(new Uint8Array(p.data), { headers: { "Content-Type": p.mime, "Cache-Control": "no-store, private" } });
}
