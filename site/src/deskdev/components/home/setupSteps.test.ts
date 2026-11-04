import { describe, expect, it } from 'vitest'
import {
  guideStorageKey, guideView, isEstablished, parseGuideMemory, setupProgress, setupSteps,
  type SetupFacts,
} from './setupSteps'

const EMPTY: SetupFacts = { clients: 0, projects: 0, activePeople: 1, leadOwners: 0, installedHere: false }
const FULL: SetupFacts = { clients: 3, projects: 5, activePeople: 4, leadOwners: 2, installedHere: true }

const doneIds = (facts: SetupFacts, memory = {}) =>
  setupSteps(facts, memory).filter((s) => s.done).map((s) => s.id)

describe('setupSteps', () => {
  it('lists the five steps in order, each with where it is done', () => {
    expect(setupSteps(EMPTY).map((s) => [s.id, s.to])).toEqual([
      ['client', '/clients'],
      ['project', '/projects'],
      ['team', '/settings?section=users'],
      ['leads', '/settings?section=growth'],
      ['install', '/install'],
    ])
  })

  it('has nothing done in an empty workspace', () => {
    expect(doneIds(EMPTY)).toEqual([])
    expect(setupProgress(setupSteps(EMPTY))).toBe('0 of 5')
  })

  it('ticks each step from what the workspace holds', () => {
    expect(doneIds({ ...EMPTY, clients: 1 })).toEqual(['client'])
    expect(doneIds({ ...EMPTY, projects: 1 })).toEqual(['project'])
    expect(doneIds({ ...EMPTY, leadOwners: 1 })).toEqual(['leads'])
    expect(doneIds({ ...EMPTY, installedHere: true })).toEqual(['install'])
    expect(setupProgress(setupSteps({ ...EMPTY, clients: 1, projects: 2 }))).toBe('2 of 5')
  })

  it('needs a second active person for the team step', () => {
    expect(doneIds({ ...EMPTY, activePeople: 1 })).toEqual([])
    expect(doneIds({ ...EMPTY, activePeople: 2 })).toEqual(['team'])
  })

  it('takes the install step from the device or from the hand tick, nothing else', () => {
    expect(doneIds(EMPTY, { installDone: true })).toEqual(['install'])
    // The hand tick is for the install step only.
    expect(doneIds(EMPTY, { started: true, hidden: true, finished: true })).toEqual([])
  })
})

describe('guideView', () => {
  it('shows the steps to an admin in an empty workspace', () => {
    expect(guideView(true, EMPTY, {})).toBe('steps')
  })

  it('never shows to a member', () => {
    expect(guideView(false, EMPTY, {})).toBe('none')
    expect(guideView(false, FULL, { started: true })).toBe('none')
  })

  it('never shows in a workspace that is already in use', () => {
    const inUse: SetupFacts = { ...EMPTY, clients: 2, projects: 1, activePeople: 2 }
    expect(isEstablished(inUse)).toBe(true)
    expect(guideView(true, inUse, {})).toBe('none')
    expect(guideView(true, FULL, {})).toBe('none')
  })

  it('still shows while clients, projects or people are missing', () => {
    expect(guideView(true, { ...FULL, clients: 0 }, {})).toBe('steps')
    expect(guideView(true, { ...FULL, projects: 0 }, {})).toBe('steps')
    expect(guideView(true, { ...FULL, activePeople: 1 }, {})).toBe('steps')
  })

  it('stays through the remaining steps once it has started', () => {
    const midway: SetupFacts = { ...EMPTY, clients: 1, projects: 1, activePeople: 2 }
    expect(guideView(true, midway, { started: true })).toBe('steps')
  })

  it('says "set up" once every step is done, then goes away for good', () => {
    expect(guideView(true, FULL, { started: true })).toBe('done')
    expect(guideView(true, { ...FULL, installedHere: false }, { started: true, installDone: true })).toBe('done')
    expect(guideView(true, FULL, { started: true, finished: true })).toBe('none')
  })

  it('stays away after it was hidden', () => {
    expect(guideView(true, EMPTY, { started: true, hidden: true })).toBe('none')
    expect(guideView(true, FULL, { started: true, hidden: true })).toBe('none')
  })
})

describe('parseGuideMemory', () => {
  it('reads what was stored', () => {
    expect(parseGuideMemory('{"started":true,"installDone":true}')).toEqual({ started: true, installDone: true })
  })

  it('treats anything unreadable as empty', () => {
    expect(parseGuideMemory(null)).toEqual({})
    expect(parseGuideMemory('')).toEqual({})
    expect(parseGuideMemory('not json')).toEqual({})
    expect(parseGuideMemory('"hidden"')).toEqual({})
    expect(parseGuideMemory('{"hidden":"yes","started":1}')).toEqual({})
  })

  it('keeps one memory per person', () => {
    expect(guideStorageKey('u-1')).not.toBe(guideStorageKey('u-2'))
  })
})
