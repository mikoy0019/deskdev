import { describe, expect, it, vi } from 'vitest'
import { ChunkLoadError, importWithRetry, isChunkLoadFailure } from './lazyPage'

const fetchFailure = () => new TypeError('Failed to fetch dynamically imported module: /assets/Showcase-abc.js')

describe('isChunkLoadFailure', () => {
  it('recognises a failed module fetch in each browser', () => {
    expect(isChunkLoadFailure(fetchFailure(), true)).toBe(true)
    expect(isChunkLoadFailure(new TypeError('Importing a module script failed.'), true)).toBe(true)
    expect(isChunkLoadFailure(new TypeError('error loading dynamically imported module'), true)).toBe(true)
    expect(isChunkLoadFailure(new ChunkLoadError(), true)).toBe(true)
  })

  it('treats any import failure while offline as a load failure', () => {
    expect(isChunkLoadFailure(new Error('anything'), false)).toBe(true)
  })

  it('leaves an error thrown by the module itself alone', () => {
    expect(isChunkLoadFailure(new ReferenceError('x is not defined'), true)).toBe(false)
  })
})

describe('importWithRetry', () => {
  const online = () => true

  it('returns the module when the first try works', async () => {
    const load = vi.fn().mockResolvedValue({ default: 'page' })
    await expect(importWithRetry(load, { delayMs: 0, online })).resolves.toEqual({ default: 'page' })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('tries once more after a failed fetch', async () => {
    const load = vi.fn().mockRejectedValueOnce(fetchFailure()).mockResolvedValue({ default: 'page' })
    await expect(importWithRetry(load, { delayMs: 0, online })).resolves.toEqual({ default: 'page' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('rejects with ChunkLoadError when the retry fails too', async () => {
    const cause = fetchFailure()
    const load = vi.fn().mockRejectedValue(cause)
    const failure = await importWithRetry(load, { delayMs: 0, online }).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(ChunkLoadError)
    expect((failure as ChunkLoadError).cause).toBe(cause)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('passes a module error through without retrying', async () => {
    const bug = new ReferenceError('x is not defined')
    const load = vi.fn().mockRejectedValue(bug)
    await expect(importWithRetry(load, { delayMs: 0, online })).rejects.toBe(bug)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
