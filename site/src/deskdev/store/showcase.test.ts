import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import type { PermFeature, PermLevel } from '../lib/types'

// Local mode: the store mirrors 037's rules — showcase:edit drafts, only an
// admin publishes, unpublishes or edits what is live, publishing needs
// consent, and a finished project with a live URL drafts its own item.

const removeShowcaseImages = vi.hoisted(() => vi.fn(async () => {}))
const uploadShowcaseImage = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, imageKey: 'items/new-1280.webp', imageKeySmall: 'items/new-640.webp' })),
)
vi.mock('../lib/showcaseImages', () => ({ removeShowcaseImages, uploadShowcaseImage }))

const s = () => useStore.getState()
const item = (id: string) => s().showcaseItems.find((i) => i.id === id)
/** A seed project no showcase item points at yet. */
const freeProject = () => s().projects.find((p) => !s().showcaseItems.some((i) => i.projectId === p.id))!

function actAs(id: string, permissions?: Partial<Record<PermFeature, PermLevel>>) {
  if (permissions) {
    useStore.setState((st) => ({ users: st.users.map((u) => (u.id === id ? { ...u, permissions } : u)) }))
  }
  useStore.setState({ currentUserId: id })
}

beforeEach(() => {
  s().resetSeed()
  removeShowcaseImages.mockClear()
  uploadShowcaseImage.mockClear()
  actAs('u-admin')
})

describe('addShowcaseItem', () => {
  it('needs showcase:edit', () => {
    actAs('u-member', { showcase: 'view' })
    expect(s().addShowcaseItem({ title: 'Acme' })).toBeNull()
    actAs('u-member', { showcase: 'edit' })
    expect(s().addShowcaseItem({ title: 'Acme' })).not.toBeNull()
  })

  it('never starts published, and fills the defaults', () => {
    const id = s().addShowcaseItem({ title: 'Acme Dental', status: 'published', consent: 'granted', url: 'https://acme.io' })!
    expect(item(id)).toMatchObject({
      status: 'draft', slug: 'acme-dental', kind: 'website', linkPublic: true, publicUrl: 'https://acme.io',
      stack: [], featured: false, linkStatus: 'unknown', createdBy: 'u-admin',
    })
    expect(item(id)!.consentAt).toBeDefined()
    expect(item(id)!.publishedAt).toBeUndefined()
  })

  it('makes slugs unique and drops a non-https link', () => {
    const a = s().addShowcaseItem({ title: 'Acme' })!
    const b = s().addShowcaseItem({ title: 'Acme', url: 'http://acme.io' })!
    expect(item(a)!.slug).toBe('acme')
    expect(item(b)!.slug).toBe('acme-2')
    expect(item(b)!.url).toBeUndefined()
  })

  it('allows one item per project', () => {
    const project = freeProject()
    expect(s().addShowcaseItem({ title: 'One', projectId: project.id })).not.toBeNull()
    expect(s().addShowcaseItem({ title: 'Two', projectId: project.id })).toBeNull()
  })
})

describe('status and editing rules', () => {
  it('an editor can ready an item but not publish it', () => {
    const id = s().addShowcaseItem({ title: 'Acme', consent: 'granted' })!
    actAs('u-member', { showcase: 'edit' })
    expect(s().setShowcaseStatus(id, 'ready')).toEqual({ ok: true })
    expect(s().setShowcaseStatus(id, 'published').ok).toBe(false)
    expect(item(id)!.status).toBe('ready')
  })

  it('an admin publishes with consent, stamping who and when, and it is audited', () => {
    const id = s().addShowcaseItem({ title: 'Acme', consent: 'granted', url: 'https://acme.io' })!
    expect(s().setShowcaseStatus(id, 'published')).toEqual({ ok: true })
    expect(item(id)).toMatchObject({ status: 'published', publishedBy: 'u-admin' })
    expect(item(id)!.publishedAt).toBeDefined()
    expect(s().auditLog[0]).toMatchObject({ action: 'showcase.published', entity: 'showcase', entityId: id })
  })

  it('publishing without consent is refused', () => {
    const id = s().addShowcaseItem({ title: 'Acme' })!
    const res = s().setShowcaseStatus(id, 'published')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/consent/)
  })

  it('consent cannot be edited away from a published item', () => {
    const id = s().addShowcaseItem({ title: 'Acme', consent: 'granted' })!
    s().setShowcaseStatus(id, 'published')
    expect(s().updateShowcaseItem(id, { consent: 'declined' })).toBe(false)
    expect(item(id)!.consent).toBe('granted')
  })

  it('a member cannot edit or delete a live item; an admin can take it down', () => {
    const id = s().addShowcaseItem({ title: 'Acme', consent: 'legacy' })!
    s().setShowcaseStatus(id, 'published')
    actAs('u-member', { showcase: 'edit' })
    expect(s().updateShowcaseItem(id, { summary: 'Changed' })).toBe(false)
    expect(s().deleteShowcaseItem(id)).toBe(false)
    actAs('u-admin')
    expect(s().setShowcaseStatus(id, 'hidden')).toEqual({ ok: true })
    expect(s().auditLog[0]).toMatchObject({ action: 'showcase.unpublished' })
  })

  it('ignores server-owned fields in a patch and re-derives publicUrl', () => {
    const id = s().addShowcaseItem({ title: 'Acme', url: 'https://acme.io' })!
    s().updateShowcaseItem(id, { linkPublic: false, createdBy: 'someone-else' } as never)
    expect(item(id)).toMatchObject({ linkPublic: false, createdBy: 'u-admin' })
    expect(item(id)!.publicUrl).toBeUndefined()
  })

  it('refuses a non-https link and keeps slugs unique on edit', () => {
    const a = s().addShowcaseItem({ title: 'Acme' })!
    const b = s().addShowcaseItem({ title: 'Other' })!
    expect(s().updateShowcaseItem(a, { url: 'ftp://acme.io' })).toBe(false)
    s().updateShowcaseItem(b, { slug: 'acme' })
    expect(item(b)!.slug).toBe('acme-2')
  })
})

