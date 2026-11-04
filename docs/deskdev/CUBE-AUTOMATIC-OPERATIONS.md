# Cube automatic operations

## Owner direction

The owner requested coverage across departments and admin responsibilities,
automatic operation, and analysis of the lead-to-delivery workflow. Contracts
have not been set up; the owner will provide the contract file later.

This release adds automatic internal coordination to the existing Cube
recommendation inbox and Workflow Studio. It is a deterministic rule engine,
not a trained neural model. Source records and human-confirmed evidence are
the inputs; department work items are the automatic output.

## Where to use it

Open DeskDev -> Cube -> Operations as an active admin. The board refreshes
every 10 seconds and displays department owners, work queues, last successful
evaluation, resolved items and recent changes. Existing personal reviews,
ad opportunities and Workflow Studio remain available separately.

The owner-supplied Facebook reference **Code with Toushif** is available in
Cube's Reference pages section. The supplied share URL is retained verbatim.
It has not been treated as a connected account or as verified publishing
authority; Facebook did not allow the page contents to be retrieved during
implementation.

All seven queues have an active-admin owner. An unset, deleted or deactivated
department owner falls back to the earliest-created active admin, with ID as
a stable tie-breaker. Source task/lead/project assignees remain the work owner
when active; the department admin is accountable for its queue. Finance and
Leadership work always routes to the department admin. This does not create
new authentication roles or promote members.

| Queue | Automatic operation |
|---|---|
| Growth / Sales | Creates follow-up work for unowned open leads, due follow-ups and overdue initial replies; skips closed, spam and scrubbed leads |
| Client Operations | Creates intake work until brief and required assets are confirmed |
| Delivery / Engineering | Routes blocked/overdue tasks, ready intake/Finance handoffs and outstanding delivery QA |
| Creative / Content | Creates review work for projects explicitly marked as requiring creative approval |
| Finance | Maintains contract/acceptance/deposit holds and flags overdue invoices without sufficient recorded receipts |
| People / Capacity | Routes missing/inactive project and task ownership for assignment; workload balancing awaits skills/availability/effort records |
| Leadership / Operations | Flags failing, stale or never-proven registered automation jobs; escalates continuously urgent work after 24 hours |

No creative requirement is inferred from a missing brief. Confirmations start
false, and contract references start empty. Creating a queue item does not
claim that the department's work has been completed.

## Contract and intake preparation

Choose a project under Project intake and contracts. Save a real agreement
identifier/reference when supplied, and record references supporting brief,
assets, creative and QA confirmations. Confirmed fields require evidence.
The reference is treated as text, never fetched or executed.

Contract acceptance and deposit receipts remain in the existing Engagement
panel, with its validation and immutable accepted terms. A contract reference
does not create a signature, acceptance record, invoice or payment receipt.
Without the reference, Finance retains contract-pending work. Cube does not
generate legal terms or substitute a made-up signed file.

A planning engagement receives a Delivery handoff item only when intake and
required creative review are confirmed, the real contract reference and
existing acceptance/deposit gate pass, and an active delivery owner exists.
The handoff does not start the engagement itself. Cube coordinates the
prerequisites; domain actions and their recorded outcomes stay authoritative.

## Automatic execution and persistence

Local demo mode evaluates on admin sign-in, source changes and every minute
while DeskDev is open, on every screen. Data is shared by the demo workspace
in `deskdev-cube-operations:v1:local`, distinct from the existing account-scoped
personal review journal. Web Locks serialize local operations across tabs
where supported; the fallback is a synchronous browser-storage update. Local
history is limited to 200 changes and is not a server audit log.

Remote mode uses migration `053_cube_operations.sql`. Its minute pg_cron job
calls `cube_tick()` without browser presence. Queue evaluation, routing,
resolution and change history are committed in one serialized transaction.
Keys are stable per department, subject type and source ID; repeated sweeps
update an existing item rather than create duplicate work or duplicate history.
An exception that resolves and later recurs starts a new open episode.
Escalation age starts when it becomes urgent, not when it first needed attention.

Source failures roll back evaluation and leave work unchanged, with a visible
error in `cube_control`. Paused departments preserve their queue state and
existing escalations; workspace pause stops evaluations. Configuration shares
the scheduler's serialization lock. Intake edits use an expected version and
project-row lock, including first saves. Concurrent edits are rejected and
the user's draft remains available.

Only active admins can read or control this release's shared operational
records. Members cannot read copied Finance or intake evidence. Signed-in
clients cannot directly alter queues, control rows or history; explicit admin
RPCs perform changes. The scheduler/service role is the trusted writer.
No service-role key is introduced in the browser or the site Worker.

## Integrations and boundaries

Cube uses current DeskDev entities and the existing `automation_health` view.
The integration queue describes registered automation run evidence; it is
not verification of every external account or Google permission.

Existing n8n/email/Google flows retain their current sending and sync behavior.
This release creates internal work and recorded escalations without adding
external messages, signing agreements, charging customers, publishing content,
deleting source work or changing access. Connecting additional accounts,
provider delivery acknowledgements, verified file uploads, structured capacity
data and automatic domain commands remain explicit follow-up implementation.

## Files and rollout

- `cube/operations.ts`: typed local rule evaluator and work lifecycle.
- `cube/operationsApi.ts`: local persistence and confirmed remote RPC adapter.
- `cube/OperationsRuntime.tsx`: app-wide local demo evaluation.
- `cube/OperationsBoard.tsx`: department controls, intake and work/history views.
- `supabase/migrations/053_cube_operations.sql`: durable shared queues, admin
  RPCs, versioned intake, history and minute scheduler.
- `supabase/tests/cube-operations.test.mjs`: throwaway-database permissions,
  lifecycle, scheduling, deduplication and source-failure scenarios.
- `site/playwright.cube-operations.config.ts`: isolated local production-mode
  browser proof on port 4187; videos and report under `cube-operations`.

Migration 053 is pending. Remote deployment and migration were not performed.
Apply pending migrations in ledger order only after the owner authorizes the
production rollout and the required release proof/gate is satisfied. Until
then, remote mode displays an installation error rather than silently using
local demo state.

## Validation on 2026-10-08

- TypeScript passed against the site configuration.
- All 26 focused Cube tests passed, including the existing personal review
  lifecycle and 12 automatic-operation/persistence scenarios.
- All 10 dedicated Cube database tests passed on throwaway PGlite, including
  clean migration application, repeated 053, scheduler registration, admin
  restrictions, sequence grants, source failure recovery and collection after
  project completion. Two targeted existing RLS/hardening checks also passed.
- All seven browser scenarios passed on the local production test-mode build:
  automatic queues/intake, pause/member restrictions, operation on other screens,
  corrupt storage preservation, and the existing three review-inbox scenarios.
  Videos and the HTML report are under `site/e2e-artifacts/cube-operations` and
  `site/e2e-report/cube-operations`. Additional scrolled screenshots are captured
  under `site/e2e-artifacts/cube-operations-visual`.
- Migration lint and n8n validation passed; all 117 repository-script tests passed.
- Shared-library drift remains in the pre-existing web/mobile `types.ts` and
  `db.ts`; this implementation does not change those modules.

The full database run reported existing RLS-hole detection, sequence-query and
immutable-message/profile-deletion failures. It also found a new grant-digest
regression; 053 now explicitly revokes the history sequence's API grants, and
the dedicated and existing hardening regression tests pass. The full application
suite finished with 1,452 passing, 10 failing and four skipped tests across 105
files. The failures are in the existing permission, error rendering/reporting
and crypto paths; all Cube tests passed. These results do not clear a production
release gate.
