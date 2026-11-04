import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'

import { Button, Card, Input, Label, Screen } from '@/components/ui'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { fonts, radius, rgba, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'

// DeskDev is invite-only by design: there is NO public signup. Accounts are
// created by an admin (local mode: users managed in Settings; remote mode:
// Supabase invites), so this screen only offers sign-in + password recovery.
export default function Login() {
  const p = useTheme()
  const login = useStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Forgot-password view. Remote mode only — local mode has no email delivery
  // (passwords live in the local users slice), so the affordance is hidden and
  // the demo-accounts panel below covers credentials instead.
  const [forgot, setForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await login(email.trim(), password)
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Login failed')
    // On success the root navigator redirects automatically.
  }

  async function sendReset() {
    setBusy(true)
    setError(null)
    // The recovery email deep-links back into the app — reset-password.tsx
    // exchanges the link's tokens for a session. deskdev://reset-password must
    // be in the Supabase auth redirect allow-list (Expo Go uses an exp://
    // scheme instead, so test recovery in a dev/standalone build).
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: 'deskdev://reset-password',
    })
    setBusy(false)
    if (err) setError(err.message)
    else setResetSent(true)
  }

  function backToSignIn() {
    setForgot(false)
    setResetSent(false)
    setError(null)
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 24 }}
      >
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View
            style={{
              width: 56, height: 56, borderRadius: radius.lg, backgroundColor: p.brand,
              alignItems: 'center', justifyContent: 'center', marginBottom: 14,
            }}
          >
            <Feather name="zap" size={26} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 24, fontFamily: fonts.display, color: p.textHigh }}>DeskDev Studio</Text>
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, marginTop: 4 }}>
            {forgot ? 'Reset your password' : 'Client operations workspace'}
          </Text>
        </View>

        <Card>
        {forgot ? (
          resetSent ? (
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: rgba(p.success, 0.15), borderWidth: 1, borderColor: rgba(p.success, 0.3),
                }}
              >
                <Feather name="mail" size={18} color={p.success} />
              </View>
              <Text style={{ marginTop: 12, fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
                Check your inbox
              </Text>
              {/* Enumeration-safe: same message whether or not the account exists. */}
              <Text style={{ marginTop: 4, fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, textAlign: 'center' }}>
                If an account exists for that email, a reset link is on its way.
              </Text>
              <Button
                title="Back to sign in"
                icon="arrow-left"
                variant="ghost"
                onPress={backToSignIn}
                style={{ marginTop: 16, alignSelf: 'stretch' }}
              />
            </View>
          ) : (
            <View>
              <Label>Email</Label>
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                onSubmitEditing={sendReset}
                style={{ marginBottom: 8 }}
              />

              {error ? (
                <Text style={{ color: p.danger, fontSize: 13, fontFamily: fonts.sans, marginBottom: 8 }}>{error}</Text>
              ) : null}

              <Button
                title={busy ? 'Sending…' : 'Send reset link'}
                onPress={sendReset}
                loading={busy}
                style={{ marginTop: 8 }}
              />
              <Button
                title="Back to sign in"
                icon="arrow-left"
                variant="ghost"
                onPress={backToSignIn}
                style={{ marginTop: 10 }}
              />
            </View>
          )
        ) : (
          <View>
            <Label>Email</Label>
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              style={{ marginBottom: 14 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label>Password</Label>
              {isSupabaseConfigured ? (
                <Pressable onPress={() => { setForgot(true); setError(null) }} hitSlop={8}>
                  <Text style={{ fontSize: 12, color: p.brandText, fontFamily: fonts.sansSemibold }}>
                    Forgot password?
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              onSubmitEditing={submit}
              style={{ marginBottom: 8 }}
            />

            {error ? (
              <Text style={{ color: p.danger, fontSize: 13, fontFamily: fonts.sans, marginBottom: 8 }}>{error}</Text>
            ) : null}

            <Button title="Sign in" onPress={submit} loading={busy} style={{ marginTop: 8 }} />

            <View
              style={{
                marginTop: 24, padding: 12, borderRadius: radius.md,
                backgroundColor: p.hover, borderWidth: 1, borderColor: p.border,
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: p.textSecondary, marginBottom: 4 }}>
                Demo accounts
              </Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted }}>admin@deskdev.local · admin</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted }}>member@deskdev.local · member</Text>
            </View>
          </View>
        )}
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  )
}
