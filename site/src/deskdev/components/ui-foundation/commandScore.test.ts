import { describe, expect, it } from 'vitest'
import { scoreCommand } from './commandScore'

const rank = (query: string, commands: { label: string; keywords?: string }[]): string[] =>
  commands
    .map((c) => ({ c, s: scoreCommand(query, c.label, c.keywords) }))
    .filter((x): x is { c: (typeof commands)[number]; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c.label)

const COMMANDS = [
  { label: 'Home', keywords: 'dashboard overview' },
  { label: 'Projects', keywords: 'list pipeline' },
  { label: 'Tasks', keywords: 'todo kanban' },
  { label: 'CRM Leads', keywords: 'growth leads pipeline sales crm' },
  { label: '#announcements', keywords: 'channel Company-wide updates, compact and to the point' },
  { label: '#general', keywords: 'channel' },
  { label: 'New task', keywords: 'add create todo' },
  { label: 'Switch to dark theme', keywords: 'theme dark light appearance mode' },
  { label: 'Compact density', keywords: 'density compact comfortable spacing rows' },
  { label: 'Log out', keywords: 'sign out exit' },
]

describe('scoreCommand', () => {
  it('matches everything on an empty query', () => {
    expect(scoreCommand('', 'Home')).toBe(0)
    expect(scoreCommand('   ', 'Home')).toBe(0)
  })

  it('puts a label match ahead of a keyword match', () => {
    expect(rank('compact', COMMANDS)[0]).toBe('Compact density')
    expect(rank('tasks', COMMANDS)[0]).toBe('Tasks')
    expect(rank('dark', COMMANDS)[0]).toBe('Switch to dark theme')
  })

  it('does not match a keyword in the middle of a word', () => {
    // "act" sits inside "compact" in the keywords: not a word start.
    expect(scoreCommand('act', 'Row spacing', 'density compact')).toBeNull()
    expect(scoreCommand('line', 'Projects', 'list pipeline')).toBeNull()
  })

  it('matches keywords by the start of a word', () => {
    expect(rank('dash', COMMANDS)).toEqual(['Home'])
    expect(rank('sign out', COMMANDS)).toEqual(['Log out'])
    expect(rank('growth leads', COMMANDS)).toEqual(['CRM Leads'])
  })

  it('finds a channel by name with or without the hash', () => {
    expect(rank('#gen', COMMANDS)).toEqual(['#general'])
    expect(rank('gen', COMMANDS)).toEqual(['#general'])
  })

  it('tolerates a dropped letter in the label only', () => {
    expect(rank('prjcts', COMMANDS)).toEqual(['Projects'])
    // The same letters scattered over label + keywords no longer match.
    expect(scoreCommand('cmpt', '#announcements', 'channel compact')).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(scoreCommand('zzz', 'Home', 'dashboard')).toBeNull()
  })
})
