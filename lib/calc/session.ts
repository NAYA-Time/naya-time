// Reine Berechnung einer Arbeitsschicht. Keine Datenbank, vollständig testbar. Alle Werte in ganzen Minuten.

export interface BreakInput {
  minutes: number;
}

export interface SessionInput {
  clockIn: Date;
  clockOut: Date | null;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  breaks: BreakInput[]; // tatsächlich genommene/bestätigte Pausen
  earlyStartApproved?: boolean; // genehmigte Meldung "früher angefangen"
  approvedStart?: Date | null; // ggf. genehmigter Beginn (sonst Stempelzeit)
}

export interface SessionResult {
  effectiveStart: Date;
  effectiveEnd: Date | null;
  presenceMinutes: number; // Stempelung bis Stempelung
  breakMinutes: number;
  workedMinutes: number; // tatsächliche Arbeitszeit (Anwesenheit – Pausen)
  payableMinutes: number; // vergütungsrelevant
  lateMinutes: number;
  earlyArrivalMinutes: number;
  overrunMinutes: number; // nach geplantem Ende
  requiredBreakMinutes: number; // gesetzlich erforderlich (§ 4 ArbZG) für die tatsächliche Arbeitszeit
  breakShortfallMinutes: number;
}

const diff = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 60000);

/**
 * § 4 ArbZG: mehr als 6 Std. Arbeit → 30 Min., mehr als 9 Std. → 45 Min.
 * Eingabe = Anwesenheit; geprüft wird die Arbeitszeit nach Abzug der Pause selbst.
 */
export function requiredBreakForPresence(presence: number): number {
  if (presence - 0 <= 360) return 0;
  if (presence - 30 <= 540) return 30;
  return 45;
}

/** Erforderliche Pause zu einer bereits feststehenden Arbeitszeit (ohne Pausen) */
export function requiredBreakForWork(work: number): number {
  if (work > 540) return 45;
  if (work > 360) return 30;
  return 0;
}

export function computeSession(s: SessionInput): SessionResult {
  const lateMinutes = s.plannedStart ? Math.max(0, diff(s.plannedStart, s.clockIn)) : 0;
  const earlyArrivalMinutes = s.plannedStart ? Math.max(0, diff(s.clockIn, s.plannedStart)) : 0;

  // Vergütungsrelevanter Beginn: bei frühem Einstempeln zunächst der geplante Beginn,
  // außer frühere Arbeit wurde gemeldet und genehmigt.
  let effectiveStart = s.clockIn;
  if (s.plannedStart && s.clockIn < s.plannedStart && !s.earlyStartApproved) effectiveStart = s.plannedStart;
  if (s.earlyStartApproved && s.approvedStart) effectiveStart = s.approvedStart;

  const breakMinutes = s.breaks.reduce((a, b) => a + Math.max(0, b.minutes), 0);

  if (!s.clockOut) {
    return {
      effectiveStart, effectiveEnd: null, presenceMinutes: 0, breakMinutes, workedMinutes: 0, payableMinutes: 0,
      lateMinutes, earlyArrivalMinutes, overrunMinutes: 0, requiredBreakMinutes: 0, breakShortfallMinutes: 0,
    };
  }

  // Ende: tatsächliches Ausstempeln zählt (nichts wird gestrichen), Überzug wird nur ausgewiesen.
  const effectiveEnd = s.clockOut;
  const presenceMinutes = Math.max(0, diff(s.clockIn, s.clockOut));
  const workedMinutes = Math.max(0, presenceMinutes - breakMinutes);
  const payableSpan = Math.max(0, diff(effectiveStart, effectiveEnd));
  const payableMinutes = Math.max(0, payableSpan - breakMinutes);
  const overrunMinutes = s.plannedEnd ? Math.max(0, diff(s.plannedEnd, s.clockOut)) : 0;

  const requiredBreakMinutes = requiredBreakForWork(workedMinutes);
  const breakShortfallMinutes = Math.max(0, requiredBreakMinutes - breakMinutes);

  return {
    effectiveStart, effectiveEnd, presenceMinutes, breakMinutes, workedMinutes, payableMinutes,
    lateMinutes, earlyArrivalMinutes, overrunMinutes, requiredBreakMinutes, breakShortfallMinutes,
  };
}
