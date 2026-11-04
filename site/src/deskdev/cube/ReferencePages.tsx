export const CUBE_REFERENCE_PAGES = [
  { name: 'Code with Toushif', platform: 'Facebook', url: 'https://www.facebook.com/share/14r1nrEN5fG/?mibextid=wwXIfr' },
] as const

export default function ReferencePages() {
  return <section className="card density-card space-y-3" aria-label="Cube reference pages">
    <h2 className="text-display text-lg font-semibold">Reference pages</h2>
    <div className="flex flex-wrap gap-3">{CUBE_REFERENCE_PAGES.map(page => <a key={page.url} className="btn-secondary min-h-11 inline-flex items-center gap-2" href={page.url} target="_blank" rel="noopener noreferrer">{page.name}<span className="text-xs text-ink-300">{page.platform}</span></a>)}</div>
    <p className="text-xs text-ink-400">Saved reference links. Page ownership, account connection and publishing access have not been verified.</p>
  </section>
}
