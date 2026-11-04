import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

// Revision 8, local mode: recordings filed by client, project and category.

const s = () => useStore.getState()
const rec = (id: string) => s().meetingRecordings.find((r) => r.id === id)!

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ currentUserId: 'u-admin' })
})

describe('meeting recordings', () => {
  it('a project decides the client; a category only holds its own client', () => {
    const folder = s().addRecordingFolder({ clientId: 'cl-northwind', name: 'Reviews' })
    const id = s().addRecording({ title: ' Review ', url: 'https://www.loom.com/share/abc', projectId: 'pr-portal', folderId: folder })
    expect(rec(id)).toMatchObject({ title: 'Review', clientId: 'cl-northwind', projectId: 'pr-portal', folderId: folder })
    s().updateRecording(id, { projectId: undefined, clientId: 'cl-brightloop' })
    expect(rec(id)).toMatchObject({ clientId: 'cl-brightloop', folderId: undefined })
  })

  it('refuses a missing title or a link that is not https', () => {
    expect(() => s().addRecording({ title: '  ', url: 'https://x.test/v' })).toThrow(/title/)
    expect(() => s().addRecording({ title: 'Call', url: 'http://x.test/v' })).toThrow(/https/)
  })

  it('deleting a category leaves its recordings with the client', () => {
    const before = rec('mr-nw-kickoff')
    expect(before.folderId).toBe('rf-nw-kickoffs')
    s().deleteRecordingFolder('rf-nw-kickoffs')
    expect(rec('mr-nw-kickoff')).toMatchObject({ clientId: 'cl-northwind', folderId: undefined })
  })

  it('needs meetings:edit to write', () => {
    useStore.setState((st) => ({ currentUserId: 'u-member', users: st.users.map((u) => (u.id === 'u-member' ? { ...u, permissions: { meetings: 'view' as const } } : u)) }))
    expect(() => s().addRecording({ title: 'Call', url: 'https://x.test/v' })).toThrow(/edit access/)
  })
})
