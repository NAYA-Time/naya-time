import type { ClockEventType } from "@prisma/client";
import { verifyTicket } from "@/lib/crypto";
import { stamp } from "@/lib/stamp";
import { HttpError, clientIp, jsonError, requireTerminal } from "@/lib/terminal";
import { berlinTime } from "@/lib/time";

const TYPES: ClockEventType[] = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"];

// multipart/form-data: ticket, type, idempotencyKey, photo (Datei) | photoMissingReason, breakTaken ("yes"|"no")
export async function POST(req: Request) {
  try {
    const device = await requireTerminal();
    const form = await req.formData();
    const ticket = verifyTicket<{ e: string; t: string }>(String(form.get("ticket") ?? ""));
    if (!ticket || ticket.t !== device.id) throw new HttpError(401, "Anmeldung abgelaufen. Bitte PIN erneut eingeben.", "TICKET_EXPIRED");
    const type = String(form.get("type")) as ClockEventType;
    if (!TYPES.includes(type)) throw new HttpError(400, "Unbekannte Buchungsart.");
    const idempotencyKey = String(form.get("idempotencyKey") ?? "");
    if (!/^[A-Za-z0-9-]{16,64}$/.test(idempotencyKey)) throw new HttpError(400, "Ungültige Anfrage.");

    const file = form.get("photo");
    const photo = file instanceof File && file.size > 0 ? { data: Buffer.from(await file.arrayBuffer()), mime: file.type || "image/jpeg" } : null;
    const bt = form.get("breakTaken");

    const r = await stamp({
      employeeId: ticket.e, terminalId: device.id, type, idempotencyKey, photo,
      photoMissingReason: (form.get("photoMissingReason") as string | null) ?? null,
      breakTaken: bt === "yes" ? true : bt === "no" ? false : null,
      ip: await clientIp(),
    });
    return Response.json({ ok: true, bookingNo: r.bookingNo, type: r.type, time: berlinTime(r.at), duplicate: r.duplicate });
  } catch (e) {
    return jsonError(e);
  }
}
