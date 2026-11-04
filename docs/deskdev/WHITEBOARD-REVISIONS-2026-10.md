# DeskDev whiteboard revisions

Source: the owner's **Revisions DESKDEV -JOEL** whiteboard,
`89238182-cf44-466e-bc3b-f7e500747eef`, saved 2026-10-09. The captured source
and rendered overview are in `.devswarm-temp/whiteboard-review/`.

## Behavior

| Request | Implementation |
| --- | --- |
| Join meetings from the board and Home | Meeting cards expose the saved HTTP(S) URL in a new tab. Zoom and other providers work alongside Meet. Home's existing Today card retains its Join action. |
| More comprehensive left navigation | The space rail sits to the left of the sidebar. Messages, Channels, Growth applications and active project shortcuts appear in the detailed navigation, subject to permissions. Mobile keeps its drawer. |
| Task list and right-side details | Board/List switches preserve the current filters in the URL. List includes subtasks and older completed tasks. Saved task details use a full-height desktop side panel and the existing mobile sheet; descriptions have a larger editor. |
| Task comments and mentions | Comments append to task activity and survive refresh. The mention picker writes existing `<@userId>` tokens; active task readers receive one notification per comment that names them. Failed writes retain the draft. |
| Task context menu | Right-click or use the actions button to change a card image, duplicate a task with subtasks, create a follow-up, complete/reopen, add a subtask, convert between task/subtask, open details/new tab, copy the link or confirm deletion. Completion still respects open subtasks. |
| DM replies and continuous composition | Replies retain their original message reference and cannot cross conversations. Reply messages survive deletion of the original. Sending keeps the textarea focusable, then returns focus after acknowledgement. |
| OLJ application workflow | `/workspace/growth/applications` accepts up to 50 posting links, canonicalizes and deduplicates them, and saves per-posting source text, CV, draft and status in existing job records. |
| Channel push | Signed-in channel posts create notifications in the insert transaction for eligible active readers, excluding the sender. Mentions/replies receive their appropriate titles. The existing notification push dispatcher and recipient preferences handle delivery. Historical operator imports do not notify. |

The OLJ assistant is a local rule-based preparation tool. It identifies matching
topics and missing evidence and prioritizes verbatim CV lines. It does not use
an external language model, retrieve job pages or submit applications. Users
paste the actual listing and review/edit the draft before applying. Saved CV
material is visible to teammates with Growth access, as stated in the editor.

## Persistence and rollout

Migration `061_whiteboard_revisions.sql` adds task covers, same-conversation DM
reply references, application draft storage, an authenticated OLJ import policy,
and comment/channel notification triggers. It reuses existing RLS-protected
tables and the approved notification vocabulary. New trigger functions have a
fixed search path and no direct caller grants.

Apply 061 in ledger order **before** deploying the site. Do not use
`supabase db push`. Refresh old clients after rollout: older clients also emit
their own mention notifications, while the revised client delegates that work
to the server. The migration remains pending; no production changes have been
made for this revision implementation.

Web/mobile data contracts and store actions are mirrored, including the new
application preparation helper in the shared-file check.

## Validation

- TypeScript checks passed.
- Focused revision store/helper tests: 10 passed.
- Full site suite: 1,741 passed, four skipped; seven failures followed slow
  imports in the existing error-page/error-reporting suites under memory
  pressure. Those two files passed all 10 tests when rerun with one worker.
- Database suite: 158 passed on throwaway PGlite, including notification
  recipient boundaries, spoofed comment rejection, same-conversation replies,
  deletion behavior, HTTPS covers, OLJ import RLS and repeatable migration.
- Repository script suite: 118 passed.
- Shared-file drift, migration checks and all 14 n8n workflow checks passed.
- ESLint passed for the new task components, application page/helper and
  revision store tests.

Recorded browser proof: all 18 flows passed, covering the new revisions and
existing chat/task behavior. Videos are under
`site/e2e-artifacts/whiteboard-revisions-final/`; the HTML report is
`site/e2e-report/whiteboard-revisions-final/index.html`. The first pass found
and fixed duplicate React keys in task details and an unstable generated-CV
label. These runs use local fixtures and a production Worker preview; they do
not establish live database or push-provider delivery.

After the final task-link fix (respecting both workspace hosting paths), a
fresh production preview passed all seven focused browser checks, including
authentication setup. Its videos and report are under
`site/e2e-artifacts/whiteboard-revisions-reviewed/` and
`site/e2e-report/whiteboard-revisions-reviewed/index.html`. The final helper,
store and URL-path unit checks passed all 18 tests; the six migration-specific
database tests also passed after the legacy activity guard adjustment.
