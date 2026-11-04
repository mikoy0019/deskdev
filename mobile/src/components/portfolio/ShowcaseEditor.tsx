import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Feather } from '@expo/vector-icons'
import { useNavigation, useRouter } from 'expo-router'
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native'

import { CONSENT_LABEL, KIND_LABEL, STATUS_LABEL, ShowcaseThumb, statusChip } from '@/components/portfolio/showcaseBits'
import { DateField, PillGroup, SelectField } from '@/components/forms'
import { Button, Card, Chip, Input, Label, SectionTitle } from '@/components/ui'
import { can, isAdmin } from '@/lib/permissions'
import { SITE_ORIGIN } from '@/lib/platform'
import {
  MAX_SHOWCASE_SUMMARY, consentAllowsPublishing, isHttpsUrl, publishChecklist, showcaseStatusError,
} from '@/lib/showcase'
import { fmtDate } from '@/lib/format'
import { accentChip, fonts, neutralChip, space, useTheme } from '@/lib/theme'
import type { ShowcaseCaseStudy, ShowcaseConsent, ShowcaseItem, ShowcaseKind, ShowcaseStatus } from '@/lib/types'
import { useCurrentUser, useStore, type ShowcasePatch } from '@/store/useStore'

// One portfolio entry, as the developer fills it in once a project is done and
// as an admin publishes it — the phone's version of the web's
// components/showcase/ShowcaseEditor.tsx, with the same rules (lib/showcase.ts,
// shared): drafting and "ready for review" need showcase:edit; publishing and
// unpublishing are admin-only and need the client's consent.
//
// Leaving with unsaved changes saves them, like the web. Changes that can't be
// saved (no title, a non-https link) ask first: keep editing, or discard.

const MAX_METRICS = 4
const SITE = SITE_ORIGIN ?? 'https://nixgensolutions.com'

/** The fields this screen edits, as text where the input is text. */
interface Form {
  title: string
  kind: ShowcaseKind
  url: string
  linkPublic: boolean
  industry: string
  summary: string
  resultTag: string
  stack: string
  launchedOn: string
  imageAlt: string
  featured: boolean
  homeFeatured: boolean
  sortOrder: string
  consent: ShowcaseConsent
  consentNote: string
  challenge: string
  approach: string
  outcome: string
  metrics: { label: string; value: string }[]
  quote: string
  author: string
  role: string
}

function formOf(item: ShowcaseItem): Form {
  const cs = item.caseStudy ?? {}
  return {
    title: item.title,
    kind: item.kind,
    url: item.url ?? '',
    linkPublic: item.linkPublic,
    industry: item.industry ?? '',
    summary: item.summary ?? '',
    resultTag: item.resultTag ?? '',
    stack: item.stack.join(', '),
    launchedOn: item.launchedOn ?? '',
    imageAlt: item.imageAlt ?? '',
    featured: item.featured,
    homeFeatured: item.homeFeatured,
    sortOrder: String(item.sortOrder),
    consent: item.consent,
    consentNote: item.consentNote ?? '',
    challenge: cs.challenge ?? '',
    approach: cs.approach ?? '',
    outcome: cs.outcome ?? '',
    metrics: (cs.metrics ?? []).map((m) => ({ label: m.label, value: m.value })),
    quote: cs.quote?.text ?? '',
    author: cs.quote?.author ?? '',
    role: cs.quote?.role ?? '',
  }
}

const opt = (v: string) => v.trim() || undefined

