import { useState } from 'react'
import { toast } from 'sonner'
import { EnvelopeSimpleIcon } from '@phosphor-icons/react'
import { useStore } from '../../store/useStore'
import { EMAIL_RE } from '../../lib/email'
import { FormField, Panel } from './formKit'

// Admins: how email from DeskDev (049) looks to customers. n8n sends it
// through its "Gmail account" credential (workflow email-send) and brings
// replies back (email-inbound); their health shows on the Automations card.
// Saved on its own, so a database without 049 keeps the rest of Settings working.

export default function EmailSettingsCard() {
  const ws = useStore((s) => s.workspaceSettings)
  const updateWorkspaceSettings = useStore((s) => s.updateWorkspaceSettings)
  const [name, setName] = useState(ws.emailFromName)
  const [address, setAddress] = useState(ws.emailFromAddress ?? '')
  const [signature, setSignature] = useState(ws.emailSignature ?? '')

  const save = () => {
    const n = name.trim()
    const a = address.trim().toLowerCase()
    if (!n || n.length > 80) {
      toast.error('The sender name must be 1–80 characters')
      return
    }
    if (a && (a.length > 254 || !EMAIL_RE.test(a))) {
      toast.error('Enter the full Gmail address n8n sends from')
      return
    }
    if (signature.length > 1000) {
      toast.error('Keep the signature under 1000 characters')
      return
    }
    const ok = updateWorkspaceSettings({
      emailFromName: n,
      emailFromAddress: a || undefined,
      emailSignature: signature.trim() || undefined,
    })
    if (ok) toast.success('Email settings saved')
    else toast.error('Only an admin can change email settings')
  }

  const dirty =
    name !== ws.emailFromName ||
    address !== (ws.emailFromAddress ?? '') ||
    signature !== (ws.emailSignature ?? '')

  return (
    <Panel
      title="Email"
      icon={EnvelopeSimpleIcon}
      dirty={dirty}
      description="Emails written in DeskDev go out from the studio’s Gmail through n8n, and replies from leads and clients come back onto their profiles. Mail from anyone else is never imported."
      footer={<button type="button" className="btn-primary" onClick={save}>Save email settings</button>}
    >
      <div className="grid max-w-xl grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
        <FormField label="Sender name">
          {(p) => <input {...p} className="input w-full" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField label="Gmail address" hint="The account n8n’s Gmail credential is signed in to.">
          {(p) => (
            <input
              {...p}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              className="input w-full"
              placeholder="nixgensolutions@gmail.com"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Signature" hint="Added under every email sent from DeskDev." className="sm:col-span-2">
          {(p) => (
            <textarea
              {...p}
              className="input w-full min-h-[90px] resize-y"
              maxLength={1000}
              placeholder={'Bryan\nNixGen Solutions · nixgensolutions.com'}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Panel>
  )
}
