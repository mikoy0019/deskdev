# Presence, item menus and collaborative whiteboards

Presence uses the existing private `deskdev-presence` topic. Visible interaction
marks a tab Active; five idle minutes or hiding the tab marks it Away. Any active
tab makes its user Active. Heartbeats run every 30 seconds; dated entries expire
after 90 seconds. Channel failures and browser offline events clear stale status
immediately on the affected device. Reconnection joins a fresh channel. Presence
is an advisory connection indicator, not an authorization mechanism.

Click a person in People to message them, copy their email or view profile
properties. Unambiguous person avatars offer the same actions when they are not
inside another button or link; their context menu also offers user actions.
Self menus link to Profile settings. Deactivated users cannot start new chats
through these menus.

Relevant items offer a DeskDev right-click menu with Properties, links and the
actions already available for that item. This covers tasks, project/client rows,
whiteboard cards, meetings, calendar pills, recordings, DM/channel messages,
course/CRM rows, lead rows and internal app links. Existing controls remain the
authority for permissions and deletion confirmation. Text inputs keep their
browser editing menu, and Excalidraw keeps its drawing context menu. Desktop
menus open at the pointer; phones retain the existing action sheets.

Whiteboard editors autosave at most one request at a time, starting after 650 ms
without indefinitely postponing continuous drawing. Remote save notifications
trigger authorized reads. A five-second reconciliation poll, focus and online
events recover missed notifications. Local mode uses storage events between
tabs. Migration 062 adds the board table to the existing Realtime publication;
it preserves migration 059's grants and RLS.

Scenes merge by element ID, version and a deterministic version-nonce tie break.
Deletion tombstones and image files are retained. Independent shapes survive
concurrent edits. Simultaneous changes to the same shape converge on one version;
this is not a history of every intermediate stroke. Undo history does not capture
remote updates. Version-conditional writes still protect the database row:
conflicts trigger a read, merge and retry, never a whole-board replacement.

Pending drawings are journaled before upload, scoped to the signed-in account,
board and tab. Refresh/reopen merges recovery copies with the saved board.
Acknowledgement clears only the editor's own slot. Other tabs' pending copies
are not erased. Storage failure is visible and asks the person to keep the tab
open until a save completes. Device recovery depends on browser storage remaining
available; the existing 5 MB server scene limit still applies.

## Rollout

Apply pending migrations in ledger order, including 061 and 062, before deploying
the corresponding site. Do not run `supabase db push`. No remote changes are part
of this implementation. Live Supabase Realtime delivery must be checked after an
authorized rollout; local browser fixtures cannot prove the provider connection.
Have all editors refresh after rollout so older clients stop using the previous
whole-scene conflict handling.

## Validation

Database tests pass (161), including publication idempotency, stale-write rejection
and inactive-user access. Repository script tests pass (118); migration, shared
library drift and n8n workflow checks pass. Focused presence and scene-session
tests pass (20), as do TypeScript checking and focused ESLint checks. Tests cover
channel failures, reconnects, concurrent writes, deletion tombstones,
edits during an upload and recovery journals.

The production Worker browser run passed all 12 checks (including authentication
setup): user actions, item menus, idle presence, live two-editor synchronization,
refresh recovery after a failed save, and the six prior revision flows. Videos
and the HTML report are saved locally under
`site/e2e-artifacts/realtime-workspace-complete` and
`site/e2e-report/realtime-workspace-complete/index.html`.

The full site unit run encountered seven failures in `errorPages.test.ts` and
`errorReporting.test.ts` and then stalled; it was stopped. A full-suite pass is
not claimed. Browser proof uses local-mode fixtures rather than production data.

Implementation follows Supabase's [Presence](https://supabase.com/docs/guides/realtime/presence)
and [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
contracts and the installed Excalidraw API definitions.
