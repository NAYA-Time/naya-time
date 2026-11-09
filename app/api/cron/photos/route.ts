import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cronAuthorized } from "@/lib/cron-auth";
import { purgeExpiredPhotos } from "@/lib/photos";

// Täglich: Fotos nach Ablauf der Löschfrist endgültig löschen
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, deleted: await purgeExpiredPhotos(prisma) });
}
