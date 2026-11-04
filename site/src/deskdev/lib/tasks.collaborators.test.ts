import { describe, expect, it } from 'vitest'
import { cleanCollaborators, taskPeople } from './tasks'

describe('cleanCollaborators', () => {
  it('keeps each person once, in the order added, never the assignee', () => {
    expect(cleanCollaborators(['b', 'a', 'b', 'c', 'a'], 'c')).toEqual(['b', 'a'])
    expect(cleanCollaborators(undefined)).toEqual([])
    expect(cleanCollaborators(['', 'a'])).toEqual(['a'])
  })
})

describe('taskPeople', () => {
  it('lists the assignee first, then the collaborators', () => {
    expect(taskPeople({ assigneeId: 'a', collaboratorIds: ['b', 'a', 'c'] })).toEqual(['a', 'b', 'c'])
    expect(taskPeople({ collaboratorIds: ['b'] })).toEqual(['b'])
    expect(taskPeople({})).toEqual([])
  })
})
