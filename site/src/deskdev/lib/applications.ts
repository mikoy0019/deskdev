/** Local application assistant: every CV line must come from supplied evidence. */
export function oljLinks(text: string): { urls: string[]; invalid: string[] } {
  const urls = new Set<string>()
  const invalid: string[] = []
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    try {
      const u = new URL(raw)
      if (u.protocol !== 'https:' || !['onlinejobs.ph', 'www.onlinejobs.ph'].includes(u.hostname) || !/^\/jobseekers\/job\/[^/]+\/?$/.test(u.pathname) || u.username || u.password || u.port) throw new Error()
      decodeURIComponent(u.pathname)
      u.hostname = 'www.onlinejobs.ph'; u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/$/, '')
      urls.add(u.href)
    } catch { invalid.push(raw) }
  }
  return { urls: [...urls], invalid }
}

const SKILLS = ['javascript', 'typescript', 'react', 'next.js', 'node.js', 'python', 'php', 'wordpress', 'shopify', 'sql', 'supabase', 'figma', 'photoshop', 'canva', 'seo', 'google ads', 'facebook ads', 'excel', 'customer service', 'bookkeeping', 'quickbooks', 'video editing', 'project management', 'data entry', 'virtual assistant', 'social media', 'n8n']
const has = (text: string, skill: string) => new RegExp(`(^|[^a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text)

export function prepareApplication(posting: string, cv: string) {
  const required = SKILLS.filter((skill) => has(posting, skill))
  const supported = required.filter((skill) => has(cv, skill))
  const gaps = required.filter((skill) => !has(cv, skill))
  const lines = cv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const relevant = lines.filter((line) => supported.some((skill) => has(line, skill)))
  return {
    required, supported, gaps,
    analysis: `Matching topics: ${supported.join(', ') || 'No explicit keyword matches yet'}.\nNot evidenced in the supplied CV: ${gaps.join(', ') || 'None of the recognized topics'}.\nReview the full listing for experience, schedule, salary and application instructions. Keyword matches do not prove proficiency.`,
    draft: `APPLICATION CV WORKING DRAFT\n\nRELEVANT EXPERIENCE (verbatim from supplied CV)\n${relevant.length ? relevant.join('\n') : 'No matching evidence selected. Add relevant experience to your source CV.'}\n\nSOURCE CV\n${cv.trim()}\n\nREVIEW BEFORE APPLYING\nCheck contact details, dates and every claim. ${gaps.length ? `Do not claim ${gaps.join(', ')} without evidence.` : 'Verify all requirements against the original posting.'}`,
  }
}
