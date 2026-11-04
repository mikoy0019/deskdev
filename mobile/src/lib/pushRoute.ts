import type { Href } from 'expo-router'

// Where a tapped push lands in the phone app. send-push puts the web app's
// path for the notification in `data.path` (notificationPath in
// supabase/functions/send-push/logic.ts); this maps it to the matching
// screen here. A path this app has no screen for opens Notifications.

/** Ids in a path are uuids; anything else is not routed. */
const ID = /^[A-Za-z0-9_-]{1,64}$/

function id(value: string | null | undefined): string | null {
  return value && ID.test(value) ? value : null
}

export function routeForPushPath(path: unknown): Href {
  if (typeof path !== 'string' || !path.startsWith('/')) return '/notifications'
  const [pathname, query = ''] = path.split('?', 2)
  const params = new URLSearchParams(query)
  const [section, sub] = pathname.split('/').filter(Boolean)
  const subId = id(sub)

  switch (section) {
    case 'messages':
      return subId ? `/messages/${subId}` : '/messages'
    case 'projects':
      return subId ? `/project/${subId}` : '/projects'
    case 'clients':
      return subId ? `/client/${subId}` : '/clients'
    case 'crm':
      return subId ? `/crm/${subId}` : '/crm'
    case 'growth': {
      const lead = id(params.get('lead'))
      return lead ? `/growth/${lead}` : '/growth'
    }
    case 'showcase': {
      const item = id(params.get('item'))
      return item ? `/portfolio/${item}` : '/portfolio'
    }
    case 'tasks':
      return '/tasks'
    case 'meetings':
      return '/meetings'
    case 'calendar':
      return '/calendar'
    default:
      // Channels and the test push: the phone app lists them under Notifications.
      return '/notifications'
  }
}

/** The route for a push's data payload ({ path, notificationId? }). */
export function routeForPush(data: unknown): Href {
  return routeForPushPath((data as { path?: unknown } | null | undefined)?.path)
}

/** The notifications row a push stands in for, to mark read when it's tapped. */
export function pushNotificationId(data: unknown): string | null {
  const value = (data as { notificationId?: unknown } | null | undefined)?.notificationId
  return typeof value === 'string' ? id(value) : null
}

/** Href as the plain path usePathname() reports, for comparing the two. */
export function hrefPath(href: Href): string {
  return typeof href === 'string' ? href : String(href.pathname)
}
