# Cube growth and workflow planning

This extension adds two active-admin-only tabs to Cube. It is local planning
software, not a deployed publishing, prospecting, or shared orchestration service.
Existing Cube recommendation permissions remain unchanged.

## Ad opportunities

Open Meta, Google, and LinkedIn ad libraries for manual discovery. Capture a
business, source ad, destination, observation date, observable signal, evidence,
and public contact page. Cube maps the signal to a possible service; budgets,
actual ad performance, and agency interest remain explicitly unknown.

The review checks loaded leads and clients by normalized business name. Duplicate
opportunities are blocked by website domain or business name within this inbox.
This is not fuzzy matching across subsidiaries, domains, or a global suppression
service. Missing relationship data blocks approval. Evidence older than 14 days
needs a recheck; this is a configurable product default to revisit with the owner.

An admin approves the current revision before copying a templated outreach draft
or manually recording contact. Editing evidence invalidates approval. A
do-not-contact record cannot be edited or approved; retained names/domains prevent
recreating that business within this inbox. No external messages are sent.

## Workflow studio

- Cases: handoffs, onboarding, delivery exceptions, scope changes, opportunity
  reviews, and SOP/coverage gaps. Each has an active owner, receiving department,
  next step, review date, and evidence for acceptance, blockers, resolution, or
  rejection. Finance ownership requires an active admin.
- Content calendar: objective, channel, named destination account, caption, asset
  link, planned time, exact-version approval, and manually recorded publication
  URL. Due items are surfaced while Cube is open. A planned time never claims a
  post was sent. Editing the caption, assets, account, or schedule removes approval.
- Job opportunities: filter DeskDev's existing job feed, open original listings,
  and prepare a review case. Manual discoveries can be recorded too. An individual
  vacancy does not establish willingness to hire an agency. No new scraping,
  applications, or platform messages are performed.
- Outcomes: local counts, recorded review events, and a JSON export of permitted
  local cases/content/events for evaluation. This is not a trained model, campaign
  analytics, or a tamper-proof audit log.

Both tabs store records separately per account and local/remote mode. Storage
errors are visible and unreadable history is preserved. Actions recheck the active
admin role and current record before saving. Another tab's latest book is read
first; browser storage is not transactional across concurrent writers. Access
controls protect the UI and commands, not against direct manipulation of browser
storage by its owner.

## Remaining full-roadmap work

| Workstream | Dependency before connected operation |
|---|---|
| Shared cases, accepted handoffs, and review history | Server schema, RLS, transactional commands, department membership |
| Background evaluation and recoverable execution | Durable event/outbox runner, idempotency, retries, step logs, pause controls |
| Automatic social publishing and post verification | Selected platform/accounts, supported APIs, credentials, destination mapping, approval-bound execution |
| Automated discovery | Supported source integrations and access; platform rules reviewed per source |
| Outbound campaigns and reply handling | Sending provider, target profile, contact provenance, shared suppression/opt-out records |
| Capacity, skills, dependencies, service templates | Owner-defined operational records and approved service playbooks |
| Client communication and campaign analytics | Permitted source records, analytics integrations, approved brand/claims rules |
| Learned decision model | Reviewed labelled examples, privacy/retention policy, task-specific evaluation and calibration |

The owner requested admin-only controls. Destination social accounts, sending
provider, target industries, and platform integration access have not yet been
specified. Development can proceed on independent foundations, but Cube cannot
publish or send on unspecified accounts. No migration, deployment, remote secret
change, or remote write is included in this extension.
