import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cronAuthorized } from "@/lib/cron-auth";
import { runDueSchedules } from "@/lib/reports/runner";

// Aufruf z. B. stündlich durch Vercel Cron mit "Authorization: Bearer <CRON_SECRET>"
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await runDueSchedules(prisma);
  return NextResponse.json({ ok: true, results });
}
