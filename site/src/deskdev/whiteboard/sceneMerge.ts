import type { WhiteboardScene } from './whiteboardApi'

type Element = { id: string; version: number; versionNonce: number; index?: string; isDeleted?: boolean }
const element = (value: unknown): value is Element => !!value && typeof value === 'object' &&
  typeof (value as Element).id === 'string' && typeof (value as Element).version === 'number'

/** Excalidraw version/nonce ordering, including tombstones: absence is never a deletion. */
export function mergeScenes(local: WhiteboardScene, remote: WhiteboardScene, base?: WhiteboardScene): WhiteboardScene {
  const byId = new Map<string, Element>()
  for (const next of [...remote.elements, ...local.elements]) {
    if (!element(next)) continue
    const previous = byId.get(next.id)
    if (!previous || next.version > previous.version ||
      (next.version === previous.version && (next.versionNonce ?? 0) < (previous.versionNonce ?? 0))) byId.set(next.id, next)
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  const elements = [...byId.values()].sort((a, b) => compare(a.index ?? a.id, b.index ?? b.id) || compare(a.id, b.id))
  const appState = { ...remote.appState }
  for (const [key, value] of Object.entries(local.appState ?? {})) {
    if (!base || JSON.stringify(value) !== JSON.stringify(base.appState?.[key])) appState[key] = value
  }
  return { elements, appState, files: { ...remote.files, ...local.files } }
}

export function sceneFingerprint(scene: WhiteboardScene): string {
  return JSON.stringify([scene.elements, scene.appState ?? {}, scene.files ?? {}])
}

/** Recovery is scoped to both the signed-in account and board. Never discard an unacknowledged draft. */
export function draftKey(userId: string, boardId: string): string {
  return `deskdev-whiteboard-draft:v1:${userId}:${boardId}`
}
