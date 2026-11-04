import { describe, expect, it, vi } from 'vitest'
import { BoardSession } from './boardSession'
import { draftKey, mergeScenes } from './sceneMerge'
import type { WhiteboardScene } from './whiteboardApi'

const shape = (id: string, version = 1, extra = {}) => ({ id, version, versionNonce: 10, ...extra })
const drawing = (...elements: unknown[]): WhiteboardScene => ({ elements })
function server(initial = drawing()) {
  let scene = initial
  let version = 1
  const read = vi.fn(async () => ({ scene, meta: { version, updatedAt: '2026-10-10T00:00:00Z' } }))
  const save = vi.fn(async (expected: number, next: WhiteboardScene) => {
    if (version !== expected) return { ok: false as const, reason: 'conflict' as const, message: 'conflict' }
    scene = structuredClone(next); version++
    return { ok: true as const, version, updatedAt: '2026-10-10T00:00:00Z' }
  })
  const open = () => new BoardSession(initial, 1, { read, save, journal: vi.fn(), receive: vi.fn() })
  return { open, read, save, scene: () => scene }
}

describe('whiteboard collaboration', () => {
  it('journals and saves a live canvas edit even before its change callback', async () => {
    const db = server(); const journal = vi.fn()
    const a = new BoardSession(drawing(), 1, { read: db.read, save: db.save, capture: () => drawing(shape('live')), journal, receive: vi.fn() })
    a.captureLive()
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ elements: [shape('live')] }))
    await a.flush(); expect(db.scene().elements).toContainEqual(shape('live'))
  })
  it('a delayed canvas frame cannot discard a newly received remote shape', async () => {
    const db = server(); const a = db.open(); const b = db.open()
    a.edit(drawing(shape('remote'))); await a.flush(); await b.pull()
    b.edit(drawing(shape('local'))); await b.flush()
    expect(db.scene().elements).toHaveLength(2)
  })
  it('captures unreported live canvas edits before accepting a remote snapshot', async () => {
    const db = server(); const a = db.open()
    a.edit(drawing(shape('remote'))); await a.flush()
    const b = new BoardSession(drawing(), 1, { read: db.read, save: db.save, capture: () => drawing(shape('live')), journal: vi.fn(), receive: vi.fn() })
    await b.pull(); await b.flush()
    expect(db.scene().elements).toHaveLength(2)
  })
  it('uses fractional index byte order and a stable tie break across locales', () => {
    const result = mergeScenes(drawing(shape('b', 1, { index: 'a0' })), drawing(shape('a', 1, { index: 'a0' }), shape('z', 1, { index: 'Zz' })))
    expect(result.elements.map((e) => (e as { id: string }).id)).toEqual(['z', 'a', 'b'])
  })
  it('does not acknowledge in-place drawing mutations made during upload', async () => {
    const db = server(); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const a = new BoardSession(drawing(), 1, { read: db.read, save: async (v, s) => { await gate; return db.save(v, s) }, journal: vi.fn(), receive: vi.fn() })
    const live = shape('a')
    a.edit(drawing(live)); const pending = a.flush()
    live.version = 2
    release(); await pending
    expect(a.dirty).toBe(true)
    expect(db.scene().elements).toContainEqual(shape('a', 1))
    await a.flush(); expect(db.scene().elements).toContainEqual(shape('a', 2))
  })
  it('concurrent editors retain independent shapes and converge after pull', async () => {
    const db = server(); const a = db.open(); const b = db.open()
    a.edit(drawing(shape('a'))); b.edit(drawing(shape('b')))
    await Promise.all([a.flush(), b.flush()]); await a.pull(); await b.pull()
    expect(db.scene().elements).toHaveLength(2)
    expect(a.scene).toEqual(b.scene)
    expect(a.dirty).toBe(false); expect(b.dirty).toBe(false)
  })
  it('keeps deleted elements as tombstones when a stale editor adds a shape', async () => {
    const db = server(drawing(shape('a'))); const a = db.open(); const b = db.open()
    a.edit(drawing(shape('a', 2, { isDeleted: true }))); await a.flush()
    b.edit(drawing(shape('a'), shape('b'))); await b.flush()
    expect(db.scene().elements).toContainEqual(shape('a', 2, { isDeleted: true }))
    expect(db.scene().elements).toContainEqual(shape('b'))
  })
  it('resolves simultaneous changes to one shape deterministically', () => {
    const a = drawing(shape('a', 2, { versionNonce: 50, x: 10 }))
    const b = drawing(shape('a', 2, { versionNonce: 20, x: 30 }))
    expect(mergeScenes(a, b)).toEqual(mergeScenes(b, a))
    expect(mergeScenes(a, b).elements).toEqual(b.elements)
  })
  it('retains images from both editors', () => {
    expect(mergeScenes({ elements: [shape('a')], files: { a: { dataURL: 'a' } } }, { elements: [shape('b')], files: { b: { dataURL: 'b' } } }).files).toEqual({ a: { dataURL: 'a' }, b: { dataURL: 'b' } })
  })
  it('receives remote background changes while preserving a local stroke', async () => {
    const db = server({ elements: [], appState: { viewBackgroundColor: '#fff' } }); const a = db.open(); const b = db.open()
    a.edit({ elements: [], appState: { viewBackgroundColor: '#000' } }); await a.flush()
    b.edit({ elements: [shape('b')], appState: { viewBackgroundColor: '#fff' } }); await b.flush()
    expect(db.scene().appState?.viewBackgroundColor).toBe('#000')
  })
  it('a failed upload retains its journal and retries without a refresh', async () => {
    const journal = vi.fn(); const db = server()
    const save = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'error', message: 'offline' }).mockImplementation(db.save)
    const a = new BoardSession(drawing(), 1, { read: db.read, save, journal, receive: vi.fn() })
    a.edit(drawing(shape('a'))); expect(journal).toHaveBeenLastCalledWith(a.scene)
    expect((await a.flush()).ok).toBe(false); expect(a.dirty).toBe(true)
    expect(journal).not.toHaveBeenCalledWith(null)
    expect((await a.flush()).ok).toBe(true); expect(journal).toHaveBeenLastCalledWith(null)
  })
  it('edits made during an upload remain pending until acknowledged', async () => {
    const db = server(); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const a = new BoardSession(drawing(), 1, { read: db.read, save: async (v, s) => { await gate; return db.save(v, s) }, journal: vi.fn(), receive: vi.fn() })
    a.edit(drawing(shape('a'))); const pending = a.flush()
    a.edit(drawing(shape('a'), shape('b'))); release(); await pending
    expect(a.dirty).toBe(true); await a.flush(); expect(a.dirty).toBe(false)
    expect(db.scene().elements).toHaveLength(2)
  })
  it('merges a recovery copy with newer server work', async () => {
    const db = server(drawing(shape('remote'))); const a = db.open()
    a.recover(drawing(shape('draft'))); await a.flush()
    expect(db.scene().elements).toHaveLength(2)
    expect(draftKey('alice', 'board')).not.toBe(draftKey('bob', 'board'))
  })
  it('repeated save conflicts retain work instead of overwriting the current row', async () => {
    const db = server(); const journal = vi.fn()
    const a = new BoardSession(drawing(), 1, { read: db.read, save: vi.fn(async () => ({ ok: false as const, reason: 'conflict' as const, message: 'busy' })), journal, receive: vi.fn() })
    a.edit(drawing(shape('a')))
    expect((await a.flush()).ok).toBe(false); expect(a.dirty).toBe(true)
    expect(journal).not.toHaveBeenCalledWith(null)
  })
})
