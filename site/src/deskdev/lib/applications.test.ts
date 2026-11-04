import { describe, it, expect } from 'vitest'
import { oljLinks, prepareApplication } from './applications'

describe('OLJ application preparation', () => {
  it('canonicalizes and deduplicates posting links without accepting other hosts or credentials', () => {
    expect(oljLinks('https://onlinejobs.ph/jobseekers/job/Developer-123?ref=a https://www.onlinejobs.ph/jobseekers/job/Developer-123/')).toEqual({ urls: ['https://www.onlinejobs.ph/jobseekers/job/Developer-123'], invalid: [] })
    expect(oljLinks('http://onlinejobs.ph/jobseekers/job/123 https://onlinejobs.ph.evil.test/jobseekers/job/123 https://user@onlinejobs.ph/jobseekers/job/123 https://www.onlinejobs.ph/ https://www.onlinejobs.ph:4433/jobseekers/job/123').invalid).toHaveLength(5)
  })
  it('prioritizes supplied CV evidence and does not invent missing qualifications', () => {
    const cv = 'Alex\nBuilt React dashboards for a real client.\nCustomer service for two years.'
    const result = prepareApplication('React developer with Python and SQL required', cv)
    expect(result.supported).toEqual(['react'])
    expect(result.gaps).toEqual(['python', 'sql'])
    expect(result.draft).toContain('Built React dashboards for a real client.')
    expect(result.draft).not.toContain('Experienced Python')
    expect(result.draft).toContain(cv)
  })
  it('does not mistake substrings for qualifications', () => {
    const result = prepareApplication('React developer', 'Customer reacted quickly')
    expect(result.supported).toEqual([])
    expect(result.gaps).toEqual(['react'])
  })
})
