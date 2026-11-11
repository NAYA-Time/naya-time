import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { loadVacationData } from "@/lib/vacation-calendar";
import { buildCalendar, monthRange, yearTable } from "@/lib/calc/vacation-calendar";
import { monthPdf, yearPdf } from "@/lib/reports/vacation-pdf";

/** Urlaubsübersicht als PDF: ?monat=YYYY-MM oder ?jahr=YYYY */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin("employees.view");
  const q = req.nextUrl.searchParams;
  const month = q.get("monat") ?? "", year = q.get("jahr") ?? "";
  const stand = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
  let bytes: Uint8Array, name: string;
  if (/^\d{4}-\d{2}$/.test(month)) {
    const { from, to } = monthRange(month);
    const { emps, entries } = await loadVacationData(from, to);
    bytes = await monthPdf(buildCalendar(emps, entries, from, to), month, stand);
    name = `Urlaub_${month}.pdf`;
  } else if (/^\d{4}$/.test(year)) {
    const { emps, entries } = await loadVacationData(`${year}-01-01`, `${year}-12-31`);
    bytes = await yearPdf(yearTable(emps, entries, Number(year)), Number(year), stand);
    name = `Urlaub_${year}.pdf`;
  } else return new NextResponse("Bitte Monat oder Jahr angeben.", { status: 400 });
  await prisma.$transaction((tx) => audit(tx, { actorKind: "ADMIN", actorId: admin.id, action: "VACATION_PDF_CREATED", entityType: "Report", after: { fileName: name } }));
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
