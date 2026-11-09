import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { savePhotoSettings } from "@/lib/admin-actions-settings";
import { ActionForm, Field } from "@/components/ActionForm";
import { Check } from "@/components/Select";

export const metadata = { title: "Einstellungen – NAYA TIME" };

export default async function Einstellungen() {
  await requireAdmin("settings.manage");
  const [setting, approval, photos] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "photo.enabled" } }),
    prisma.dataProtectionApproval.findFirst({ where: { feature: "PHOTO_CAPTURE", status: "APPROVED", revokedAt: null }, orderBy: { approvedAt: "desc" } }),
    prisma.clockEventPhoto.count({ where: { deletedAt: null } }),
  ]);
  const on = setting?.value === true && !!approval;
  return (
    <div className="grid max-w-3xl gap-5">
      <h1 className="text-3xl font-semibold">Einstellungen</h1>
      <section className="grid gap-4 rounded-2xl border border-line bg-coal p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Foto beim Stempeln</h2>
          <span className={on ? "text-good" : "text-mute"}>{on ? `An · Löschfrist ${approval!.retentionDays} Tage` : "Aus"}</span>
        </div>
        <p className="text-sm text-mute">
          Fotos werden verschlüsselt gespeichert, nur mit dem Recht „Buchungsfotos ansehen“ angezeigt (jeder Abruf wird protokolliert) und nach Ablauf der Frist
          automatisch gelöscht. Wird die Frist geändert, gilt sie auch für bereits gespeicherte Fotos. Derzeit gespeichert: {photos} Foto{photos === 1 ? "" : "s"}.
          Bitte das Team vorher schriftlich informieren und den Ablageort unten eintragen.
        </p>
        <ActionForm action={savePhotoSettings} submit="Speichern">
          <Check label="Fotofunktion einschalten" name="enabled" defaultChecked={on} />
          <Field label="Löschfrist in Tagen" name="retentionDays" type="number" min={1} defaultValue={approval?.retentionDays ?? 30} required hint="1 bis 365 Tage, Standard 30" />
          <Field label="Zweck" name="purpose" defaultValue={approval?.purpose ?? "Nachweis, dass die Person selbst gestempelt hat (Schutz vor Stempeln für Kollegen)"} />
          <Field label="Rechtsgrundlage" name="legalBasis" defaultValue={approval?.legalBasis ?? "Berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO i. V. m. § 26 BDSG"} />
          <Field label="Ablageort Mitarbeiterinformation (optional)" name="documentRef" defaultValue={approval?.documentRef ?? ""} hint="z. B. „Ordner Personal, Aushang Küche vom …“" />
        </ActionForm>
      </section>
    </div>
  );
}
