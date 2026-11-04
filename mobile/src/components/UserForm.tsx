import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'

import { Input } from '@/components/ui'
import { ColorPicker, Field, FormModal, PillGroup, type PillOption } from '@/components/forms'
import { useSession } from '@/context/session-context'
import { isSupabaseConfigured } from '@/lib/supabase'
import { ALL_FEATURES, DEFAULT_MEMBER_PERMISSIONS } from '@/lib/permissions'
import { fonts, radius, SWATCHES, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { PermFeature, PermLevel, Role, User } from '@/lib/types'

const ROLE_OPTIONS: PillOption<Role>[] = [
  { label: 'Member', value: 'member' },
  { label: 'Admin', value: 'admin' },
]

const LEVEL_OPTIONS: PillOption<PermLevel>[] = [
  { label: 'None', value: 'none' },
  { label: 'View', value: 'view' },
  { label: 'Edit', value: 'edit' },
]

const FEATURE_LABELS: Record<PermFeature, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  clients: 'Clients',
  crm: 'CRM',
  calendar: 'Calendar',
  meetings: 'Meetings',
  growth: 'Growth Hub',
  courses: 'Courses',
  showcase: 'Portfolio',
}

// The fourth copy-pasted swatch array in the app. SWATCHES is the shared palette —
// the in-flight refactor deduped the other three and missed this one.
const AVATAR_COLORS = SWATCHES

type PermMap = Record<PermFeature, PermLevel>
const fullPerms = (base: Partial<Record<PermFeature, PermLevel>> = {}): PermMap => {
  const out = {} as PermMap
  for (const f of ALL_FEATURES) out[f] = base[f] ?? 'none'
  return out
}

