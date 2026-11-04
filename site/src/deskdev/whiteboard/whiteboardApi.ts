import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'

/**
 * The Whiteboard's data (revision 9, migration 059). Kept out of the main
 * store on purpose: a scene can be megabytes (pasted images), so the list
 * reads everything but the scene, and a board's scene is read when it opens.
 * Local mode keeps the same shapes in localStorage.
 */

export interface WhiteboardFolder {
  id: string
  name: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface WhiteboardMeta {
  id: string
  folderId?: string
  title: string
  version: number
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

/** What the editor saves: Excalidraw's elements, files and a little view state. */
export interface WhiteboardScene {
  elements: readonly unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

/** 059's limit on a scene, measured the same way (its JSON text). */
export const MAX_SCENE_BYTES = 5 * 1024 * 1024

export type SaveResult =
  | { ok: true; version: number; updatedAt: string }
  | { ok: false; reason: 'conflict' | 'too-large' | 'error'; message: string }

const META = 'id,folder_id,title,version,created_by,updated_by,created_at,updated_at'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const toMeta = (r: Row): WhiteboardMeta => ({
  id: String(r.id), folderId: str(r.folder_id), title: String(r.title), version: Number(r.version),
  createdBy: str(r.created_by), updatedBy: str(r.updated_by), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
})
const toFolder = (r: Row): WhiteboardFolder => ({
  id: String(r.id), name: String(r.name), createdBy: str(r.created_by), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
})

const me = () => useStore.getState().currentUserId ?? undefined
const fail = (message: string): never => {
  throw new Error(message)
}
const missing = (code?: string) => ['42P01', 'PGRST205', 'PGRST202'].includes(code ?? '')
const notInstalled = 'Whiteboards are not set up on this backend yet (migration 059).'

// ─── Local mode ──────────────────────────────────────────────────────────────

const KEY = 'deskdev-whiteboards:v1'
interface LocalDb { folders: WhiteboardFolder[]; boards: WhiteboardMeta[]; scenes: Record<string, WhiteboardScene> }

function readLocal(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as LocalDb
  } catch {
    /* unreadable: start empty */
  }
  return { folders: [], boards: [], scenes: {} }
}
function writeLocal(db: LocalDb): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    fail('This browser has no room left to keep the board. Remove pasted images or older boards.')
  }
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

// ─── API ─────────────────────────────────────────────────────────────────────

export async function listWhiteboards(): Promise<{ folders: WhiteboardFolder[]; boards: WhiteboardMeta[] }> {
  if (!isSupabaseConfigured) {
    const db = readLocal()
    return { folders: db.folders, boards: db.boards }
  }
  const [f, b] = await Promise.all([
    supabase.from('whiteboard_folders').select('id,name,created_by,created_at,updated_at').order('name'),
    supabase.from('whiteboards').select(META).order('updated_at', { ascending: false }),
  ])
  if (f.error || b.error) fail(missing(f.error?.code) || missing(b.error?.code) ? notInstalled : (f.error ?? b.error)!.message)
  return { folders: (f.data ?? []).map(toFolder), boards: (b.data ?? []).map(toMeta) }
}

export async function openWhiteboard(id: string): Promise<{ meta: WhiteboardMeta; scene: WhiteboardScene } | null> {
  if (!isSupabaseConfigured) {
    const db = readLocal()
    const meta = db.boards.find((b) => b.id === id)
    return meta ? { meta, scene: db.scenes[id] ?? { elements: [] } } : null
  }
  const { data, error } = await supabase.from('whiteboards').select(`${META},scene`).eq('id', id).maybeSingle()
  if (error) fail(missing(error.code) ? notInstalled : error.message)
  if (!data) return null
  return { meta: toMeta(data as Row), scene: ((data as Row).scene as WhiteboardScene) ?? { elements: [] } }
}

export async function createWhiteboard(input: { title: string; folderId?: string }): Promise<WhiteboardMeta> {
  const title = input.title.trim() || 'Untitled board'
  if (title.length > 120) fail('Keep the title under 120 characters.')
  if (!isSupabaseConfigured) {
    const db = readLocal()
    const now = new Date().toISOString()
    const meta: WhiteboardMeta = { id: newId(), folderId: input.folderId, title, version: 1, createdBy: me(), updatedBy: me(), createdAt: now, updatedAt: now }
    db.boards.unshift(meta)
    db.scenes[meta.id] = { elements: [] }
    writeLocal(db)
    return meta
  }
  const { data, error } = await supabase
    .from('whiteboards')
    .insert({ title, folder_id: input.folderId ?? null, created_by: me() ?? null })
    .select(META)
    .single()
  if (error) fail(missing(error.code) ? notInstalled : error.message)
  return toMeta(data as Row)
}

/**
 * Save a scene made on top of `version`. Refused as a conflict when someone
 * saved a newer one meanwhile, instead of quietly replacing their drawing.
 */
export async function saveWhiteboardScene(id: string, version: number, scene: WhiteboardScene): Promise<SaveResult> {
  const text = JSON.stringify(scene)
  if (new Blob([text]).size > MAX_SCENE_BYTES) {
    return { ok: false, reason: 'too-large', message: 'This board is over 5 MB, mostly pasted images. Remove or shrink some to keep saving.' }
  }
  if (!isSupabaseConfigured) {
    try {
      const db = readLocal()
      const meta = db.boards.find((b) => b.id === id)
      if (!meta) return { ok: false, reason: 'error', message: 'This board no longer exists.' }
      if (meta.version !== version) return { ok: false, reason: 'conflict', message: 'This board changed in another tab.' }
      meta.version += 1
      meta.updatedAt = new Date().toISOString()
      meta.updatedBy = me()
      db.scenes[id] = scene
      writeLocal(db)
      return { ok: true, version: meta.version, updatedAt: meta.updatedAt }
    } catch (e) {
      return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'The board could not be saved.' }
    }
  }
  try {
    const { data, error } = await supabase
      .from('whiteboards')
      .update({ scene: JSON.parse(text) })
      .eq('id', id)
      .eq('version', version)
      .select('version,updated_at')
    if (error) return { ok: false, reason: 'error', message: error.message }
    if (!data?.length) return { ok: false, reason: 'conflict', message: 'Someone saved this board after you opened it.' }
    const row = data[0] as Row
    return { ok: true, version: Number(row.version), updatedAt: String(row.updated_at) }
  } catch {
    return { ok: false, reason: 'error', message: 'The board could not be saved. Check your connection; it will try again.' }
  }
}

