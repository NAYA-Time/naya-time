import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Erreichbarkeitsprüfung für Docker und externe Überwachung. Gibt keine Daten preis – nur „läuft“ oder „Datenbank fehlt“.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