export function UserForm({
  visible, user, onClose,
}: {
  visible: boolean
  user?: User
  onClose: () => void
}) {
  const p = useTheme()
  const { user: currentUser } = useSession()
  const users = useStore((s) => s.users)
  const adminCreateUser = useStore((s) => s.adminCreateUser)
  const adminUpdateUser = useStore((s) => s.adminUpdateUser)
  const adminDeleteUser = useStore((s) => s.adminDeleteUser)

  const [busy, setBusy] = useState(false)
  const [wasVisible, setWasVisible] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [avatarColor, setAvatarColor] = useState<string>(AVATAR_COLORS[0])
  const [perms, setPerms] = useState<PermMap>(fullPerms(DEFAULT_MEMBER_PERMISSIONS))

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setBusy(false)
      setFullName(user?.fullName ?? '')
      setEmail(user?.email ?? '')
      setPassword('')
      setPhone(user?.phone ?? '')
      setTitle(user?.title ?? '')
      setRole(user?.role ?? 'member')
      setAvatarColor(user?.avatarColor ?? AVATAR_COLORS[0])
      setPerms(fullPerms(user ? user.permissions : DEFAULT_MEMBER_PERMISSIONS))
    }
  }

  const setAll = (level: PermLevel) => setPerms(fullPerms(Object.fromEntries(ALL_FEATURES.map((f) => [f, level]))))
  const isSelf = !!user && !!currentUser && user.id === currentUser.id

  // Remote mode: the email is the Supabase Auth identity — locked on edit
  // (same decision as the web UserModal).
  const emailLocked = !!user && isSupabaseConfigured

  const save = async () => {
    const name = fullName.trim()
    if (!name) { Alert.alert('Name required', 'Please enter a full name.'); return }
    const mail = email.trim().toLowerCase()
    if (!mail) { Alert.alert('Email required', 'Enter an email so this person can sign in.'); return }
    if (users.some((u) => u.id !== user?.id && (u.email ?? '').toLowerCase() === mail)) {
      Alert.alert('Email in use', 'A user with this email already exists.'); return
    }
    if (!user && !isSupabaseConfigured && password.trim().length < 3) {
      Alert.alert('Password required', 'Set a password of at least 3 characters (local mode).'); return
    }
    // Supabase Auth enforces a 6-char minimum on create and password reset.
    if (isSupabaseConfigured) {
      if (!user && password.length < 6) {
        Alert.alert('Password required', 'Password must be at least 6 characters.'); return
      }
      if (user && password && password.length < 6) {
        Alert.alert('Password too short', 'New password must be at least 6 characters.'); return
      }
    }
    const base = {
      fullName: name,
      phone: phone.trim() || undefined,
      title: title.trim() || undefined,
      role,
      avatarColor,
      permissions: role === 'admin' ? {} : perms,
    }
    setBusy(true)
    try {
      if (user) {
        const patch: Partial<User> = { ...base }
        if (!emailLocked) patch.email = mail
        // Remote passwords go to Supabase Auth verbatim; local mode keeps the
        // old trim behavior.
        const pw = isSupabaseConfigured ? password : password.trim()
        if (pw) patch.password = pw
        const res = await adminUpdateUser(user.id, patch)
        if (!res.ok) { Alert.alert('Could not update user', res.error ?? 'Something went wrong.'); return }
      } else {
        const res = await adminCreateUser({
          ...base,
          email: mail,
          password: isSupabaseConfigured ? password : password.trim() || undefined,
        })
        if (!res.ok) { Alert.alert('Could not create user', res.error ?? 'Something went wrong.'); return }
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = () => {
    if (!user || busy) return
    if (isSelf) { Alert.alert('Cannot delete', 'You cannot delete your own account.'); return }
    Alert.alert(
      'Delete user?',
      `${user.fullName} will lose access. Their created items become unassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Optimistic removal — adminDeleteUser rolls the user back into
            // the store when the remote delete fails.
            onClose()
            void adminDeleteUser(user.id).then((res) => {
              if (!res.ok) Alert.alert('Could not delete user', res.error ?? 'Something went wrong.')
            })
          },
        },
      ],
    )
  }

  return (
    <FormModal
      visible={visible}
      title={user ? 'Edit user' : 'New user'}
      onClose={onClose}
      onSubmit={() => { void save() }}
      submitLabel={busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}
      submitDisabled={busy}
      footerLeft={user && !isSelf ? (
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 10, opacity: busy ? 0.5 : 1 }}>
          <Feather name="trash-2" size={20} color={p.danger} />
        </Pressable>
      ) : undefined}
    >
      <Field label="Full name *">
        <Input value={fullName} onChangeText={setFullName} placeholder="Jane Doe" autoFocus={!user} />
      </Field>
      <Field label="Email *">
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="jane@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!emailLocked}
          style={emailLocked ? { opacity: 0.6 } : undefined}
        />
        {emailLocked ? (
          <Text style={{ marginTop: 6, fontSize: 11, fontFamily: fonts.sans, color: p.textMuted }}>
            Email is managed by Supabase Auth.
          </Text>
        ) : null}
      </Field>
      <Field label={user ? 'Password (leave blank to keep)' : 'Password *'}>
        <Input
          value={password}
          onChangeText={setPassword}
          placeholder={isSupabaseConfigured && !user ? 'At least 6 characters' : '••••••'}
          secureTextEntry
          autoCapitalize="none"
        />
      </Field>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label="Phone">
            <Input value={phone} onChangeText={setPhone} placeholder="+1 555 000 0000" keyboardType="phone-pad" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Title">
            <Input value={title} onChangeText={setTitle} placeholder="Designer" />
          </Field>
        </View>
      </View>
      <Field label="Avatar color">
        <ColorPicker value={avatarColor} onChange={setAvatarColor} colors={AVATAR_COLORS} />
      </Field>
      <Field label="Role">
        <PillGroup options={ROLE_OPTIONS} value={role} onChange={setRole} />
      </Field>

      {role === 'admin' ? (
        <View style={{ backgroundColor: p.hover, borderRadius: radius.md, padding: 12 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textSecondary }}>
            Admins have full edit access to every area plus Settings.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, letterSpacing: 1, color: p.textSecondary }}>PERMISSIONS</Text>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <Pressable onPress={() => setAll('view')}><Text style={{ fontSize: 12, color: p.brandText, fontFamily: fonts.sansSemibold }}>View all</Text></Pressable>
              <Pressable onPress={() => setAll('edit')}><Text style={{ fontSize: 12, color: p.brandText, fontFamily: fonts.sansSemibold }}>Edit all</Text></Pressable>
            </View>
          </View>
          {ALL_FEATURES.map((f) => (
            <View key={f} style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.text }}>{FEATURE_LABELS[f]}</Text>
              <PillGroup options={LEVEL_OPTIONS} value={perms[f]} onChange={(lvl) => setPerms((prev) => ({ ...prev, [f]: lvl }))} />
            </View>
          ))}
        </View>
      )}
    </FormModal>
  )
}
