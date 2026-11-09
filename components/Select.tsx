export function Select({ label, name, options, defaultValue, required }: { label: string; name: string; options: [string, string][]; defaultValue?: string | null; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-sm text-mute">
      {label}
      <select name={name} defaultValue={defaultValue ?? ""} required={required} className="min-h-12 rounded-xl border border-line bg-ink px-3 text-base text-paper focus:border-gold focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-paper">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-5 accent-[#c8a15c]" />
      {label}
    </label>
  );
}
export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-2xl border border-line bg-coal p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-mute">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