describe('images', () => {
  it('uploads, attaches and cleans up the replaced screenshot', async () => {
    const id = s().addShowcaseItem({ title: 'Acme', imageKey: 'items/old-1280.webp', imageKeySmall: 'items/old-640.webp' })!
    const res = await s().setShowcaseImage(id, new Blob(['x'], { type: 'image/png' }), 'Home page')
    expect(res).toEqual({ ok: true })
    expect(item(id)).toMatchObject({ imageKey: 'items/new-1280.webp', imageKeySmall: 'items/new-640.webp', imageSource: 'upload', imageAlt: 'Home page' })
    expect(removeShowcaseImages).toHaveBeenCalledWith(['items/old-1280.webp', 'items/old-640.webp'])
  })

  it('deleting an item takes its unshared screenshots with it', async () => {
    const a = s().addShowcaseItem({ title: 'A', imageKey: 'items/shared.webp', imageKeySmall: 'items/a-small.webp' })!
    s().addShowcaseItem({ title: 'B', imageKey: 'items/shared.webp' })
    expect(s().deleteShowcaseItem(a)).toBe(true)
    await vi.waitFor(() => expect(removeShowcaseImages).toHaveBeenCalledWith(['items/a-small.webp']))
  })

  it('needs edit access to upload', async () => {
    const id = s().addShowcaseItem({ title: 'Acme' })!
    actAs('u-member', { showcase: 'view' })
    expect((await s().setShowcaseImage(id, new Blob(['x'], { type: 'image/png' }))).ok).toBe(false)
    expect(uploadShowcaseImage).not.toHaveBeenCalled()
  })
})

describe('a finished project drafts its showcase item (stand-in for showcase_on_project)', () => {
  function finishProject(consent?: 'granted' | 'declined') {
    const project = freeProject()
    if (consent) s().updateClient(project.clientId, { showcaseConsent: consent })
    // Done comes from launching ("Development done"), never from a plain move.
    expect(s().setProjectPhase(project.id, 'launched', { liveUrl: 'https://client.example' })).toEqual({ ok: true })
    return project
  }

  it('drafts once, named for the client, and tells the other admins', () => {
    useStore.setState((st) => ({
      users: [...st.users, { ...st.users[0], id: 'u-admin-2', email: 'two@deskdev.local', fullName: 'Second Admin' }],
    }))
    const project = finishProject()
    const drafted = s().showcaseItems.filter((i) => i.projectId === project.id)
    expect(drafted).toHaveLength(1)
    const client = s().clients.find((c) => c.id === project.clientId)!
    expect(drafted[0]).toMatchObject({
      status: 'draft', consent: 'unknown', url: 'https://client.example', title: client.company?.trim() || client.name,
    })
    const note = s().notifications.find((n) => n.type === 'showcase_ready')!
    expect(note).toMatchObject({ userId: 'u-admin-2', actorId: 'u-admin', entity: 'showcase', entityId: drafted[0].id })
    s().updateProject(project.id, { notes: 'again' })
    expect(s().showcaseItems.filter((i) => i.projectId === project.id)).toHaveLength(1)
  })

  it('files a declined client’s work as hidden', () => {
    const project = finishProject('declined')
    expect(s().showcaseItems.find((i) => i.projectId === project.id)!.status).toBe('hidden')
  })

  it('never publishes by itself: consent plus the switch files it as ready for the link check', () => {
    s().updateWorkspaceSettings({ showcaseAutoPublish: true })
    const project = finishProject('granted')
    expect(s().showcaseItems.find((i) => i.projectId === project.id)).toMatchObject({ status: 'ready', consent: 'granted' })
  })

  it('only an admin can change a client’s showcase consent', () => {
    const project = freeProject()
    actAs('u-member', { clients: 'edit' })
    s().updateClient(project.clientId, { showcaseConsent: 'granted', notes: 'kept' })
    const client = s().clients.find((c) => c.id === project.clientId)!
    expect(client.showcaseConsent).not.toBe('granted')
    expect(client.notes).toBe('kept')
    // A new client with consent already recorded: the client is added, the consent is not.
    const added = s().addClient({ name: 'New Co', showcaseConsent: 'granted' })
    expect(s().clients.find((c) => c.id === added)).toMatchObject({ name: 'New Co' })
    expect(s().clients.find((c) => c.id === added)!.showcaseConsent).toBeUndefined()
    actAs('u-admin')
    const byAdmin = s().addClient({ name: 'Consenting Co', showcaseConsent: 'granted' })
    expect(s().clients.find((c) => c.id === byAdmin)!.showcaseConsent).toBe('granted')
  })

  it('needs a live URL', () => {
    const project = freeProject()
    expect(s().setProjectPhase(project.id, 'launched')).toEqual({ ok: true })
    expect(s().showcaseItems.some((i) => i.projectId === project.id)).toBe(false)
  })
})
