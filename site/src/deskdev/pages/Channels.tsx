import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { HashIcon, PlusIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import ChannelList from '../components/channels/ChannelList'
import ChannelRoom, { RoomSkeleton } from '../components/channels/ChannelRoom'
import ChannelFormModal from '../components/channels/ChannelFormModal'
import { EmptyState } from '../components/ui-foundation'
import { useChannelBadge } from '../components/channels/useChannelBadge'
import { useStore, useCurrentUser } from '../store/useStore'
import { useIsPhone } from '../pwa/useMediaQuery'
import { classNames } from '../lib/format'
import { channelTree, inSpace, spaceOf, STUDIO_SPACE } from '../lib/channels'
import type { Channel } from '../lib/types'

const LAST_KEY = 'deskdev-last-channel'

function readLast(space: string): string | null {
  try {
    return localStorage.getItem(`${LAST_KEY}:${space}`)
  } catch {
    return null
  }
}

/**
 * Discord-style channels. A space (the studio, or one client — picked from
 * the rail) owns categories and channels; the list on the left shows the open
 * space, the room on the right shows the open channel.
 *
 * On narrow screens the route decides the pane — /channels shows the list,
 * /channels/:id the room. On desktop /channels reopens the space's last channel.
 */
export default function Channels() {
  const { id: activeId } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isPhone = useIsPhone()
  const me = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const clients = useStore((s) => s.clients)
  const categories = useStore((s) => s.channelCategories)
  const channels = useStore((s) => s.channels)
  const { unreadChannels, mentions } = useChannelBadge()

  const [form, setForm] = useState<{ open: boolean; channel?: Channel; categoryId?: string }>({ open: false })

  // The open channel decides the space; otherwise the rail's ?space=; a
  // client that no longer exists falls back to the studio.
  const activeChannel = activeId ? channels.find((c) => c.id === activeId) : undefined
  const requested = params.get('space')
  const space = activeChannel
    ? spaceOf(activeChannel)
    : requested && (requested === STUDIO_SPACE || clients.some((c) => c.id === requested))
      ? requested
      : STUDIO_SPACE
  const client = space === STUDIO_SPACE ? undefined : clients.find((c) => c.id === space)

  const firstVisible = useMemo(
    () => channelTree(inSpace(categories, space), inSpace(channels, space), me).flatMap((g) => g.channels)[0],
    [categories, channels, me, space],
  )

  // Palette/deep link: /channels?new=1 opens the create dialog (during render
  // — the flag is URL state), then the effect strips the flag.
  const newFlag = params.get('new') === '1'
  const [newSeen, setNewSeen] = useState(false)
  if (newFlag !== newSeen) {
    setNewSeen(newFlag)
    if (newFlag) setForm({ open: true })
  }
  useEffect(() => {
    if (!newFlag) return
    const next = new URLSearchParams(params)
    next.delete('new')
    setParams(next, { replace: true })
  }, [newFlag, params, setParams])

  // Desktop has room for both panes — never show an empty room when the space
  // has a channel. Live, so rotating a phone into the desktop layout fills it.
  useEffect(() => {
    if (activeId || isPhone) return
    const last = readLast(space)
    const target = channels.some((c) => c.id === last && spaceOf(c) === space) ? last : firstVisible?.id
    if (target) navigate(`/channels/${target}`, { replace: true })
  }, [activeId, channels, firstVisible, isPhone, navigate, space])

  useEffect(() => {
    if (!activeChannel) return
    try {
      localStorage.setItem(`${LAST_KEY}:${spaceOf(activeChannel)}`, activeChannel.id)
    } catch {
      /* per-viewer convenience only */
    }
  }, [activeChannel])

  const subtitle =
    mentions > 0
      ? `${mentions.toLocaleString()} mention${mentions === 1 ? '' : 's'}`
      : unreadChannels > 0
        ? `${unreadChannels.toLocaleString()} channel${unreadChannels === 1 ? '' : 's'} with new messages`
        : client
          ? `${client.name} · channels for this client`
          : 'Team rooms for every topic'

  const switchSpace = (next: string) => navigate(`/channels?space=${next}`)

  // Opening a room from the list marks the entry, so the room's back button
  // can retrace it (keeping the list's scroll) instead of stacking a new list
  // on top. A deep link or notification has no list behind it: replace.
  const openRoom = (id: string) => navigate(`/channels/${id}`, { state: { fromList: true } })
  const backToList = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1)
    else navigate(`/channels?space=${space}`, { replace: true })
  }

  return (
    <Layout title="Channels" subtitle={subtitle} bare immersive={Boolean(activeId)}>
      <div className="h-full flex min-h-0">
        <aside
          className={classNames(
            'w-full md:w-64 shrink-0 border-r border-ink-600 flex-col min-h-0 bg-ink-850/40',
            activeId ? 'hidden md:flex' : 'flex',
          )}
          aria-label="Channels"
        >
          <ChannelList
            space={space}
            activeId={activeId}
            onOpen={openRoom}
            onSwitchSpace={switchSpace}
            onCreateChannel={(categoryId) => setForm({ open: true, categoryId })}
            onEditChannel={(channel) => setForm({ open: true, channel })}
          />
        </aside>

        <section className={classNames('flex-1 min-w-0 min-h-0', activeId ? 'flex flex-col' : 'hidden md:flex md:flex-col')}>
          {activeId ? (
            <ChannelRoom
              key={activeId}
              channelId={activeId}
              onBack={backToList}
              onEdit={(channel) => setForm({ open: true, channel })}
            />
          ) : !hydrated ? (
            // Desktop opens the space's last room once the first pull lands.
            <RoomSkeleton />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <EmptyState
                className="max-w-sm w-full"
                icon={HashIcon}
                title={client ? `No channels for ${client.name} yet` : 'No channels yet'}
                description={
                  client
                    ? 'Give this client its own rooms — updates, deliverables, invoices — and keep every thread in one place.'
                    : 'Channels are shared rooms for a topic, a client or a team. Create the first one.'
                }
                action={
                  <button className="btn-primary" onClick={() => setForm({ open: true })}>
                    <PlusIcon size={14} aria-hidden /> Create channel
                  </button>
                }
              />
            </div>
          )}
        </section>
      </div>

      <ChannelFormModal
        open={form.open}
        channel={form.channel}
        clientId={client?.id}
        defaultCategoryId={form.categoryId}
        onClose={() => setForm({ open: false })}
        onSaved={(id) => navigate(`/channels/${id}`)}
        onDeleted={() => navigate(`/channels?space=${space}`, { replace: true })}
      />
    </Layout>
  )
}

