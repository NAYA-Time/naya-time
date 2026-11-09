// Urlaubskonto mit automatischem Übertrag (Gunnar 09.11.2026):
// Resturlaub wandert ins nächste Jahr und muss bis 31.03. genommen werden. Was bis dahin nicht genommen ist, verfällt –
// aber nur, wenn der Hinweis an den Mitarbeiter dokumentiert ist (BAG: ohne Hinweis kein Verfall).

export interface VacInput {
  entryDate: string; daysPerYear: number; today: string; year: number;
  days: { date: string; value: number }[]; // Urlaubstage (0,5 oder 1) aller Jahre
  adjust: Map<number, number>; // manuelle Korrektur je Jahr (Tage)
  reminder: Map<number, string | null>; // Hinweis zum Resturlaub des Jahres X dokumentiert am …
}
export interface VacYear {
  entitlement: number; carry: number; carryOpen: number; carryExpires: string; expired: number;
  reminderMissing: boolean; taken: number; planned: number; rest: number;
}

const half = (n: number) => Math.round(n * 2) / 2;

export function entitlementFor(entryDate: string, daysPerYear: number, y: number): number {
  const ey = Number(entryDate.slice(0, 4)), em = Number(entryDate.slice(5, 7)), ed = Number(entryDate.slice(8, 10));
  const months = ey < y ? 12 : ey > y ? 0 : 12 - (em - 1) - (ed > 1 ? 1 : 0);
  return Math.ceil(((daysPerYear * months) / 12) * 2) / 2;
}

export function vacationYear(inp: VacInput): VacYear {
  const entryYear = Number(inp.entryDate.slice(0, 4));
  const start = Math.max(entryYear, inp.year - 5);
  let carryIn = 0;
  let res: VacYear | null = null;
  for (let y = start; y <= inp.year; y++) {
    const inYear = inp.days.filter((d) => d.date.startsWith(`${y}-`));
    const deadline = `${y}-03-31`;
    const usedEarly = inYear.filter((d) => d.date <= deadline).reduce((a, d) => a + d.value, 0);
    const carryOpen = Math.max(0, carryIn - usedEarly);
    const past = inp.today > deadline;
    const reminded = !!inp.reminder.get(y - 1);
    const expired = past && reminded ? carryOpen : 0;
    const entitlement = entitlementFor(inp.entryDate, inp.daysPerYear, y);
    const total = entitlement + carryIn + (inp.adjust.get(y) ?? 0) - expired;
    const taken = inYear.filter((d) => d.date <= inp.today).reduce((a, d) => a + d.value, 0);
    const planned = inYear.filter((d) => d.date > inp.today).reduce((a, d) => a + d.value, 0);
    res = { entitlement, carry: half(carryIn), carryOpen: past ? 0 : half(carryOpen), carryExpires: deadline, expired: half(expired), reminderMissing: past && !reminded && carryOpen > 0, taken: half(taken), planned: half(planned), rest: half(total - taken - planned) };
    carryIn = Math.max(0, total - taken - planned); // Rest am Jahresende → Übertrag ins nächste Jahr
  }
  return res ?? { entitlement: 0, carry: 0, carryOpen: 0, carryExpires: `${inp.year}-03-31`, expired: 0, reminderMissing: false, taken: 0, planned: 0, rest: 0 };
}
