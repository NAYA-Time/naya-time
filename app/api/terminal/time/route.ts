// Serverzeit für die Uhr am Terminal (iPad-Uhr wird nicht verwendet)
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
