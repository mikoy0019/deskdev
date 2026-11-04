import { describe, expect, it } from 'vitest'
import type { Lead } from '../../lib/types'
import { conversionStats, csvCell, replyStats, reportLeads, subscribersCsv, tally, utmSource } from './ReportsMath'

const NOW = new Date('2026-10-03T12:00:00Z').getTime()
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString()

function lead(patch: Partial<Lead>): Lead {
  return {
    id: Math.random().toString(36).slice(2), name: 'Lead', stage: 'new', value: 0, source: 'website', hot: false,
    createdAt: at(600), updatedAt: at(600), ...patch,
  }
}

describe('reportLeads', () => {
  it('drops spam and leads older than the range', () => {
    const leads = [
      lead({ id: 'a', createdAt: at(60) }),
      lead({ id: 'b', createdAt: at(60), spam: true }),
      lead({ id: 'c', createdAt: at(60 * 24 * 45) }),
    ]
    expect(reportLeads(leads, '30d', NOW).map((l) => l.id)).toEqual(['a'])
    expect(reportLeads(leads, '90d', NOW).map((l) => l.id)).toEqual(['a', 'c'])
    expect(reportLeads(leads, 'all', NOW).map((l) => l.id)).toEqual(['a', 'c'])
  })
})

describe('tally', () => {
  it('counts each key once per lead, biggest first, blanks under the given label', () => {
    const leads = [
      lead({ services: ['website', 'automation', 'website'] }),
      lead({ services: ['website'] }),
      lead({ services: [] }),
      lead({}),
    ]
    expect(tally(leads, (l) => l.services ?? [], 'None')).toEqual([
      { label: 'None', value: 2 },
      { label: 'website', value: 2 },
      { label: 'automation', value: 1 },
    ])
    expect(tally(leads, (l) => l.services ?? [])).toEqual([
      { label: 'website', value: 2 },
      { label: 'automation', value: 1 },
    ])
  })
})

describe('utmSource', () => {
  it('reads the chosen touch, normalised', () => {
    const l = lead({ attribution: { first: { utm_source: ' Google ' }, last: { utm_source: 'newsletter' } } })
    expect(utmSource(l, 'first')).toBe('google')
    expect(utmSource(l, 'last')).toBe('newsletter')
    expect(utmSource(lead({}), 'first')).toBeUndefined()
    expect(utmSource(lead({ attribution: { first: { utm_source: '   ' } } }), 'first')).toBeUndefined()
  })
})

describe('replyStats', () => {
  it('splits replies into on time and late, and counts breaches as misses', () => {
    const leads = [
      // replied in 10 minutes, due in 60: a hit
      lead({ createdAt: at(120), slaDueAt: at(60), firstRespondedAt: at(110) }),
      // replied after the deadline: a miss, although slaState says 'met'
      lead({ createdAt: at(300), slaDueAt: at(240), firstRespondedAt: at(200) }),
      // never replied, deadline gone: a miss
      lead({ createdAt: at(500), slaDueAt: at(440) }),
      // still inside the SLA: not judged
      lead({ createdAt: at(5), slaDueAt: at(-55) }),
      // manual lead with a reply but no deadline: speed only
      lead({ createdAt: at(90), firstRespondedAt: at(60) }),
      // quarantined: ignored by the SLA
      lead({ createdAt: at(500), slaDueAt: at(440), spam: true }),
    ]
    const r = replyStats(leads, NOW)
    expect(r).toMatchObject({ replied: 3, onTime: 1, late: 1, breached: 1, waiting: 1 })
    expect(r.hitRate).toBeCloseTo(1 / 3)
    // 10, 30 and 100 minutes
    expect(r.medianMs).toBe(30 * 60_000)
  })

  it('has no rate and no median with nothing to judge', () => {
    expect(replyStats([lead({})], NOW)).toMatchObject({ medianMs: null, hitRate: null, replied: 0 })
  })

  it('averages the middle pair for an even count', () => {
    const r = replyStats([
      lead({ createdAt: at(100), firstRespondedAt: at(90) }),
      lead({ createdAt: at(100), firstRespondedAt: at(80) }),
    ], NOW)
    expect(r.medianMs).toBe(15 * 60_000)
  })
})

describe('conversionStats', () => {
  it('counts leads with a client', () => {
    expect(conversionStats([lead({ clientId: 'c1' }), lead({}), lead({}), lead({ clientId: 'c2' })]))
      .toEqual({ total: 4, converted: 2, rate: 0.5 })
    expect(conversionStats([])).toEqual({ total: 0, converted: 0, rate: null })
  })
})

describe('subscribersCsv', () => {
  it('quotes every cell and defuses formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell('+1')).toBe('"\'+1"')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell(undefined)).toBe('""')
  })

  it('writes one row per subscriber with its status', () => {
    const csv = subscribersCsv([
      { id: '1', email: 'ana@example.com', source: 'footer', consentAt: '2026-09-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' },
      { id: '2', email: '@evil', createdAt: '2026-09-02T00:00:00Z', unsubscribedAt: '2026-09-03T00:00:00Z' },
    ])
    expect(csv.split('\r\n')).toEqual([
      '"email","status","source","subscribed_at","unsubscribed_at"',
      '"ana@example.com","subscribed","footer","2026-09-01T00:00:00Z",""',
      '"\'@evil","unsubscribed","","2026-09-02T00:00:00Z","2026-09-03T00:00:00Z"',
      '',
    ])
  })
})
