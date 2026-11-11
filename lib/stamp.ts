import { randomUUID } from "node:crypto";
import type { ClockEventType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { encryptPhoto, sha256 } from "./crypto";
import { blobStore } from "./storage";
import { HttpError, photoPolicy } from "./terminal";
import { berlinDate, dbDate, minutesBetween } from "./time";
import { computeSession, requiredBreakForPresence } from "./calc/session";

type Tx = Prisma.TransactionClient;

export type EmployeeState = "OUT" | "IN" | "BREAK";

/** Heutiger (bzw. über Mitternacht laufender) geplanter Dienst – der zeitlich nächstgelegene */
export async function findShift(db: Tx | typeof prisma, employeeId: string, at: Date) {
  const today = berlinDate(at);
  const yesterday = berlinDate(new Date(at.getTime() - 86400000));
  const shifts = await db.scheduledShift.findMany({
    where: { employeeId, deletedAt: null, kind: "WORK", workDate: { in: [dbDate(today), dbDate(yesterday)] }, startAt: { not: null } },
    orderBy: { startAt: "asc" },
  });
  // Nur Dienste, die gerade relevant sind: ab 3 Std. vor Beginn bis 2 Std. nach Ende
  const relevant = shifts.filter((s) => {
    const start = s.startAt!.getTime();
    const end = (s.endAt ?? s.startAt!).getTime();
    return at.getTime() >= start - 3 * 3600000 && at.getTime() <= end + 2 * 3600000;
  });
  if (!relevant.length) return null;
  return relevant.reduce((best, s) =>
    Math.abs(s.startAt!.getTime() - at.getTime()) < Math.abs(best.startAt!.getTime() - at.getTime()) ? s : best,
  );
}

/**
 * Vergessenes Ausstempeln: Ist eine Schicht länger als "rules.missingClockOutHours" (Standard 14) offen,
 * wird sie als "Ausstempeln fehlt" markiert (nichts wird erfunden – Arbeitszeit bleibt 0 bis zur Korrektur im Backoffice).
 * Danach kann der Mitarbeiter wieder normal einstempeln.
 */
export async function markStaleSessions(db: Tx, employeeId: string | null, now = new Date()) {
  const setting = await db.systemSetting.findUnique({ where: { key: "rules.missingClockOutHours" } });
  const hours = Number(setting?.value) || 14;
  const stale = await db.workSession.findMany({
    where: { status: "OPEN", ...(employeeId ? { employeeId } : {}), clockInEvent: { effectiveAt: { lt: new Date(now.getTime() - hours * 3600000) } } },
  });
  for (const s of stale) {
    await db.workSession.update({ where: { id: s.id }, data: { status: "MISSING_CLOCK_OUT", payableMinutes: 0, workedMinutes: 0, computedAt: now } });
    await finding(db, { code: "MISSING_CLOCK_OUT", isLegal: false, severity: "WARNING", employeeId: s.employeeId, workDate: s.workDate, refType: "WorkSession", refId: s.id,
      message: `Ausstempeln fehlt (seit mehr als ${hours} Std. eingestempelt) – bitte Ende im Backoffice nachtragen` });
    await audit(db, { actorKind: "SYSTEM", action: "SESSION_MISSING_CLOCK_OUT", entityType: "WorkSession", entityId: s.id, employeeId: s.employeeId });
  }
  return stale.length;
}

export async function employeeState(db: Tx | typeof prisma, employeeId: string) {
  const open = await db.workSession.findFirst({
    where: { employeeId, status: "OPEN" },
    include: { breaks: true, clockInEvent: true },
  });
  if (!open) return { state: "OUT" as EmployeeState, session: null, openBreak: null };
  const openBreak = open.breaks.find((b) => b.startAt && !b.endAt) ?? null;
  return { state: (openBreak ? "BREAK" : "IN") as EmployeeState, session: open, openBreak };
}

async function finding(tx: Tx, f: { code: string; isLegal: boolean; severity: "INFO" | "WARNING" | "CRITICAL"; employeeId: string; workDate: Date; refType: string; refId: string; message: string; details?: object }) {
  await tx.complianceFinding.upsert({
    where: { code_employeeId_workDate_refId: { code: f.code, employeeId: f.employeeId, workDate: f.workDate, refId: f.refId } },
    update: {},
    create: { ...f, details: f.details },
  });
}

export interface StampInput {
  employeeId: string;
  terminalId: string;
  type: ClockEventType;
  idempotencyKey: string;
  photo?: { data: Buffer; mime: string } | null;
  photoMissingReason?: string | null;
  breakTaken?: boolean | null; // Antwort auf "Pause vollständig genommen?"
  ip?: string | null;
  /** Nur für automatisierte Tests. Die API setzt das nie – dort gilt immer die Serverzeit. */
  testNow?: Date;
  /** Offline am iPad erfasst: Zeitpunkt aus letzter Serverzeit-Synchronisierung rekonstruiert (siehe lib/offline.ts) */
  offline?: { effectiveAt: Date; clientRecordedAt: Date; evidence: Prisma.InputJsonValue; trust: "TRUSTED" | "UNTRUSTED"; reasons: string[] };
}

export async function stamp(input: StampInput) {
  // Doppelbuchungsschutz: gleiche Anfrage (z. B. doppelt getippt, Netz-Wiederholung) → gleiches Ergebnis
  const existing = await prisma.timeClockEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.employeeId !== input.employeeId) throw new HttpError(409, "Ungültige Anfrage.");
    return { eventId: existing.id, bookingNo: existing.bookingNo.toString(), type: existing.type, at: existing.effectiveAt, duplicate: true };
  }

  const policy = await photoPolicy();
  const eventId = randomUUID();
  const receivedAt = input.testNow ?? new Date(); // Serverzeit – die iPad-Uhr spielt keine Rolle
  const now = input.offline?.effectiveAt ?? receivedAt; // nur bei Offline-Nachträgen abweichend

  let photoRow: Omit<Prisma.ClockEventPhotoUncheckedCreateInput, "clockEventId"> | null = null;
  let photoStatus: "CAPTURED" | "MISSING_TECHNICAL" | "FEATURE_DISABLED" = "FEATURE_DISABLED";
  if (policy.enabled) {
    if (input.photo && input.photo.data.length > 1000) {
      if (!/^image\/(jpeg|png|webp)$/.test(input.photo.mime) || input.photo.data.length > 2_000_000) throw new HttpError(400, "Ungültiges Foto.");
      const enc = encryptPhoto(input.photo.data);
      const key = `photos/${berlinDate(now).slice(0, 7)}/${eventId}.bin`;
      await blobStore.put(key, enc.ciphertext);
      photoRow = {
        storageKey: key, iv: enc.iv, authTag: enc.authTag, keyVersion: enc.keyVersion, sha256: sha256(input.photo.data),
        mimeType: input.photo.mime, byteSize: input.photo.data.length, capturedAt: now,
        deleteAfter: new Date(now.getTime() + policy.retentionDays * 86400000),
      };
      photoStatus = "CAPTURED";
    } else {
      photoStatus = "MISSING_TECHNICAL";
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
    // Pro Mitarbeiter serialisieren (zwei Tablets/Doppeltipp gleichzeitig)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.employeeId}))`;
    const emp = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
    await markStaleSessions(tx, input.employeeId, now);
    if (input.offline) {
      // Offline-Nachtrag darf nicht vor einer bereits gespeicherten Buchung liegen
      const last = await tx.timeClockEvent.findFirst({ where: { employeeId: emp.id }, orderBy: { effectiveAt: "desc" } });
      if (last && last.effectiveAt >= now) throw new HttpError(409, "Die Offline-Buchung liegt vor einer bereits gespeicherten Buchung.", "OFFLINE_ORDER");
    }
    const { state, session, openBreak } = await employeeState(tx, input.employeeId);

    const invalid: Record<ClockEventType, EmployeeState[]> = {
      CLOCK_IN: ["IN", "BREAK"], CLOCK_OUT: ["OUT"], BREAK_START: ["OUT", "BREAK"], BREAK_END: ["OUT", "IN"],
    };
    if (invalid[input.type].includes(state)) {
      const msg: Record<ClockEventType, string> = {
        CLOCK_IN: "Du bist bereits eingestempelt.", CLOCK_OUT: "Du bist nicht eingestempelt.",
        BREAK_START: state === "BREAK" ? "Deine Pause läuft bereits." : "Du bist nicht eingestempelt.",
        BREAK_END: "Es läuft keine Pause.",
      };
      throw new HttpError(409, msg[input.type], "INVALID_STATE");
    }

    const shift = input.type === "CLOCK_IN" ? await findShift(tx, emp.id, now) : session?.scheduledShiftId ? await tx.scheduledShift.findUnique({ where: { id: session.scheduledShiftId } }) : null;

    const ev = await tx.timeClockEvent.create({
      data: {
        id: eventId, idempotencyKey: input.idempotencyKey, employeeId: emp.id, terminalId: input.terminalId, type: input.type,
        serverReceivedAt: receivedAt, effectiveAt: now, photoStatus,
        ...(input.offline ? { isOffline: true, clientRecordedAt: input.offline.clientRecordedAt, offlineEvidence: input.offline.evidence, offlineTrust: input.offline.trust } : {}),
        photoMissingReason: photoStatus === "MISSING_TECHNICAL" ? (input.photoMissingReason || "Kamera nicht verfügbar").slice(0, 300) : null,
        scheduledShiftId: shift?.id ?? null,
      },
    });
    if (photoRow) await tx.clockEventPhoto.create({ data: { ...photoRow, clockEventId: ev.id } });

    let sessionId = session?.id ?? null;
    const workDate = session?.workDate ?? (shift ? shift.workDate : dbDate(berlinDate(now)));

    if (input.type === "CLOCK_IN") {
      const r = computeSession({ clockIn: now, clockOut: null, plannedStart: shift?.startAt, plannedEnd: shift?.endAt, breaks: [] });
      const ws = await tx.workSession.create({
        data: {
          employeeId: emp.id, departmentId: shift?.departmentId ?? emp.primaryDeptId, workDate, scheduledShiftId: shift?.id ?? null,
          clockInEventId: ev.id, plannedStartAt: shift?.startAt ?? null, plannedEndAt: shift?.endAt ?? null,
          effectiveStartAt: r.effectiveStart, lateMinutes: r.lateMinutes, earlyArrivalMinutes: r.earlyArrivalMinutes, computedAt: now,
        },
      });
      sessionId = ws.id;
      if (r.lateMinutes > 5) {
        await finding(tx, { code: "LATE_START", isLegal: false, severity: "INFO", employeeId: emp.id, workDate, refType: "WorkSession", refId: ws.id,
          message: `Beginn ${r.lateMinutes} Min. nach geplantem Dienstbeginn`, details: { lateMinutes: r.lateMinutes } });
      }
      if (r.earlyArrivalMinutes > 30) {
        await finding(tx, { code: "EARLY_START", isLegal: false, severity: "INFO", employeeId: emp.id, workDate, refType: "WorkSession", refId: ws.id,
          message: `Eingestempelt ${r.earlyArrivalMinutes} Min. vor geplantem Dienstbeginn`, details: { earlyArrivalMinutes: r.earlyArrivalMinutes } });
      }
    } else if (input.type === "BREAK_START") {
      await tx.breakRecord.create({ data: { workSessionId: session!.id, source: "CLOCKED", startEventId: ev.id, startAt: now, minutes: 0 } });
    } else if (input.type === "BREAK_END") {
      await tx.breakRecord.update({ where: { id: openBreak!.id }, data: { endEventId: ev.id, endAt: now, minutes: minutesBetween(openBreak!.startAt!, now) } });
    } else if (input.type === "CLOCK_OUT") {
      const s = session!;
      if (openBreak) {
        await tx.breakRecord.update({ where: { id: openBreak.id }, data: { endEventId: ev.id, endAt: now, minutes: minutesBetween(openBreak.startAt!, now) } });
      }
      const clockIn = s.clockInEvent!.effectiveAt;
      let breaks = await tx.breakRecord.findMany({ where: { workSessionId: s.id } });
      const presence = minutesBetween(clockIn, now);
      const required = requiredBreakForPresence(presence);
      const clocked = breaks.reduce((a, b) => a + b.minutes, 0);
      let confirmation: "NOT_ASKED" | "YES" | "NO" = "NOT_ASKED";
      if (required > 0 && clocked < required && input.breakTaken != null) {
        confirmation = input.breakTaken ? "YES" : "NO";
        if (input.breakTaken) {
          // Vom Mitarbeiter bestätigte, tatsächlich genommene Pause (keine fiktive Buchung)
          await tx.breakRecord.create({ data: { workSessionId: s.id, source: "CONFIRMED_AT_CLOCKOUT", minutes: required - clocked } });
          breaks = await tx.breakRecord.findMany({ where: { workSessionId: s.id } });
        }
      }
      const r = computeSession({ clockIn, clockOut: now, plannedStart: s.plannedStartAt, plannedEnd: s.plannedEndAt, breaks, earlyStartApproved: s.earlyStartApproved });
      await tx.workSession.update({
        where: { id: s.id },
        data: {
          clockOutEventId: ev.id, status: "CLOSED", breakConfirmation: confirmation, effectiveStartAt: r.effectiveStart, effectiveEndAt: r.effectiveEnd,
          presenceMinutes: r.presenceMinutes, breakMinutes: r.breakMinutes, workedMinutes: r.workedMinutes, payableMinutes: r.payableMinutes,
          lateMinutes: r.lateMinutes, earlyArrivalMinutes: r.earlyArrivalMinutes, overrunMinutes: r.overrunMinutes, computedAt: now,
        },
      });
      if (r.breakShortfallMinutes > 0) {
        await finding(tx, { code: "BREAK_MISSING", isLegal: true, severity: "WARNING", employeeId: emp.id, workDate, refType: "WorkSession", refId: s.id,
          message: `Pause unvollständig: ${r.breakMinutes} von ${r.requiredBreakMinutes} Min. dokumentiert – bitte klären`,
          details: { confirmation, ...r } });
      }
      if (r.workedMinutes > 600) {
        await finding(tx, { code: "MAX_HOURS", isLegal: true, severity: "CRITICAL", employeeId: emp.id, workDate, refType: "WorkSession", refId: s.id,
          message: `Arbeitszeit über 10 Stunden (${Math.floor(r.workedMinutes / 60)}:${String(r.workedMinutes % 60).padStart(2, "0")})` });
      }
      if (r.overrunMinutes > 30) {
        await finding(tx, { code: "LATE_END", isLegal: false, severity: "INFO", employeeId: emp.id, workDate, refType: "WorkSession", refId: s.id,
          message: `Ausgestempelt ${r.overrunMinutes} Min. nach geplantem Dienstende` });
      }
    }

    if (photoStatus === "MISSING_TECHNICAL") {
      await finding(tx, { code: "PHOTO_MISSING", isLegal: false, severity: "WARNING", employeeId: emp.id, workDate, refType: "TimeClockEvent", refId: ev.id,
        message: "Foto fehlt – technische Ausnahme", details: { reason: ev.photoMissingReason } });
    }

    if (input.offline?.trust === "UNTRUSTED") {
      await finding(tx, { code: "OFFLINE_UNTRUSTED", isLegal: false, severity: "WARNING", employeeId: emp.id, workDate, refType: "TimeClockEvent", refId: ev.id,
        message: `Offline-Buchung: Uhrzeit nicht sicher belegt (${input.offline.reasons.join("; ")}) – bitte prüfen`, details: { reasons: input.offline.reasons } });
    }

    await audit(tx, {
      actorKind: "TERMINAL", actorId: input.terminalId, action: `STAMP_${input.type}`, entityType: "TimeClockEvent", entityId: ev.id,
      employeeId: emp.id, after: { bookingNo: ev.bookingNo.toString(), at: now.toISOString(), photoStatus, sessionId, ...(input.offline ? { offline: true, trust: input.offline.trust, receivedAt: receivedAt.toISOString() } : {}) }, ip: input.ip,
    });

    return { eventId: ev.id, bookingNo: ev.bookingNo.toString(), type: ev.type, at: now, duplicate: false };
  });
  } catch (e) {
    // Buchung abgelehnt oder fehlgeschlagen: bereits gespeichertes Foto wieder entfernen, sonst bliebe es ohne
    // Datenbankeintrag liegen und würde von der Löschfrist nie erfasst.
    if (photoRow) await blobStore.delete(photoRow.storageKey).catch(() => {});
    throw e;
  }
}
