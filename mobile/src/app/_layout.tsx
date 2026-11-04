import 'react-native-url-polyfill/auto'

import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as ScreenOrientation from 'expo-screen-orientation'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'
import {
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk'
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono'
import { ActivityIndicator, Platform, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import PushBridge from '@/components/PushBridge'
import { SessionProvider, useSession } from '@/context/session-context'
import { useResponsive } from '@/lib/responsive'
import { fonts, useIsDark, useTheme } from '@/lib/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * app.json allows every orientation so a tablet can rotate; a phone is held
 * to portrait here, at launch (a phone in landscape would squeeze the tab
 * pill and the boards into a 360 px tall strip). Follows split screen on
 * an iPad: the lock is decided by the screen's shortest side.
 */
function useOrientationPolicy(isTablet: boolean) {
  useEffect(() => {
    if (Platform.OS === 'web') return
    const lock = isTablet ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    lock.catch(() => {})
  }, [isTablet])
}

function RootNavigator() {
  const { user, ready } = useSession()
  const segments = useSegments()
  const router = useRouter()
  const p = useTheme()
  const isDark = useIsDark()
  useOrientationPolicy(useResponsive().isTablet)

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  useEffect(() => {
    if (!ready) return
    // reset-password is an auth route too: recovery deep links arrive
    // unauthenticated (web registers it outside AuthGate the same way), and a
    // signed-in user following a recovery link must not be bounced off it.
    const inAuth = segments[0] === 'login' || segments[0] === 'reset-password'
    if (!user && !inAuth) router.replace('/login')
    else if (user && segments[0] === 'login') router.replace('/')
  }, [ready, user, segments, router])

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.page }}>
        <ActivityIndicator color={p.brand} />
      </View>
    )
  }

  const header = {
    headerStyle: { backgroundColor: p.surface },
    headerTintColor: p.textHigh,
    headerTitleStyle: { color: p.textHigh, fontFamily: fonts.display },
    contentStyle: { backgroundColor: p.page },
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <PushBridge />
      <Stack screenOptions={{ ...header, headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="clients" options={{ ...header, headerShown: true, title: 'Clients' }} />
        <Stack.Screen name="client/[id]" options={{ ...header, headerShown: true, title: 'Client' }} />
        <Stack.Screen name="project/[id]" options={{ ...header, headerShown: true, title: 'Project' }} />
        <Stack.Screen name="crm/index" options={{ ...header, headerShown: true, title: 'CRM' }} />
        <Stack.Screen name="crm/[tableId]" options={{ ...header, headerShown: true, title: 'Table' }} />
        <Stack.Screen name="meetings" options={{ ...header, headerShown: true, title: 'Meetings' }} />
        <Stack.Screen name="notifications" options={{ ...header, headerShown: true, title: 'Notifications' }} />
        <Stack.Screen name="notification-settings" options={{ ...header, headerShown: true, title: 'Push notifications' }} />
        <Stack.Screen name="messages/index" options={{ ...header, headerShown: true, title: 'Messages' }} />
        {/* Title + options come from the screen itself (per-conversation). */}
        <Stack.Screen name="messages/[id]" options={{ ...header, headerShown: true, title: 'Conversation' }} />
        <Stack.Screen name="messages/new" options={{ ...header, headerShown: true, title: 'New chat', presentation: 'modal' }} />
        <Stack.Screen name="vault" options={{ ...header, headerShown: true, title: 'Vault' }} />
        <Stack.Screen name="settings" options={{ ...header, headerShown: true, title: 'Settings' }} />
        <Stack.Screen name="eod" options={{ ...header, headerShown: true, title: 'End of Day Report' }} />
        <Stack.Screen name="growth/index" options={{ ...header, headerShown: true, title: 'Leads' }} />
        <Stack.Screen name="growth/[id]" options={{ ...header, headerShown: true, title: 'Lead' }} />
        <Stack.Screen name="portfolio/index" options={{ ...header, headerShown: true, title: 'Portfolio' }} />
        <Stack.Screen name="portfolio/[id]" options={{ ...header, headerShown: true, title: 'Portfolio entry' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  // Load the Editorial Ink type stack (Inter / Schibsted Grotesk / JetBrains
  // Mono). Registered family names match the fonts.* constants in lib/theme.
  // Gate render until ready so no screen flashes a system-font fallback; the
  // native splash stays up (preventAutoHideAsync above) until RootNavigator
  // hides it once the session is also resolved.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SchibstedGrotesk_600SemiBold,
    SchibstedGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  })

  if (!fontsLoaded && !fontError) return null

  return (
    // Must be the outermost view: gesture-handler detectors (the drag-to-move
    // kanban cards) silently never fire outside this root.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
