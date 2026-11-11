import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cronAuthorized } from "@/lib/cron-auth";
import { markStaleSessions } from "@/lib/stamp";
import { mailConfigured, sendMail } from "@/lib/mail";

// Stündlich: vergessenes Ausstempeln erkennen, ohne dass sich die Person erst wieder anmelden muss.
// Die Schicht wird nur markiert (Arbeitszeit bleibt 0 bis zur Korrektur) – nichts wird erfunden.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const marked = await prisma.$transaction((tx) => markStaleSessions(tx, null));
  let mailed = 0;
  if (marked > 0 && mailConfigured()) {
    const owners = await prisma.adminUser.findMany({ where: { active: true, role: { key: "OWNER" } }, select: { email: true } });
    for (const o of owners) {
      try {
        await sendMail(o.email, "NAYA TIME: Ausstempeln fehlt", `Bei ${marked} Schicht${marked > 1 ? "en" : ""} fehlt das Ausstempeln. Bitte in der Verwaltung unter „Zeitbuchungen“ das Ende nachtragen.`);
        mailed++;
      } catch { /* Mailfehler darf die Prüfung nicht stoppen */ }
    }
  }
  return NextResponse.json({ ok: true, marked, mailed });
}
