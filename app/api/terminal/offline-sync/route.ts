import { processOfflineBatch, type OfflineItem } from "@/lib/offline";
import { hit } from "@/lib/ratelimit";
import { HttpError, jsonError, requireTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

// Offline gespeicherte Buchungen nachreichen. Antwort je Eintrag: BOOKED | DUPLICATE | REJECTED (alle drei = vom iPad löschen).
export async function POST(req: Request) {
  try {
    const device = await requireTerminal();
    const rl = await hit(`offline-sync:${device.id}`, 12, 300);
    if (!rl.ok) throw new HttpError(429, "Zu viele Anfragen.");
    const { items } = (await req.json()) as { items?: OfflineItem[] };
    if (!Array.isArray(items) || items.length > 50) throw new HttpError(400, "Ungültige Anfrage.");
    const valid = items.filter((i) => i && typeof i.id === "string" && i.sealed?.wrappedKey && i.sealed?.iv && i.sealed?.data && typeof i.evidence?.recordedDeviceAt === "number");
    return Response.json({ results: await processOfflineBatch(device.id, valid) });
  } catch (e) {
    return jsonError(e);
  }
}
