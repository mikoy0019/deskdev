import { Tabs } from 'expo-router'
import { View } from 'react-native'

import { BlurTarget, useBlurTarget } from '@/components/glass'
import { FloatingTabBar } from '@/components/FloatingTabBar'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { useTheme } from '@/lib/theme'

export default function TabsLayout() {
  const p = useTheme()
  const { user } = useSession()
  const blurTarget = useBlurTarget()

  const hide = (feature: 'projects' | 'tasks' | 'calendar') =>
    can(user, feature, 'view') ? undefined : null

  return (
    <View style={{ flex: 1, backgroundColor: p.page }}>
      {/* The tab bar must be a SIBLING of the content it blurs, not a child of
          it — Android's BlurView samples a BlurTargetView beside it, and nesting
          the two makes it sample a frame containing itself (result: no blur).
          So the navigator renders no tab bar of its own; ours is overlaid below.
          Permissions still live on the screens via `href`, which keeps the routes
          themselves unreachable — the bar just mirrors that with `feature`. */}
      <BlurTarget targetRef={blurTarget}>
        <Tabs
          tabBar={() => null}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: p.page } }}
        >
          <Tabs.Screen name="index" options={{ title: 'Home' }} />
          <Tabs.Screen name="projects" options={{ title: 'Projects', href: hide('projects') }} />
          <Tabs.Screen name="tasks" options={{ title: 'Tasks', href: hide('tasks') }} />
          <Tabs.Screen name="calendar" options={{ title: 'Calendar', href: hide('calendar') }} />
          <Tabs.Screen name="more" options={{ title: 'More' }} />
        </Tabs>
      </BlurTarget>

      <FloatingTabBar blurTarget={blurTarget} />
    </View>
  )
}
