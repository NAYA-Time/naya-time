// Fristen je Mitarbeiter: Vorlagen, Status und Text für den Hinweis beim Einstempeln (rein, testbar).
export const REMINDER_KINDS: Record<string, { label: string; days: number; repeat: number | null; text: string }> = {
  PROBATION_END: { label: "Probezeit endet", days: 28, repeat: null, text: "Deine Probezeit endet am {date}. Bitte kurz bei der Leitung melden." },
  CONTRACT_END: { label: "Befristeter Vertrag endet", days: 42, repeat: null, text: "Dein befristeter Vertrag endet am {date}. Bitte bei der Leitung melden." },
  IFSG: { label: "Belehrung Infektionsschutz (alle 2 Jahre)", days: 30, repeat: 24, text: "Deine Belehrung nach Infektionsschutzgesetz ist am {date} fällig. Bitte Termin mit der Leitung machen." },
  HYGIENE: { label: "Hygieneschulung (jährlich)", days: 30, repeat: 12, text: "Deine Hygieneschulung ist am {date} fällig." },
  WORK_PERMIT: { label: "Aufenthalts-/Arbeitserlaubnis läuft ab", days: 60, repeat: null, text: "Deine Aufenthalts- bzw. Arbeitserlaubnis läuft am {date} ab. Bitte rechtzeitig verlängern und das neue Dokument abgeben." },
  OTHER: { label: "Sonstiges", days: 14, repeat: null, text: "Bitte bei der Leitung melden: {title} (bis {date})." },
};

const de = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const addMonths = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export type ReminderStatus = "DONE" | "OVERDUE" | "DUE_SOON" | "LATER";
export function reminderStatus(r: { dueDate: string; remindDaysBefore: number; done: boolean }, today: string): ReminderStatus {
  if (r.done) return "DONE";
  if (r.dueDate < today) return "OVERDUE";
  if (addDays(r.dueDate, -r.remindDaysBefore) <= today) return "DUE_SOON";
  return "LATER";
}

export function terminalNotice(r: { kind: string; title: string; dueDate: string; terminalText: string | null }): string {
  const t = r.terminalText?.trim() || REMINDER_KINDS[r.kind]?.text || REMINDER_KINDS.OTHER.text;
  return t.replaceAll("{date}", de(r.dueDate)).replaceAll("{title}", r.title);
}
