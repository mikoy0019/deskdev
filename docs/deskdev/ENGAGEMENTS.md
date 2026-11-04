# Project engagements

The project detail page has an admin-only Engagement panel. It records agreements
and financial events from external tools; it does not sign contracts, send
invoices, collect payments, or give clients access to DeskDev.

1. Enter the currency, agreed fee, required deposit, and scope.
2. Record the acceptance date and evidence (signed document reference or client
   confirmation). Saving acceptance locks these terms. Contract amendments remain
   in the external contract tool for this first release.
3. Add milestones, issued invoice references, and confirmed payment receipts.
   Added records remain a draft until Save. Saved invoices and receipts cannot be
   changed or removed; corrections/refunds are outside this first release.
4. Start delivery once acceptance and the required deposit are recorded. A zero
   deposit is allowed when explicitly agreed. This is the engagement's delivery
   phase; the existing project/task board statuses are separate.
5. Record client approval evidence for each milestone, then complete delivery.
   Additional receipts can still be recorded after completion.

Amounts use integer minor units and a single currency per engagement. Collected
means recorded receipts, not issued invoices or estimated deal value. Outstanding
is issued invoices less receipts; not invoiced is agreed fee less issued invoices.
Invoices cannot exceed the agreed fee and a receipt cannot overpay its invoice.
Invoice and payment references are unique within an engagement.

Only active admins can read or save engagement records. Members with project
permissions do not receive financial rows. All remote mutations use the awaited
`save_project_engagement` RPC, with a version check and server-side validation;
direct table writes by authenticated callers are denied. Each successful save
appends before/after terms to the existing admin audit log. Conflicting edits
leave the draft intact and require explicitly reloading the saved version.

A project with engagement history, and its parent client, cannot be deleted.
Use their existing statuses instead. Remote deletes are confirmed before local
records are removed, including when a member cannot see the financial rows.

The originating lead is captured from the existing lead conversion activity
(`detail.project_id`) on first save and linked from the panel. The project links
the engagement to its client.
This is one engagement per project; it is not a standalone proposal management
system or a recurring billing engine.

## Local rollout

Local demo mode is available immediately. Remote mode requires migration 044 in
ledger order, after migration 043 (both applied to the live project on
2026-10-07). On a database without it, the panel reports that tracking is not
enabled and offers a retry. No remote migration or deployment
is part of this change.

Checks: normal site typecheck/unit tests, migration/throwaway database tests,
shared-lib drift and repository script checks. Browser proof:
`cd site && npx playwright test --config playwright.engagement.config.ts`.
This builds in test mode without production Supabase configuration, previews on
4184, and records videos under `site/e2e-artifacts/engagement`.

## Validation on 2026-10-06

- TypeScript passed against `site/tsconfig.json`.
- Focused application checks passed: 59 tests covering engagement validation,
  awaited saves, RPC confirmation, deletion retention, and existing store/session behavior.
- Migration and engagement database checks passed: 7 tests, including applying
  every migration, repeating 044, RLS, acceptance/deposit/approval gates and receipt history.
- Browser proof passed: 2 flows, recorded on a production test-mode build.
  The lifecycle flow also checks persistence after reload and a 390px viewport.
  Videos are in `site/e2e-artifacts/engagement`; the HTML report is
  `site/e2e-report/engagement/index.html`. These generated files remain ignored.
- Repository script tests passed: 117. Migration lint, n8n workflow checks,
  shared-lib drift (9 mirrored modules) and whitespace checks passed.

The full suites are not green. The database suite reports 114 passing and 3
failing tests. All 3 failures reproduce with the original security test file and
migrations only through 043: the intentional RLS-hole test no longer grants anon
access, the sequence-privilege query evaluates a non-sequence relation, and a
profile deletion trips the existing immutable-message trigger during FK cleanup.
The engagement-specific rows, permissions and checks pass.

The full site suite reports 1407 passing, 8 failing and 4 skipped tests. A focused
rerun reproduces the 8 failures in unchanged error-page/reporting and vault-crypto
tests (initial render/import timeouts with dependent assertions, and a crypto
timeout). They have not been suppressed or marked as passing.

This is a local implementation and browser proof, not completion of the
production 13-layer gate. At the time no deployment, remote secret change or
production data write was performed; migrations 043 and 044 were applied to the
live project later, on 2026-10-07, with 045–052 (supabase/README.md ledger).
