import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Feather } from '@expo/vector-icons'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, View } from 'react-native'

import { Button, Input, Label, Screen } from '@/components/ui'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { fonts, radius, rgba, useTheme } from '@/lib/theme'

// Landing screen for Supabase password-recovery links (sent from the "Forgot
// password?" affordance on login). The email link deep-links back here as
// deskdev://reset-password#access_token=…&refresh_token=…&type=recovery. The
// mobile client runs with detectSessionInUrl: false, so unlike web this screen
// parses the link itself and exchanges the tokens via auth.setSession, after
// which updateUser({ password }) works. Registered as an auth route in
// _layout.tsx — recovery links arrive unauthenticated.
//
// DeskDev is invite-only by design: there is NO public signup. This screen
// only ever resets the password of an existing, admin-invited account.

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

/** Collect params from both the query and the hash fragment of a deep link. */
function parseAuthParams(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  const hashIndex = url.indexOf('#')
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1)
  const queryIndex = beforeHash.indexOf('?')
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1)
  for (const part of [query, hash]) {
    if (!part) continue
    new URLSearchParams(part).forEach((value, key) => {
      out[key] = value
    })
  }
  return out
}

function Shell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const p = useTheme()
  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 24 }}
      >
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <View
            style={{
              width: 56, height: 56, borderRadius: radius.lg, backgroundColor: p.brand,
              alignItems: 'center', justifyContent: 'center', marginBottom: 14,
            }}
          >
            <Feather name="key" size={26} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 24, fontFamily: fonts.display, color: p.textHigh }}>DeskDev Studio</Text>
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, marginTop: 4 }}>{subtitle}</Text>
        </View>
        {children}
      </KeyboardAvoidingView>
    </Screen>
  )
}

function ErrorBox({ message }: { message: string }) {
  const p = useTheme()
  return (
    <View
      style={{
        borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8,
        backgroundColor: rgba(p.danger, 0.15), borderColor: rgba(p.danger, 0.3),
      }}
    >
      <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.danger }}>{message}</Text>
    </View>
  )
}

export default function ResetPassword() {
  const p = useTheme()
  const router = useRouter()
  const url = Linking.useURL()

  const [phase, setPhase] = useState<Phase>('checking')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // True once the opening deep link carried recovery tokens — stops the
  // getSession() fallback below from flashing 'invalid' while setSession runs.
  const sawTokens = useRef(false)

  // Exchange the deep link's tokens for a temporary recovery session. A later
  // link (warm start) can still upgrade an 'invalid' phase to 'ready'.
  useEffect(() => {
    if (!isSupabaseConfigured || !url) return
    const params = parseAuthParams(url)
    if (params.access_token && params.refresh_token) {
      sawTokens.current = true
      void supabase.auth
        .setSession({ access_token: params.access_token, refresh_token: params.refresh_token })
        .then(({ error: err }) => {
          if (err) {
            setUrlError(err.message)
            setPhase((prev) => (prev === 'done' ? prev : 'invalid'))
          } else {
            setPhase((prev) => (prev === 'done' ? prev : 'ready'))
          }
        })
    } else if (params.error_description || params.error) {
      // Supabase appends error details to the link when it is expired/used.
      setUrlError(params.error_description ?? 'This reset link is invalid or has expired.')
      setPhase((prev) => (prev === 'ready' || prev === 'done' ? prev : 'invalid'))
    }
  }, [url])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true

    // Belt-and-suspenders next to the URL exchange above: PASSWORD_RECOVERY /
    // SIGNED_IN fire once a recovery session exists, and getSession() covers a
    // session established before this screen mounted.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setPhase((prev) => (prev === 'done' ? prev : 'ready'))
      }
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setPhase((prev) => {
        if (prev !== 'checking') return prev
        if (data.session) return 'ready'
        return sawTokens.current ? prev : 'invalid'
      })
    })

    return () => {
      active = false
      authSub.subscription.unsubscribe()
    }
  }, [])

  // Local mode has no email delivery and no Supabase auth — passwords are
  // managed by an admin in Settings, so recovery links can't exist here.
  if (!isSupabaseConfigured) {
    return (
      <Shell subtitle="Reset your password">
        <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.text, textAlign: 'center' }}>
          Password reset isn't available in local mode.
        </Text>
        <Text style={{ marginTop: 8, fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, textAlign: 'center', lineHeight: 18 }}>
          This workspace runs without a hosted backend — accounts and passwords are managed by
          your admin in Settings. Use the demo accounts on the sign-in screen.
        </Text>
        <Button
          title="Back to sign in"
          icon="arrow-left"
          onPress={() => router.replace('/login')}
          style={{ marginTop: 20 }}
        />
      </Shell>
    )
  }

  if (phase === 'checking') {
    return (
      <Shell subtitle="Reset your password">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={p.brand} />
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>Checking your reset link…</Text>
        </View>
      </Shell>
    )
  }

  if (phase === 'invalid') {
    return (
      <Shell subtitle="Reset your password">
        <ErrorBox message={urlError ?? 'This reset link is invalid or has expired.'} />
        <Text style={{ marginTop: 12, fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, textAlign: 'center' }}>
          Request a new link from the sign-in screen via "Forgot password?".
        </Text>
        <Button
          title="Back to sign in"
          icon="arrow-left"
          onPress={() => router.replace('/login')}
          style={{ marginTop: 20 }}
        />
      </Shell>
    )
  }

  if (phase === 'done') {
    return (
      <Shell subtitle="Reset your password">
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
              backgroundColor: rgba(p.success, 0.15), borderWidth: 1, borderColor: rgba(p.success, 0.3),
            }}
          >
            <Feather name="check" size={18} color={p.success} />
          </View>
          <Text style={{ marginTop: 12, fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
            Password updated
          </Text>
          <Text style={{ marginTop: 4, fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>
            Sign in with your new password.
          </Text>
          <Button
            title="Sign in"
            onPress={() => router.replace('/login')}
            style={{ marginTop: 20, alignSelf: 'stretch' }}
          />
        </View>
      </Shell>
    )
  }

  const submit = async () => {
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setBusy(false)
      setError(err.message)
      return
    }
    // The recovery session is temporary — sign out so the user signs in
    // normally (login() also loads their profile into the store).
    await supabase.auth.signOut()
    setBusy(false)
    setPhase('done')
  }

  return (
    <Shell subtitle="Choose a new password">
      <Label>New password</Label>
      <Input
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        style={{ marginBottom: 14 }}
      />
      <Label>Confirm password</Label>
      <Input
        value={confirm}
        onChangeText={setConfirm}
        placeholder="••••••••"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        onSubmitEditing={() => { void submit() }}
        style={{ marginBottom: 8 }}
      />

      {error ? (
        <View style={{ marginBottom: 8 }}>
          <ErrorBox message={error} />
        </View>
      ) : null}

      <Button
        title={busy ? 'Saving…' : 'Set new password'}
        onPress={() => { void submit() }}
        loading={busy}
        style={{ marginTop: 8 }}
      />
    </Shell>
  )
}