/** The patch for updateShowcaseItem (the web editor's patchOf); an empty case study is stored as none. */
function patchOf(f: Form): ShowcasePatch {
  const metrics = f.metrics
    .map((m) => ({ label: m.label.trim(), value: m.value.trim() }))
    .filter((m) => m.label && m.value)
  // The site shows a quote only with both the text and who said it.
  const quote = f.quote.trim()
    ? { text: f.quote.trim(), author: f.author.trim(), role: opt(f.role) }
    : undefined
  const caseStudy: ShowcaseCaseStudy = {
    challenge: opt(f.challenge),
    approach: opt(f.approach),
    outcome: opt(f.outcome),
    ...(metrics.length ? { metrics } : {}),
    ...(quote ? { quote } : {}),
  }
  const hasCaseStudy = Object.values(caseStudy).some((v) => v !== undefined)
  const sort = Number(f.sortOrder)
  return {
    title: f.title.trim(),
    kind: f.kind,
    url: opt(f.url),
    linkPublic: f.linkPublic,
    industry: opt(f.industry),
    summary: opt(f.summary),
    resultTag: opt(f.resultTag),
    stack: [...new Set(f.stack.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 12),
    launchedOn: opt(f.launchedOn),
    imageAlt: opt(f.imageAlt),
    featured: f.featured,
    homeFeatured: f.homeFeatured,
    sortOrder: Number.isFinite(sort) ? Math.round(sort) : 0,
    consent: f.consent,
    consentNote: opt(f.consentNote),
    caseStudy: hasCaseStudy ? caseStudy : undefined,
  }
}

/** Why the form can't be saved as it is, or null. */
function problemOf(f: Form): string | null {
  if (!f.title.trim()) return 'A title is required'
  if (f.url.trim() && !isHttpsUrl(f.url.trim())) return 'The live URL must be a full https:// address'
  return null
}

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as ShowcaseKind[]).map((k) => ({ label: KIND_LABEL[k], value: k }))
const CONSENT_OPTIONS = (Object.keys(CONSENT_LABEL) as ShowcaseConsent[]).map((c) => ({ label: CONSENT_LABEL[c], value: c }))

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const p = useTheme()
  return (
    <View style={{ gap: 12, marginBottom: 22 }}>
      <View>
        <SectionTitle style={{ marginBottom: 0 }}>{title}</SectionTitle>
        {hint ? <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 4, lineHeight: 17 }}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  const p = useTheme()
  return (
    <View>
      <Label>{label}</Label>
      {children}
      {hint ? <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 4 }}>{hint}</Text> : null}
      {error ? <Text style={{ fontSize: 12, fontFamily: fonts.sansMedium, color: p.danger, marginTop: 4 }}>{error}</Text> : null}
    </View>
  )
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const p = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.sans, color: p.textHigh }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: p.brand, false: p.borderStrong }}
        accessibilityLabel={label}
      />
    </View>
  )
}

