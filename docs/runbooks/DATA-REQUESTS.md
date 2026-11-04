# Data requests (access, correction, deletion, opt-out)

How to answer a person who asks what NixGen holds about them, to fix it, to
delete it, or to stop contacting them. Covers prospects (leads), newsletter
subscribers, clients and staff. Owner or an admin handles every request.

**Deadline: 30 days** from receipt (GDPR's one month; the Philippine Data
Privacy Act is no looser). Acknowledge within 3 working days.

## 0. Every request

1. **Log it** before doing anything (SQL editor, as yourself):
   ```sql
   SELECT public.write_audit_log('privacy.request_received', 'privacy', NULL,
     jsonb_build_object('kind', 'access|correction|deletion|opt_out', 'channel', 'email', 'received', now()::date));
   ```
   Do not put the person's email in the log row; reference the ticket or the
   email thread instead.
2. **Verify identity.** Reply to the address on file and ask them to confirm
   from it. Never send data to a different address than the one on record. For
   a staff member, confirm in person or by video.
3. Do the work below for the person's **category** (they can be in several:
   a lead who became a client, a subscriber who sent an enquiry).
4. Reply, then log the outcome:
   ```sql
   SELECT public.write_audit_log('privacy.request_closed', 'privacy', NULL,
     jsonb_build_object('kind', '…', 'outcome', 'fulfilled|partially|refused', 'closed', now()::date));
   ```

Run the SQL in the Supabase dashboard → SQL editor (it runs with full
rights, bypassing RLS). Replace `:email` with the address, lower-cased.

## 1. Where personal data lives

| Place | What | Retention (automatic) |
|---|---|---|
| `leads` | name, email, phone, company, message, budget, attribution, ip_hash | spam: deleted at 30 days; lost: personal fields scrubbed at 24 months (039) |
| `lead_activity` | timeline; `submitted`/email rows carry the message | with the lead |
| `lead_intake_attempts` | email_norm, ip_hash (throttle ledger) | 7 days (035) |
| `notifications` | in-app alerts quoting a lead's name | 90 days (039) |
| `site_subscribers` | email, consent time, unsubscribe time, ip_hash | kept while subscribed; unsubscribed rows kept as a suppression record |
| `site_subscriber_attempts` | email_norm, ip_hash | 1 day (039) |
| `clients`, `projects`, `events`, `event_attendees` | client contacts, meeting attendees | contract lifetime + legal retention |
| `profiles`, `messages`, `channel_messages`, `time_entries`, `eod_reports` | staff | employment + legal retention |
| `audit_log` | who changed what (ids, no message bodies) | kept |
| R2 backups | everything above, encrypted | 35 days (rolling) |
| Gmail (company inbox) | formsubmit copies, replies, auto-replies | manual |
| Google Sheets (n8n `log-to-sheets`) | lead pipeline milestones (name, stage) | manual |
| n8n executions (Render) | payloads of recent runs | n8n's execution pruning |
| Cloudflare Worker logs | request metadata, no form values | 3-7 days |
| Supabase logs | API request metadata | 1-7 days |

Not stored anywhere: raw IP addresses (only a salted hash), Turnstile tokens,
analytics cookies (Cloudflare Web Analytics is cookieless). Vault entries are
end-to-end encrypted and unreadable to the company; they hold staff-entered
credentials, not prospect data.

## 2. Access ("what do you have on me?")

```sql
-- Prospect
SELECT to_jsonb(l) - 'ip_hash' - 'score_breakdown' AS lead,
       (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) FROM public.lead_activity a WHERE a.lead_id = l.id) AS activity
  FROM public.leads l WHERE l.email_norm = lower(btrim(':email'));

-- Subscriber
SELECT email, source, consent_at, unsubscribed_at, created_at
  FROM public.site_subscribers WHERE email_norm = lower(btrim(':email'));

-- Client contact / meeting attendee
SELECT to_jsonb(c) FROM public.clients c WHERE lower(btrim(c.email)) = lower(btrim(':email'));
SELECT e.title, e.starts_at, ea.response_status
  FROM public.event_attendees ea JOIN public.events e ON e.id = ea.event_id
 WHERE lower(ea.email) = lower(btrim(':email'));
```

Also search the company Gmail and the Sheets log for the address. Send the
result as a PDF or JSON attachment to the verified address. Internal notes
about the person are included; other people's data in the same rows is not.

## 3. Correction

Edit the record in DeskDev (Growth → lead, Clients → client, Settings → Users
for staff). Fix the same value in the Sheets log if it appears there.

## 4. Deletion ("forget me")

Deletion is refused only where a law requires keeping the record (an invoice,
a signed contract): say which record and for how long.

**Prospect (lead):**
```sql
BEGIN;
-- notifications that quote the lead
DELETE FROM public.notifications n
 USING public.leads l
 WHERE n.entity = 'lead' AND n.entity_id = l.id AND l.email_norm = lower(btrim(':email'));
-- the leads themselves; lead_activity cascades
DELETE FROM public.leads WHERE email_norm = lower(btrim(':email'));
DELETE FROM public.lead_intake_attempts WHERE email_norm = lower(btrim(':email'));
COMMIT;
```

**Subscriber:** `DELETE FROM public.site_subscribers WHERE email_norm = lower(btrim(':email'));`
(an audit row is written by 039's trigger). If they only want no more email,
use section 5 instead: a deleted address can be re-added by a future import,
an unsubscribed one cannot.

**Client contact:** a client is a business relationship with contracts behind
it. Remove the person's contact details from `clients` (edit in DeskDev) and
`event_attendees`; keep projects and invoices.

**Staff:** offboard with **Deactivate** (Settings → Users), which blocks sign-in
and drops push subscriptions while keeping work history. A full delete
(`admin-users` `delete`) blanks their name on history through
`ON DELETE SET NULL`; messages they wrote stay as company records.

**Then, outside the database:**
- Gmail: delete the threads with that address (and empty Trash).
- Google Sheets: delete their rows in the n8n log sheet.
- n8n: Executions → filter by the workflow and date → delete runs containing them.
- formsubmit.co (while still the fallback): nothing to do; it forwards and keeps no inbox.
- Backups: tell the person their data leaves the encrypted backups within
  35 days as old backups expire; it is not restored into the live system
  except in a disaster recovery, after which this deletion is re-applied.
  Keep a list of honoured deletions (ticket references, not emails) so a
  restore can replay them.

## 5. Opt-out ("stop contacting me")

- Subscriber: `UPDATE public.site_subscribers SET unsubscribed_at = now() WHERE email_norm = lower(btrim(':email'));`
- Prospect: mark the lead **Lost** with reason "asked not to be contacted" and
  add a note; owners stop getting follow-up reminders for lost leads. The
  automatic reply only fires on new submissions.
- Remove them from any Gmail label or list used for outreach.

## 6. Breach or mistaken disclosure

If personal data went somewhere it should not have (wrong email, public link,
leaked key): contain it first (revoke the link, rotate the key), then record
it with `write_audit_log('privacy.incident', …)`. The Philippine NPC expects
notification within 72 hours of discovery when the breach is likely to harm
people; decide that with the owner the same day.
