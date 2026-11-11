import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { loadReportFile } from "@/lib/reports/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("reports.create");
  const r = await prisma.generatedReport.findUnique({ where: { id: (await params).id } });
  if (!r) return new NextResponse("Nicht gefunden", { status: 404 });
  if (r.reportType === "PAYROLL_HOURLY" && !admin.permissions.has("wages.view")) return new NextResponse("Keine Berechtigung", { status: 403 });
  let buf = await loadReportFile(r.storageKey);
  // Gespeicherte Monatsberichte enthalten das Blatt „Aushilfen“ mit Löhnen – ohne Lohnrecht wird es vor dem Download entfernt
  if (r.reportType === "MONTHLY" && !admin.permissions.has("wages.view")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Aushilfen");
    if (ws) { wb.removeWorksheet(ws.id); buf = Buffer.from(await wb.xlsx.writeBuffer()); }
  }
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store" } });
}