export default function ShowcaseEditor({ item }: { item: ShowcaseItem }) {
  const p = useTheme()
  const router = useRouter()
  const navigation = useNavigation()
  const user = useCurrentUser()
  const canEdit = can(user, 'showcase', 'edit')
  const admin = isAdmin(user)
  const updateShowcaseItem = useStore((s) => s.updateShowcaseItem)
  const setShowcaseStatus = useStore((s) => s.setShowcaseStatus)
  const deleteShowcaseItem = useStore((s) => s.deleteShowcaseItem)
  const project = useStore((s) => (item.projectId ? s.projects.find((pr) => pr.id === item.projectId) : undefined))
  const client = useStore((s) => (item.clientId ? s.clients.find((c) => c.id === item.clientId) : undefined))

  const [form, setForm] = useState<Form>(() => formOf(item))
  const [saved, setSaved] = useState<Form>(() => formOf(item))
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const problem = problemOf(form)
  const urlError = form.url.trim() && !isHttpsUrl(form.url.trim()) ? 'Use the full https:// address' : null
  const summaryLength = form.summary.trim().length
  const readOnly = !canEdit

  // The checklist judges what the form shows now, plus what only the server knows.
  const checklist = publishChecklist({ ...item, ...patchOf(form) })
  const done = checklist.filter((c) => c.ok).length
  const clientConsent = client?.showcaseConsent ?? 'unknown'
  const canPublish = admin && consentAllowsPublishing(form.consent)

  /** Saves the form; false (with an alert) when it can't. */
  const save = (f: Form = form): boolean => {
    const why = problemOf(f)
    if (why) {
      Alert.alert('Not saved', why)
      return false
    }
    if (JSON.stringify(f) === JSON.stringify(saved)) return true
    if (!updateShowcaseItem(item.id, patchOf(f))) {
      Alert.alert('Not saved', 'Could not save this entry.')
      return false
    }
    setSaved(f)
    return true
  }

  // Leaving: save what can be saved; ask about what can't. (Swipe-back on iOS
  // can't be held once the gesture completes; the save still runs.)
  const formRef = useRef(form)
  const savedRef = useRef(saved)
  const skipLeaveRef = useRef(false)
  useEffect(() => {
    formRef.current = form
    savedRef.current = saved
  })
  useEffect(() => {
    if (!canEdit) return
    return navigation.addListener('beforeRemove', (e) => {
      if (skipLeaveRef.current) return
      const f = formRef.current
      if (JSON.stringify(f) === JSON.stringify(savedRef.current)) return
      const why = problemOf(f)
      if (!why) {
        updateShowcaseItem(item.id, patchOf(f))
        return
      }
      e.preventDefault()
      Alert.alert('Unsaved changes', `${why}. Keep editing, or leave without saving?`, [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            skipLeaveRef.current = true
            navigation.dispatch(e.data.action)
          },
        },
      ])
    })
  }, [navigation, canEdit, item.id, updateShowcaseItem])

  const move = (to: ShowcaseStatus, success: string) => {
    if (!save()) return
    // The store re-checks the same rules (and the database a third time).
    const reason = showcaseStatusError(user, { status: item.status, consent: form.consent }, to)
    if (reason) {
      Alert.alert('Not changed', reason)
      return
    }
    const result = setShowcaseStatus(item.id, to)
    if (result.ok) Alert.alert(success)
    else Alert.alert('Not changed', result.error ?? 'Could not change the status.')
  }

  const remove = () => {
    Alert.alert(
      'Delete portfolio entry?',
      `“${item.title}”${item.status === 'published' ? ' comes off the website, and' : ''} its screenshots are deleted too.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            skipLeaveRef.current = true
            if (deleteShowcaseItem(item.id)) router.back()
            else {
              skipLeaveRef.current = false
              Alert.alert('Not deleted', 'Could not delete this entry.')
            }
          },
        },
      ],
    )
  }

  const input = (key: 'title' | 'url' | 'industry' | 'resultTag' | 'stack' | 'imageAlt' | 'consentNote' | 'quote' | 'author' | 'role') => ({
    value: form[key],
    onChangeText: (t: string) => set(key, t),
    editable: !readOnly,
  })
  const area = (key: 'summary' | 'challenge' | 'approach' | 'outcome') => ({
    value: form[key],
    onChangeText: (t: string) => set(key, t),
    editable: !readOnly,
    multiline: true,
    style: { minHeight: 84, textAlignVertical: 'top' as const },
  })

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: p.page }} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {/* Where it stands */}
        <Card style={{ marginBottom: 22, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip label={STATUS_LABEL[item.status]} colors={statusChip(p, item.status)} />
            <Chip
              label={`Consent: ${CONSENT_LABEL[form.consent]}`}
              colors={consentAllowsPublishing(form.consent) ? accentChip('emerald') : accentChip('amber')}
            />
            <Chip label={`${done}/${checklist.length} ready`} colors={neutralChip(p)} />
          </View>
          {project ? (
            <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>
              From project “{project.title}”{client ? ` · ${client.name}` : ''}
            </Text>
          ) : null}
          {item.status === 'published' ? (
            <Pressable
              onPress={() => void Linking.openURL(`${SITE}/portfolio/${item.slug}`)}
              accessibilityRole="link"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Feather name="external-link" size={14} color={p.brandText} />
              <Text style={{ fontSize: 13, fontFamily: fonts.sansMedium, color: p.brandText }}>View on site</Text>
            </Pressable>
          ) : null}
          <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted }}>
            {SITE.replace(/^https?:\/\//, '')}/portfolio/{item.slug}
            {item.publishedAt ? ` · published ${fmtDate(item.publishedAt)}` : ''}
          </Text>
        </Card>

        <Group title="Publish checklist" hint="Only consent is enforced; the rest keeps the public page from looking unfinished.">
          <View style={{ gap: 8 }}>
            {checklist.map((c) => (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name={c.ok ? 'check-circle' : 'circle'} size={16} color={c.ok ? p.success : p.iconMuted} />
                <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: c.ok ? p.textHigh : p.textMuted }}>
                  {c.label}
                  {c.ok ? '' : ' (missing)'}
                </Text>
              </View>
            ))}
          </View>
        </Group>

        <Group title="The project">
          <Field label="Title *" error={form.title.trim() ? null : 'A title is required'}>
            <Input {...input('title')} />
          </Field>
          <Field label="Kind">
            {readOnly ? (
              <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.textHigh }}>{KIND_LABEL[form.kind]}</Text>
            ) : (
              <PillGroup options={KIND_OPTIONS} value={form.kind} onChange={(v) => set('kind', v)} />
            )}
          </Field>
          <Field label="Live URL" error={urlError}>
            <Input {...input('url')} placeholder="https://" keyboardType="url" autoCapitalize="none" autoCorrect={false} />
          </Field>
          <Toggle label="Show the live link publicly (off: card only)" value={form.linkPublic} onChange={(v) => set('linkPublic', v)} disabled={readOnly} />
          <Field label="Industry">
            <Input {...input('industry')} placeholder="e.g. Dental clinic" />
          </Field>
          <Field label="Launched on">
            {readOnly ? (
              <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.textHigh }}>{form.launchedOn ? fmtDate(form.launchedOn) : '—'}</Text>
            ) : (
              <DateField value={form.launchedOn || undefined} onChange={(d) => set('launchedOn', d ?? '')} />
            )}
          </Field>
          <Field label="Result tag" hint="One short line on the card, e.g. “+42% bookings”.">
            <Input {...input('resultTag')} maxLength={60} />
          </Field>
          <Field
            label="Summary"
            hint={`${summaryLength}/${MAX_SHOWCASE_SUMMARY} — what was built and for whom, in two or three sentences.`}
            error={summaryLength > MAX_SHOWCASE_SUMMARY ? `Over by ${summaryLength - MAX_SHOWCASE_SUMMARY} characters` : null}
          >
            <Input {...area('summary')} />
          </Field>
          <Field label="Stack" hint="Comma separated, e.g. Next.js, Supabase, n8n.">
            <Input {...input('stack')} autoCapitalize="none" />
          </Field>
        </Group>

        <Group
          title="Screenshot"
          hint="Upload screenshots from the DeskDev web app: it resizes them to the 1280 px and 640 px WebP versions the site loads, which the phone can't do yet."
        >
          <ShowcaseThumb item={item} p={p} large />
          <Field label="Alt text" hint="What the screenshot shows, for screen readers and search.">
            <Input {...input('imageAlt')} />
          </Field>
        </Group>

        <Group title="Case study" hint="Optional. Filled in on a featured entry, it becomes the page at /portfolio/<slug>.">
          <Field label="The challenge">
            <Input {...area('challenge')} />
          </Field>
          <Field label="What we built">
            <Input {...area('approach')} />
          </Field>
          <Field label="The outcome">
            <Input {...area('outcome')} />
          </Field>
          <View style={{ gap: 8 }}>
            <Label>Results in numbers</Label>
            {form.metrics.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Input
                  value={m.value}
                  editable={!readOnly}
                  placeholder="+42%"
                  accessibilityLabel={`Result ${i + 1} value`}
                  onChangeText={(t) => set('metrics', form.metrics.map((x, j) => (j === i ? { ...x, value: t } : x)))}
                  style={{ width: 96 }}
                />
                <Input
                  value={m.label}
                  editable={!readOnly}
                  placeholder="online bookings"
                  accessibilityLabel={`Result ${i + 1} label`}
                  onChangeText={(t) => set('metrics', form.metrics.map((x, j) => (j === i ? { ...x, label: t } : x)))}
                  style={{ flex: 1 }}
                />
                {canEdit ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove result ${i + 1}`}
                    onPress={() => set('metrics', form.metrics.filter((_, j) => j !== i))}
                  >
                    <Feather name="x" size={18} color={p.iconMuted} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {canEdit && form.metrics.length < MAX_METRICS ? (
              <Button title="Add a result" icon="plus" variant="ghost" onPress={() => set('metrics', [...form.metrics, { label: '', value: '' }])} />
            ) : null}
          </View>
          <Field label="Client quote">
            <Input {...input('quote')} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} />
          </Field>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Who said it">
                <Input {...input('author')} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Their role">
                <Input {...input('role')} />
              </Field>
            </View>
          </View>
        </Group>

        <Group title="Placement">
          <Toggle label="Featured on /portfolio" value={form.featured} onChange={(v) => set('featured', v)} disabled={readOnly} />
          <Toggle label="On the home page" value={form.homeFeatured} onChange={(v) => set('homeFeatured', v)} disabled={readOnly} />
          <Field label="Order">
            <Input
              value={form.sortOrder}
              editable={!readOnly}
              keyboardType="number-pad"
              onChangeText={(t) => set('sortOrder', t.replace(/[^0-9-]/g, ''))}
              style={{ width: 96 }}
            />
          </Field>
        </Group>

        <Group title="Client consent" hint="Nothing goes on the public site without it (the database refuses).">
          <Field label="Consent">
            <SelectField
              value={form.consent}
              options={CONSENT_OPTIONS}
              onChange={(v) => v && set('consent', v as ShowcaseConsent)}
              disabled={readOnly}
            />
          </Field>
          <Field label="Note" hint="How and when they agreed, e.g. “Onboarding form, 6 Oct”.">
            <Input {...input('consentNote')} />
          </Field>
          {client && clientConsent !== 'unknown' && clientConsent !== form.consent && canEdit ? (
            <Pressable onPress={() => set('consent', clientConsent)} accessibilityRole="button">
              <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.text, lineHeight: 19 }}>
                {client.name}’s client record says <Text style={{ fontFamily: fonts.sansSemibold }}>{CONSENT_LABEL[clientConsent]}</Text>.{' '}
                <Text style={{ fontFamily: fonts.sansSemibold, color: p.brandText }}>Use that</Text>
              </Text>
            </Pressable>
          ) : null}
        </Group>

        {canEdit && (item.status !== 'published' || admin) ? (
          <Button title="Delete entry" icon="trash-2" variant="danger" onPress={remove} style={{ marginTop: space.sm }} />
        ) : null}
      </ScrollView>

      {canEdit ? (
        <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: p.border, backgroundColor: p.surface }}>
          {admin && item.status !== 'published' && !consentAllowsPublishing(form.consent) ? (
            <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.warn }}>Publishing needs the client’s consent first.</Text>
          ) : null}
          {problem && dirty ? <Text style={{ fontSize: 12, fontFamily: fonts.sansMedium, color: p.danger }}>{problem}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              title="Save"
              variant={dirty ? 'primary' : 'ghost'}
              disabled={!dirty}
              onPress={() => {
                if (save()) Alert.alert('Saved')
              }}
              style={{ flex: 1 }}
            />
            {item.status === 'draft' ? (
              <Button title="Ready for review" icon="check-circle" variant="ghost" onPress={() => move('ready', 'Sent for review')} style={{ flex: 1 }} />
            ) : null}
            {admin && item.status === 'published' ? (
              <Button title="Unpublish" icon="eye-off" variant="ghost" onPress={() => move('hidden', 'Taken off the site')} style={{ flex: 1 }} />
            ) : null}
            {admin && item.status !== 'published' && item.status !== 'draft' ? (
              <Button title="Publish" icon="upload-cloud" disabled={!canPublish} onPress={() => move('published', 'Published to nixgensolutions.com')} style={{ flex: 1 }} />
            ) : null}
          </View>
          {admin && item.status === 'draft' ? (
            <Button title="Publish" icon="upload-cloud" disabled={!canPublish} onPress={() => move('published', 'Published to nixgensolutions.com')} />
          ) : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  )
}
