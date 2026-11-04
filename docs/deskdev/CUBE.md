# Cube v1

Cube is DeskDev's deterministic operational recommendation engine, available at
`/cube` (or `/workspace/cube` on a single host). It uses existing authenticated
records and feature permissions. Sidebar and command-palette navigation are included.

## Shipped playbooks

| Playbook | Rules | Review owner |
|---|---|---|
| Lead follow-up | Open, non-spam lead with no active owner, due follow-up, or overdue first reply | Growth owner; admin review when unassigned |
| Blocked work | Unarchived blocked task; urgency increases when overdue or high priority | Assignee; delivery admin review when unassigned |
| Delivery readiness | Existing planning engagement: scope/acceptance/deposit gate, or ready for explicit kickoff review | Finance admin |

Finance recommendations are active-admin-only. Other playbooks require their
existing feature's view permission; review controls require edit. Deactivated
profiles cannot see recommendations. Failed source pulls are excluded rather
than evaluated from cached rows. Date-only deadlines use the workspace's
Growth business timezone, not the device's timezone.

The engine is `site/src/deskdev/cube/engine.ts`, outside the shared mobile data
layer. It returns typed actions, rule versions, evidence, reason codes, and an
exact change fingerprint. It has no network calls or side effects. Evaluation
runs on page open, store changes, refresh, and each minute while Cube is open.
This is a rule engine, not a trained System One model.

## Personal review workflow

The inbox supports department/status filtering, evidence inspection, opening
the source record, acknowledgement, a 24-hour snooze, and reopening. Acknowledgement
does not complete a task or approve an engagement. Changes to relevant inputs
invalidate the previous review. Snoozes expire and date-sensitive checks are
reconsidered at the next business day.

Before saving a review, Cube re-evaluates the latest store snapshot and checks
account, permissions, source availability, and exact proposal inputs. Duplicate
reviews of the same current state do not add another event. Paused playbooks
cannot receive new reviews.

Review history and playbook pauses are local, scoped by account and local/remote
mode. History holds up to 200 events, with identifiers and change markers rather
than copied evidence or financial values. It is not a shared or tamper-proof audit
log. Browser storage failures are visible and do not silently overwrite unreadable
history. Another tab's latest history is read before writing; concurrent writes
are not a transactional multi-device workflow.

## Automatic departmental operations

Active admins now have an Operations tab alongside the existing inbox and
Workflow Studio. It automatically maintains work queues for Growth, Client
Operations, Delivery, Creative, Finance, People and Leadership. It includes
admin ownership, evidence-backed intake and pending contract references,
pause controls, automatic resolution and recorded escalation. See
[Cube automatic operations](CUBE-AUTOMATIC-OPERATIONS.md) for exact behavior,
local/server modes, validation and rollout requirements.

Migration 053 adds shared queues and a minute scheduler; it remains pending.
The local demo runner works across DeskDev screens while an admin is signed in.

## Recommendation inbox limits and next phases

The personal recommendation inbox itself has no background server runner,
external messages, business mutations or shared approvals. Its reviews remain
separate from the automatic Operations queues. Existing reminders
and engagement validation remain responsible for their current behavior. Cube
does not duplicate notifications or create showcase drafts. Missing engagements
are not inferred to be ready or blocked.

Next phases require a transactional server event/outbox runner, RLS-protected
decision and approval records, idempotent awaited commands, and department
ownership/handoff contracts. Client onboarding, creative reviews, capacity and
skills, and campaign analysis require the structured source records described in
the product plan. Model-assisted classification should be introduced only after
reviewed examples and task-specific evaluations exist.

Production rollout remains owner-authorized and requires the repository's video
proof and release gate. No live migration or deployment is needed to review this
local release.

## Validation

Commands:

```powershell
cd site
npx tsc --noEmit -p tsconfig.json
npx vitest run src/deskdev/cube/engine.test.ts --maxWorkers=1
npx playwright test --config playwright.cube.config.ts
```

The browser suite uses local demo data, an isolated preview on port 4185, and
records videos under `site/e2e-artifacts/cube`. The main scenario also captures
desktop and mobile screenshots. `CUBE_E2E_PREBUILT=1` skips rebuilding for a
test-only rerun; use it only when the current source is already built in test mode.

Repository validation on 2026-10-08: TypeScript, migration lint, n8n lint, and
117 repository script tests passed. The full app run passed 1,427 tests, failed
nine, and skipped four; an isolated rerun cleared the error-rendering failures
and reproduced two store-permission failures in `growthLeads.test.ts` and
`lifecycle.test.ts`. The throwaway database suite passed 114 of 117 tests;
three existing `rls.test.mjs` checks failed (hole detection, sequence privileges,
and deleting a profile with message history). Shared-library drift was present
in `types.ts` and `db.ts` before Cube changes. Cube changes neither those
files nor the failing store or database paths.

Cube's 14 focused decision/review tests and all three browser scenarios passed.
Desktop and mobile screenshots were inspected; the mobile check confirms no
horizontal document overflow. Video proof includes persisted review actions,
playbook pause/resume, source navigation, member restrictions, changed evidence,
and corrupted-history handling.
