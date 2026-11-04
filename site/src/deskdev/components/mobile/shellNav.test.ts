import { describe, expect, it } from 'vitest'
import type { PermFeature } from '../../lib/types'
import { backTargetFor, chatTabLabel, isTabActive, isTabRoot, tabsFor } from './shellNav'

const allow = (...features: PermFeature[]) => (f: PermFeature) => features.includes(f)
const ids = (canView: (f: PermFeature) => boolean) => tabsFor(canView).map((t) => t.id)

describe('tabsFor', () => {
  it('gives the full bar to someone who can see everything', () => {
    expect(ids(() => true)).toEqual(['home', 'tasks', 'chat', 'projects'])
  })

  it('fills a missing gated slot with Calendar, in place', () => {
    expect(ids(allow('projects', 'calendar', 'clients'))).toEqual(['home', 'calendar', 'chat', 'projects'])
    expect(ids(allow('tasks', 'calendar'))).toEqual(['home', 'tasks', 'chat', 'calendar'])
  })

  it('falls back to Clients once Calendar is used or not allowed', () => {
    expect(ids(allow('calendar', 'clients'))).toEqual(['home', 'calendar', 'chat', 'clients'])
    expect(ids(allow('tasks', 'clients'))).toEqual(['home', 'tasks', 'chat', 'clients'])
  })

  it('keeps Home and Chat even with no feature access', () => {
    expect(ids(() => false)).toEqual(['home', 'chat'])
  })
})

describe('isTabActive', () => {
  const [home, tasks, chat, projects] = tabsFor(() => true)

  it('matches Home only on the root', () => {
    expect(isTabActive(home, '/')).toBe(true)
    expect(isTabActive(home, '/tasks')).toBe(false)
  })

  it('lights Chat for both messages and channels, with or without an id', () => {
    for (const p of ['/messages', '/messages/abc', '/channels', '/channels/xyz']) {
      expect(isTabActive(chat, p)).toBe(true)
    }
    expect(isTabActive(chat, '/messagesfoo')).toBe(false)
  })

  it('treats detail routes as part of their tab', () => {
    expect(isTabActive(projects, '/projects/p1')).toBe(true)
    expect(isTabActive(tasks, '/tasks')).toBe(true)
    expect(isTabActive(tasks, '/settings')).toBe(false)
  })

  it('knows when a tap is a scroll-to-top', () => {
    expect(isTabRoot(projects, '/projects')).toBe(true)
    expect(isTabRoot(projects, '/projects/p1')).toBe(false)
    expect(isTabRoot(chat, '/channels')).toBe(false)
    expect(isTabRoot(home, '/')).toBe(true)
  })
})

describe('backTargetFor', () => {
  it('maps every detail route to its list', () => {
    expect(backTargetFor('/projects/123')).toBe('/projects')
    expect(backTargetFor('/clients/c-9')).toBe('/clients')
    expect(backTargetFor('/crm/t1')).toBe('/crm')
    expect(backTargetFor('/courses/k')).toBe('/courses')
    expect(backTargetFor('/growth/leads')).toBe('/growth')
    expect(backTargetFor('/growth/outbound')).toBe('/growth')
  })

  it('has no back on top-level destinations', () => {
    for (const p of ['/', '/projects', '/clients', '/growth', '/settings', '/messages/abc', '/growth/other']) {
      expect(backTargetFor(p)).toBeNull()
    }
  })
})

describe('chatTabLabel', () => {
  it('names the counts', () => {
    expect(chatTabLabel(3, true)).toBe('Chat, 3 unread')
    expect(chatTabLabel(0, true)).toBe('Chat, new channel messages')
    expect(chatTabLabel(0, false)).toBe('Chat')
  })
})
