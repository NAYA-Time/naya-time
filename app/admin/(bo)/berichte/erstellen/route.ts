import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { mondayOf } from "@/lib/admin-actions-schedule";
import { monthlyReport, payrollReport, weeklyReport } from "@/lib/reports/excel";
import { saveReport } from "@/lib/reports/store";

const FILTERS = ["ALL", "KUECHE", "SERVICE"] as const;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Bericht erzeugen, verschlüsselt ablegen und direkt herunterladen */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin("reports.create");
  const q = req.nextUrl.searchParams;
  const typ = q.get("typ");
  const filter = FILTERS.find((f) => f === q.get("abteilung")) ?? "ALL";
  let built, type: "WEEKLY" | "MONTHLY" | "PAYROLL_HOURLY";
  if (typ === "woche" && /^\d{4}-\d{2}-\d{2}$/.test(q.get("woche") ?? "")) { built = await weeklyReport(prisma, await mondayOf(q.get("woche")!), filter); type = "WEEKLY"; }
  else if (typ === "monat" && /^\d{4}-\d{2}$/.test(q.get("monat") ?? "")) { built = await monthlyReport(prisma, q.get("monat")!, filter); type = "MONTHLY"; }
  else if (typ === "aushilfen" && q.get("lauf")) {
    if (!admin.permissions.has("wages.view")) return new NextResponse("Keine Berechtigung", { status: 403 });
    built = await payrollReport(prisma, q.get("lauf")!); type = "PAYROLL_HOURLY";
  } else return new NextResponse("Ungültige Angaben", { status: 400 });
  // Löhne nur mit Berechtigung: Monatsbericht enthält rechnerische Aushilfenbeträge
  if (type === "MONTHLY" && !admin.permissions.has("wages.view")) built.wb.removeWorksheet("Aushilfen");
  const { report, buffer } = await saveReport(prisma, built, type, filter, admin.id);
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "REPORT_CREATED", entityType: "GeneratedReport", entityId: report.id, after: { fileName: report.fileName } }));
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${report.fileName}"`, "Cache-Control": "no-store" } });
}