export async function updateWhiteboard(id: string, patch: { title?: string; folderId?: string | null }): Promise<void> {
  const title = patch.title?.trim()
  if (title !== undefined && (!title || title.length > 120)) fail('Give the board a title of up to 120 characters.')
  if (!isSupabaseConfigured) {
    const db = readLocal()
    const meta = db.boards.find((b) => b.id === id)
    if (!meta) return
    if (title !== undefined) meta.title = title
    if (patch.folderId !== undefined) meta.folderId = patch.folderId ?? undefined
    meta.updatedAt = new Date().toISOString()
    writeLocal(db)
    return
  }
  const row: Row = {}
  if (title !== undefined) row.title = title
  if (patch.folderId !== undefined) row.folder_id = patch.folderId
  const { error } = await supabase.from('whiteboards').update(row).eq('id', id)
  if (error) fail(error.message)
}

export async function deleteWhiteboard(id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const db = readLocal()
    db.boards = db.boards.filter((b) => b.id !== id)
    delete db.scenes[id]
    writeLocal(db)
    return
  }
  const { data, error } = await supabase.from('whiteboards').delete().eq('id', id).select('id')
  if (error) fail(error.message)
  if (!data?.length) fail('Only the person who made this board, or an admin, can delete it.')
}

export async function createWhiteboardFolder(name: string): Promise<WhiteboardFolder> {
  const label = name.trim()
  if (!label || label.length > 80) fail('Give the folder a name of up to 80 characters.')
  if (!isSupabaseConfigured) {
    const db = readLocal()
    const now = new Date().toISOString()
    const folder: WhiteboardFolder = { id: newId(), name: label, createdBy: me(), createdAt: now, updatedAt: now }
    db.folders.push(folder)
    writeLocal(db)
    return folder
  }
  const { data, error } = await supabase
    .from('whiteboard_folders')
    .insert({ name: label, created_by: me() ?? null })
    .select('id,name,created_by,created_at,updated_at')
    .single()
  if (error) fail(missing(error.code) ? notInstalled : error.message)
  return toFolder(data as Row)
}

export async function renameWhiteboardFolder(id: string, name: string): Promise<void> {
  const label = name.trim()
  if (!label || label.length > 80) fail('Give the folder a name of up to 80 characters.')
  if (!isSupabaseConfigured) {
    const db = readLocal()
    const f = db.folders.find((x) => x.id === id)
    if (f) f.name = label
    writeLocal(db)
    return
  }
  const { error } = await supabase.from('whiteboard_folders').update({ name: label }).eq('id', id)
  if (error) fail(error.message)
}

/** Its boards stay, unfiled (059: ON DELETE SET NULL). */
export async function deleteWhiteboardFolder(id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const db = readLocal()
    db.folders = db.folders.filter((f) => f.id !== id)
    for (const b of db.boards) if (b.folderId === id) b.folderId = undefined
    writeLocal(db)
    return
  }
  const { data, error } = await supabase.from('whiteboard_folders').delete().eq('id', id).select('id')
  if (error) fail(error.message)
  if (!data?.length) fail('Only the person who made this folder, or an admin, can delete it.')
}
