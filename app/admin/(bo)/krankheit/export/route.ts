import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { sickReport } from "@/lib/reports/excel";
import { saveReport } from "@/lib/reports/store";

import { DEPT_FILTERS as FILTERS } from "@/lib/dept";

/** Krankheitsliste als Excel herunterladen (nach Mitarbeitern sortiert) */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin("reports.create");
  const q = req.nextUrl.searchParams;
  const from = q.get("von") ?? "", to = q.get("bis") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return new NextResponse("Bitte einen gültigen Zeitraum wählen.", { status: 400 });
  const filter = FILTERS.find((f) => f === q.get("abteilung")) ?? "ALL";
  const built = await sickReport(prisma, from, to, filter);
  const { report, buffer } = await saveReport(prisma, built, "SICK_LIST", filter, admin.id);
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "REPORT_CREATED", entityType: "GeneratedReport", entityId: report.id, after: { fileName: report.fileName } }));
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${report.fileName}"`, "Cache-Control": "no-store" } });
}
