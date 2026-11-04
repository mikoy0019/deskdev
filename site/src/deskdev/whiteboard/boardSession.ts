import { mergeScenes, sceneFingerprint } from './sceneMerge'
import type { SaveResult, WhiteboardScene } from './whiteboardApi'

type Snapshot = { scene: WhiteboardScene; meta: { version: number; updatedAt: string } }
type Adapter = {
  read: () => Promise<Snapshot | null>
  save: (version: number, scene: WhiteboardScene) => Promise<SaveResult>
  journal: (scene: WhiteboardScene | null) => void
  receive: (scene: WhiteboardScene) => void
  capture?: () => WhiteboardScene | undefined
}

/** One writer per editor; concurrent saves retry against the latest row, never overwrite it. */
export class BoardSession {
  scene: WhiteboardScene
  private saved: string
  private version: number
  private base: WhiteboardScene
  private running: Promise<SaveResult> | null = null
  private disposed = false
  constructor(scene: WhiteboardScene, version: number, private adapter: Adapter) {
    this.scene = scene
    this.saved = sceneFingerprint(scene)
    this.version = version
    this.base = structuredClone(scene)
  }
  get dirty() { return sceneFingerprint(this.scene) !== this.saved }
  edit(scene: WhiteboardScene) {
    // A delayed canvas callback can describe the frame before a remote merge.
    // Keep unseen remote elements; explicit deletion tombstones still win.
    this.scene = mergeScenes(scene, this.scene, this.base)
    if (this.dirty) this.adapter.journal(this.scene)
  }
  recover(scene: WhiteboardScene) {
    this.edit(mergeScenes(scene, this.scene))
    this.adapter.receive(this.scene)
  }
  captureLive() {
    const live = this.adapter.capture?.()
    if (live) this.edit(live)
  }
  async pull() {
    if (this.running || this.disposed) return
    const remote = await this.adapter.read()
    if (this.disposed || this.running || !remote || remote.meta.version < this.version) return
    this.accept(remote)
  }
  private accept(remote: Snapshot) {
    this.captureLive()
    this.scene = this.dirty ? mergeScenes(this.scene, remote.scene, this.base) : remote.scene
    this.version = remote.meta.version
    this.saved = sceneFingerprint(remote.scene)
    this.base = structuredClone(remote.scene)
    this.adapter.journal(this.dirty ? this.scene : null)
    this.adapter.receive(this.scene)
  }
  flush(): Promise<SaveResult> {
    this.captureLive()
    if (this.running) return this.running
    this.running = this.write().finally(() => { this.running = null })
    return this.running
  }
  private async write(): Promise<SaveResult> {
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!this.dirty) return { ok: true, version: this.version, updatedAt: new Date().toISOString() }
        // The drawing library may mutate a live element during an upload.
        // Only acknowledge the bytes that this request actually submitted.
        const snapshot = structuredClone(this.scene)
        const result = await this.adapter.save(this.version, snapshot)
        if (result.ok) {
          this.version = result.version
          this.saved = sceneFingerprint(snapshot)
          this.base = snapshot
          this.adapter.journal(this.dirty ? this.scene : null)
          return result
        }
        if (result.reason !== 'conflict') return result
        const remote = await this.adapter.read()
        if (!remote) return { ok: false, reason: 'error', message: 'This board is unavailable. Your drawing is kept on this device.' }
        this.accept(remote)
      }
      return { ok: false, reason: 'error', message: 'Other edits are arriving. Your drawing is kept; saving will retry.' }
    } catch {
      return { ok: false, reason: 'error', message: 'Connection interrupted. Your drawing is kept; saving will retry.' }
    }
  }
  dispose() { this.disposed = true }
}
