import { offlinePublicKey } from "@/lib/offline";
import { jsonError, requireTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

// Öffentlicher Schlüssel für Offline-Buchungen (das iPad kann damit nur verschlüsseln, nicht entschlüsseln)
export async function GET() {
  try {
    await requireTerminal();
    return Response.json({ publicKey: await offlinePublicKey() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
