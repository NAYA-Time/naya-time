import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { loadReportFile } from "@/lib/reports/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("reports.create");
  const r = await prisma.generatedReport.findUnique({ where: { id: (await params).id } });
  if (!r) return new NextResponse("Nicht gefunden", { status: 404 });
  if (r.reportType === "PAYROLL_HOURLY" && !admin.permissions.has("wages.view")) return new NextResponse("Keine Berechtigung", { status: 403 });
  const buf = await loadReportFile(r.storageKey);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store" } });
}
