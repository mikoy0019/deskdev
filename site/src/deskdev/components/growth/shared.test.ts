import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Lead } from '../../lib/types'
import { growthMetrics, httpUrl, useNow } from './shared'

;(window as Window & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('httpUrl', () => {
  it('keeps absolute http and https links', () => {
    expect(httpUrl('https://x.com/a')).toBe('https://x.com/a')
    expect(httpUrl('http://x')).toBe('http://x/')
    expect(httpUrl('HTTPS://Example.com/Jobs?id=1')).toBe('https://example.com/Jobs?id=1')
  })

  it('drops script, data, other schemes, relative and empty values', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'ftp://x',
      'mailto:a@b.c',
      '/relative',
      'relative/path',
      '//x.com/a',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(httpUrl(bad), String(bad)).toBeUndefined()
    }
  })
})

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks on the given step and stops when unmounted', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'))
    const seen: number[] = []
    function Probe() {
      seen.push(useNow(1000))
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Probe)))
    expect(seen.at(-1)).toBe(Date.parse('2026-10-02T10:00:00Z'))

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen.at(-1)).toBe(Date.parse('2026-10-02T10:00:01Z'))

    act(() => root.unmount())
    const renders = seen.length
    vi.advanceTimersByTime(5000)
    expect(seen.length).toBe(renders)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('growthMetrics', () => {
  const NOW = Date.parse('2026-10-03T12:00:00Z')
  const at = (daysAgo: number) => new Date(NOW - daysAgo * 864e5).toISOString()
  const lead = (patch: Partial<Lead>): Lead => ({
    id: Math.random().toString(36).slice(2), name: 'Lead', stage: 'new', value: 1000, source: 'website', hot: false,
    createdAt: at(1), updatedAt: at(1), ...patch,
  })
  const run = (leads: Lead[], monthlyTarget?: number) =>
    growthMetrics({ now: NOW, leads, leadActivity: [], campaigns: [], staleDays: 7, monthlyTarget, weeklyTarget: 50 })

  it('leaves quarantined spam out of every figure', () => {
    const g = run([
      lead({ id: 'a' }),
      lead({ id: 'b', stage: 'proposal', value: 500 }),
      lead({ id: 'won', stage: 'won', value: 2000, source: 'referral' }),
      lead({ id: 'spam', spam: true, hot: true, value: 9000, source: 'other', createdAt: at(30), followUp: '2026-09-01' }),
      lead({ id: 'spam-won', spam: true, stage: 'won', value: 9000, source: 'other' }),
    ])
    expect(g.leads.map((l) => l.id)).toEqual(['a', 'b', 'won'])
    expect(g.open.map((l) => l.id)).toEqual(['a', 'b'])
    expect(g.newThisWeek).toHaveLength(3)
    expect(g.pipelineValue).toBe(1500)
    expect(g.wonValue).toBe(2000)
    expect(g.sources.breakdown.map((s) => s.label)).not.toContain('Other')
    expect(g.sources.roi).toEqual([{ label: 'Referral', value: 2000 }])
    expect(g.funnel.reduce((n, f) => n + f.value, 0)).toBe(3)
    expect(g.radar).toEqual([])
    expect(g.goingCold).toEqual([])
    expect(g.awaitingFirstReply.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('has no goal ratio when no monthly target is set', () => {
    const won = [lead({ stage: 'won', updatedAt: at(0) })]
    expect(run(won).monthlyTarget).toBeUndefined()
    expect(run(won).goalRatio).toBe(0)
    expect(run(won, 4).goalRatio).toBe(0.25)
  })
})
