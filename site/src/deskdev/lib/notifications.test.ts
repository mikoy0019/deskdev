import { describe, expect, it } from 'vitest'
import {
  categoryOf, normalizePrefs, notificationHref, spokenLine, wantsDesktop, wantsVoice, DEFAULT_NOTIFY_PREFS,
} from './notifications'

const ctx = {
  crmRows: [{ id: 'row-1', tableId: 'tbl-1' }],
  crmColumns: [{ id: 'col-1', tableId: 'tbl-2' }],
  events: [{ id: 'ev-m', kind: 'meeting' as const }, { id: 'ev-e', kind: 'event' as const }],
}

describe('notificationHref', () => {
  it('opens the task itself, not just the board', () => {
    expect(notificationHref({ entity: 'task', entityId: 't1' }, ctx)).toBe('/tasks?task=t1')
  })

  it('resolves CRM rows and columns to their table', () => {
    expect(notificationHref({ entity: 'crm_row', entityId: 'row-1' }, ctx)).toBe('/crm/tbl-1')
    expect(notificationHref({ entity: 'crm_column', entityId: 'col-1' }, ctx)).toBe('/crm/tbl-2')
    expect(notificationHref({ entity: 'crm_row', entityId: 'gone' }, ctx)).toBe('/crm')
  })

  it('sends meetings to Meetings and other events to Calendar', () => {
    expect(notificationHref({ entity: 'event', entityId: 'ev-m' }, ctx)).toBe('/meetings')
    expect(notificationHref({ entity: 'event', entityId: 'ev-e' }, ctx)).toBe('/calendar')
  })

  it('falls back to the notifications page for unknown subjects', () => {
    expect(notificationHref({ entity: undefined, entityId: undefined }, ctx)).toBe('/notifications')
    expect(notificationHref({ entity: 'channel', entityId: 'c1' }, ctx)).toBe('/channels/c1')
  })

  it('opens the lead and the showcase item (033 entities)', () => {
    expect(notificationHref({ entity: 'lead', entityId: 'l1' }, ctx)).toBe('/growth/leads?lead=l1')
    expect(notificationHref({ entity: 'lead', entityId: undefined }, ctx)).toBe('/growth/leads')
    expect(notificationHref({ entity: 'showcase', entityId: 's1' }, ctx)).toBe('/showcase?item=s1')
    expect(notificationHref({ entity: 'showcase', entityId: undefined }, ctx)).toBe('/showcase')
  })
})

describe('preferences', () => {
  it('fills in missing keys from the defaults', () => {
    const p = normalizePrefs({ desktop: false, categories: { workspace: true } })
    expect(p.desktop).toBe(false)
    expect(p.voice).toBe(DEFAULT_NOTIFY_PREFS.voice)
    expect(p.categories.workspace).toBe(true)
    expect(p.categories.mentions).toBe(true)
  })

  it('never speaks about workspace updates or when desktop is off', () => {
    const on = normalizePrefs({ categories: { workspace: true } })
    expect(wantsDesktop(on, 'workspace')).toBe(true)
    expect(wantsVoice(on, 'workspace')).toBe(false)
    expect(wantsVoice(on, 'mentions')).toBe(true)
    const off = normalizePrefs({ desktop: false })
    expect(wantsDesktop(off, 'mentions')).toBe(false)
    expect(wantsVoice(off, 'mentions')).toBe(false)
  })

  it('maps types to categories', () => {
    expect(categoryOf('channel_mention')).toBe('mentions')
    expect(categoryOf('task_assigned')).toBe('tasks')
    expect(categoryOf('due_reminder')).toBe('reminders')
    expect(categoryOf('client_updated')).toBe('workspace')
    for (const t of ['lead_new', 'lead_sla', 'lead_followup', 'lead_assigned'] as const) {
      expect(categoryOf(t), t).toBe('leads')
    }
    expect(categoryOf('showcase_ready')).toBe('workspace')
  })

  it('turns leads on for a stored copy that predates the category', () => {
    const before = normalizePrefs({ categories: { mentions: true, messages: true, tasks: true, reminders: true, workspace: false } })
    expect(before.categories.leads).toBe(true)
    expect(normalizePrefs({ categories: { leads: false } }).categories.leads).toBe(false)
    expect(wantsVoice(before, 'leads')).toBe(true)
  })

  it('has a short spoken line per category', () => {
    expect(spokenLine({ type: 'channel_mention', title: '' }, 'Alex Cruz')).toBe('Boss, Alex Cruz mentioned you')
    expect(spokenLine({ type: 'task_assigned', title: '' }, 'Alex')).toBe('Boss, Alex assigned you a task')
    expect(spokenLine({ type: 'due_reminder', title: '' })).toBe('Boss, you have something due')
    expect(spokenLine({ type: 'lead_new', title: '' })).toBe('Boss, you have a new lead')
    expect(spokenLine({ type: 'lead_assigned', title: '' }, 'Ana')).toBe('Boss, Ana assigned you a lead')
    expect(spokenLine({ type: 'lead_assigned', title: '' })).toBe('Boss, a lead was assigned to you')
    expect(spokenLine({ type: 'lead_sla', title: '' })).toBe('Boss, a lead is waiting for a reply')
    expect(spokenLine({ type: 'lead_followup', title: '' })).toBe('Boss, you have lead follow-ups due')
  })
})
