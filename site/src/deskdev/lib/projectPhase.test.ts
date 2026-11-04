import { describe, expect, it } from 'vitest'
import { statusConflict, statusesFor } from './projectPhase'

describe('statusesFor', () => {
  it('keeps Done for launched projects only', () => {
    expect(statusesFor({ phase: 'onboarding', status: 'backlog' })).toEqual(['backlog', 'planning', 'in_progress', 'waiting'])
    expect(statusesFor({ phase: 'development', status: 'in_progress' })).toEqual(['backlog', 'planning', 'in_progress', 'waiting'])
    expect(statusesFor({ phase: 'launched', status: 'done' })).toEqual(['done'])
  })

  it('reads the stage of a row without a phase (a database before 046) from its status', () => {
    expect(statusConflict({ status: 'done' }, 'done')).toBeNull()
    expect(statusConflict({ status: 'in_progress' }, 'waiting')).toBeNull()
  })
})
