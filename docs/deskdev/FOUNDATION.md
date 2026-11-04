# DeskDev Studio — Data Layer API Reference

Reference for feature builders. The data layer lives in `site/src/deskdev/lib`, `site/src/deskdev/store`, `site/src/deskdev/data`.
Single import surface for state: `src/store/useStore.ts`.

> **Paths:** every `src/...` path below is relative to `site/src/deskdev/` (DeskDev's own root inside the site app), e.g. `src/lib/types.ts` is `site/src/deskdev/lib/types.ts`. The Expo app mirrors `lib/` in `mobile/src/lib` (`scripts/check-shared-drift.mjs`). This page covers the original core; newer slices (Growth leads, showcase, vault, chat, channels, push, Google) are documented in their own modules and `types.ts`.

**Golden rule: components MUST gate mutations with `can(user, feature, 'edit')`** (and gate visibility with `can(user, feature, 'view')`). Home + Notifications are open to all authenticated users. Admins implicitly pass every check.

---

## Modes

- **Local mode** (default, Supabase env vars unset): all state lives in `localStorage` (persist key `deskdev-store`, v1). Auth checks the local `users` slice (seed logins below). Every `db.*` call is a silent no-op.
- **Remote mode** (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set and a session exists): store actions still mutate local state optimistically, then fire-and-forget to Supabase (`public` schema). `hydrate()` replaces entity state from `db.fetchAll()`.
- `isSupabaseConfigured` is exported from `src/lib/supabase.ts`.

Seed logins (local mode): `admin@deskdev.local` / `admin` (admin, Maykie) and `member@deskdev.local` / `member` (member Alex Cruz — projects:edit, tasks:edit, clients:view, crm:none, calendar:view, meetings:edit).

---

## Types (`src/lib/types.ts`)

Entities (all camelCase, ISO timestamps): `User`, `ClientCategory`, `Client`, `ProjectCategory`, `Project`, `Task`, `TaskActivity`, `TimeEntry`, `CrmTable`, `CrmColumn` (+`CrmColumnType`, `CrmSelectOption`, `CrmCellValue`), `CrmRow`, `EventItem` (`kind: 'event' | 'meeting'`), `Notification`.

Unions: `Role` `'admin'|'member'` · `PermFeature` `'projects'|'tasks'|'clients'|'crm'|'calendar'|'meetings'` · `PermLevel` `'none'|'view'|'edit'` · `TaskStatus` `'todo'|'in_progress'|'blocked'|'done'` · `ProjectStatus` `'backlog'|'planning'|'in_progress'|'waiting'|'done'` · `Priority` `'low'|'med'|'high'` · `Engagement` `'full_time'|'part_time'|'gig_on_call'` · `ClientStatus` `'active'|'paused'|'ended'` · `Recurrence` `'none'|'daily'|'weekly'|'monthly'` · `NotificationType` (`task_assigned|task_updated|project_updated|client_updated|crm_updated|event_updated|meeting_updated|due_reminder|system`).

Notes: `User.password` exists only in local mode (never synced). `CrmRow.values` is keyed by column id; select cells store option ids, multi_select stores `string[]` of option ids. Date-only fields (`dueDate`, `entryDate`, `recurrenceUntil`, `startDate`) are `'YYYY-MM-DD'`.

## Permissions (`src/lib/permissions.ts`)

```ts
can(user: User | null | undefined, feature: PermFeature, level: 'view' | 'edit'): boolean
ALL_FEATURES: PermFeature[]
DEFAULT_MEMBER_PERMISSIONS: Record<PermFeature, PermLevel>   // all 'view'
```
`'edit'` grants also satisfy `'view'`. Null user → always false.

## Format helpers (`src/lib/format.ts`)

`fmtMoney(n?)` · `fmtDate(iso?)` · `fmtDateTime(iso?)` · `fmtTime(iso?)` · `fmtRelative(iso?)` · `fmtMinutes(mins)` (90 → `"1h 30m"`) · `isoDate(d?)` → `'YYYY-MM-DD'` local · `daysUntil(iso?)` · `initials(name)` · `avatarColor(seed)` (Tailwind bg class) · `classNames(...xs)`.

## EOD engine (`src/lib/eod.ts`)

```ts
buildEodReport(input: {
  client: Client; date: string;            // date = 'YYYY-MM-DD'
  tasks: Task[]; activity: TaskActivity[]; events: EventItem[];
  timeEntries: TimeEntry[]; users: User[]
}): string
```
Returns a plaintext, copy-paste ready report. Stable headers, empty sections skipped:
`END OF DAY REPORT — {client} — {date}` → `COMPLETED TODAY` → `IN PROGRESS` → `BLOCKED / WAITING` → `MEETINGS HELD` → `HOURS LOGGED` → `TOMORROW'S PRIORITIES`. Pass the full store slices — it filters by client/date itself.

## Supabase adapter (`src/lib/db.ts`, `src/lib/mappers.ts`)

Store actions already call these — features rarely need to. `db.insert(entity, obj)`, `db.update(entity, id, patch)`, `db.remove(entity, id)` (no-ops without config/session, `console.warn` on error, never throw), `db.fetchAll(): Promise<RemoteData | null>`. `mappers.ts` exports `TABLE_FOR` (entity → SQL table; `users` → `profiles`), `toRow`/`fromRow` + per-entity `rowToTask`/`taskToRow` etc.

---

## Store (`src/store/useStore.ts`)

```ts
const tasks = useStore((s) => s.tasks)
const user = useCurrentUser()             // User | null
```

### State fields

`users`, `currentUserId`, `clients`, `clientCategories`, `projects`, `projectCategories`, `tasks`, `taskActivity`, `timeEntries`, `crmTables`, `crmColumns`, `crmRows`, `events`, `notifications`, `settings: { autoArchiveDays: number /* 30 */, workspaceName: string }`, `hydrated: boolean`, `lastReminderCheck`, `remindedIds`.

### Lifecycle

- `hydrate(): Promise<void>` — call once at app mount. Remote: replaces entity state from `fetchAll()`. Always then runs `sweepAutoArchive()` + `checkDueReminders()` and sets `hydrated: true`.
- `resetSeed(): void` — restore all seed data.
- `updateSettings(patch: Partial<Settings>): void`

### Auth

- `login(email, password): Promise<{ ok: boolean; error?: string }>` — local: users slice; remote: `signInWithPassword` + profile load.
- `logout(): void`
- Sync user actions (store-only): `addUser(input: NewUser): string`, `updateUser(id, patch: Partial<User>)`, `deleteUser(id)`. `updateUser` also syncs the profiles row (own-row / admin UPDATE RLS — used by ProfileSection self-edits); `addUser`/`deleteUser` never write remotely (profiles has no INSERT/DELETE policy).
- Admin user management (Settings → Users — use these, not the sync actions): `adminCreateUser(NewUser)`, `adminUpdateUser(id, patch)`, `adminDeleteUser(id)`, all `Promise<AdminActionResult>` (`{ ok, id?, error? }`). Local mode delegates to the sync actions; remote mode calls the `admin-users` edge function via `src/lib/adminUsers.ts` (create waits for the server-issued auth id; update/delete apply optimistically and roll back on failure). Surface `error` with a toast — never silent.

### Entity CRUD (all optimistic local + fire-and-forget remote; `add*` returns the new id)

| Area | Actions |
|---|---|
| Clients | `addClient(NewClient)`, `updateClient(id, patch)`, `deleteClient(id)` (cascades projects/tasks/activity/time/CRM tables locally) |
| Client categories | `addClientCategory`, `updateClientCategory`, `deleteClientCategory` |
| Projects | `addProject(NewProject)`, `updateProject(id, patch)`, `moveProject(id, status, position)`, `deleteProject(id)` |
| Project categories | `addProjectCategory`, `updateProjectCategory`, `deleteProjectCategory` |
| Tasks | `addTask(NewTask)`, `updateTask(id, patch)`, `setTaskStatus(id, status)` (writes/clears `completedAt`, logs activity), `moveTask(id, status, position)`, `deleteTask(id)` |
| Time | `addTimeEntry(NewTimeEntry)`, `updateTimeEntry`, `deleteTimeEntry` |
| CRM | `addCrmTable`, `updateCrmTable`, `deleteCrmTable` (cascades cols/rows), `addCrmColumn` (a `sortOrder` inserts there and moves the later columns along), `updateCrmColumn`, `deleteCrmColumn`, `reorderColumns(tableId, orderedIds)`, `addCrmRow`, `updateCrmRow`, `deleteCrmRow`, `setCellValue(rowId, columnId, value: CrmCellValue)`. Column types include `person` (a user id) and `formula` (`column.formula`, worked out per row by `lib/crmFormula.ts`, never stored in rows); `column.width` is the dragged width (057) |
| Events | `addEvent(NewEvent)`, `updateEvent(id, patch)`, `deleteEvent(id)` |
| Notifications | `notify(NotifyInput)`, `markRead(id)`, `markAllRead()` (current user's), `deleteNotification(id)` |

`New*` input types are exported from `useStore.ts` — generated/defaultable fields (`id`, timestamps, `status`, `position`, `priority`, `kind`, `recurrence`, ...) are optional. `createdBy`/`userId` default to the current user.

Whiteboard revision additions (061): `Task.coverUrl` stores an HTTPS card image.
`addTaskComment(taskId, body): Promise<boolean>` appends an `updated` activity
with `detail.comment`; `<@userId>` tokens notify eligible task readers. Wait for
success before clearing a comment draft. `sendMessageConfirmed` accepts an
optional third argument, `replyToId`, scoped to the same conversation.
`importOljLinks(urls)` returns `{added, skipped, failed}`; `saveJobApplication`
confirms persistence of a posting's description and `application` data. Both
require Growth edit. See [whiteboard revisions](WHITEBOARD-REVISIONS-2026-10.md)
for UI behavior and rollout order.

Task activity is logged automatically on `created` / `status_changed` / `assigned` / `completed` / `deleted` — feed `taskActivity` straight into `buildEodReport`.

### Built-in notification fan-out (automatic — do not duplicate in components)

- Task assigned → assignee gets `task_assigned` (self skipped).
- Every add/update/delete on clients / projects / tasks / CRM tables+rows / events → all **admins** except the actor (`*_updated`, short human sentences, e.g. `"Alex moved task 'X' to In Progress"`). Per-cell `setCellValue` edits and position-only drags (`moveTask` with unchanged status, `reorderColumns`) intentionally don't notify (spam guard).
- `checkDueReminders()` — idempotent per day (`lastReminderCheck` + `remindedIds` persisted): tasks due today/tomorrow → assignee (or all admins if unassigned); meetings starting within 24h → creator + admins. Runs inside `hydrate()`.
- `sweepAutoArchive()` — archives done tasks older than `settings.autoArchiveDays` (`archived: true`, data kept for EOD history). Runs inside `hydrate()`.

### Calendar occurrences

```ts
getEventOccurrences(events: EventItem[], rangeStart: Date | string, rangeEnd: Date | string): EventOccurrence[]
// EventOccurrence = { event, startsAt, endsAt?, occurrenceId /* `${event.id}:${YYYY-MM-DD}` */ }
```
Materializes `daily|weekly|monthly` recurrences (bounded by `recurrenceUntil`) into concrete occurrences, sorted by start — recurring events are stored once, never duplicated. Use this for every calendar/agenda render.

---

## SHARED KIT (`src/components/`)

- **`ConfirmDialog`** (default) — `{ open, title, message, confirmLabel?='Confirm', danger?, onConfirm, onClose }` — confirm modal on Modal; calls `onConfirm()` then `onClose()`; `danger` makes the confirm button rose. Use for every delete.
- **`pickers.tsx`** (named exports, all `.input`-styled + controlled; empty-choice selects emit `undefined`, ClientSelect uses `''`):
  - `ClientSelect { value: string, onChange(id: string), allowAll?, allowNone?, autoFocus? }` — sorted clients w/ status dot; `''` = All clients / No client.
  - `AssigneeSelect { value: string|undefined, onChange(id: string|undefined), allowUnassigned? }` — users as "fullName (role)".
  - `ProjectCategorySelect { clientId: string|undefined, value, onChange(id|undefined), allowNone? }` — that client's categories only; disabled "Select a client first" hint when no client.
  - `ClientCategorySelect { value, onChange(id|undefined), allowNone? }`.
  - `PrioritySelect | ProjectStatusSelect | TaskStatusSelect | EngagementSelect | RecurrenceSelect` — `{ value: <enum>, onChange(v: <enum>) }` with human labels.
  - `DateField { value?: 'YYYY-MM-DD', onChange(v: string|undefined), min? }` · `DateTimeField { valueIso?: string, onChange(iso: string|undefined) }` (full ISO in/out).
- **`TimeLogModal`** (default) — `{ open, onClose, task: Task }` — quick chips 15/30/60/120 + custom minutes, date (default today), note → `addTimeEntry`; lists that task's entries w/ user name + total; delete own entries (admins any) via ConfirmDialog. Form gated by `can(user,'tasks','edit')`.
- **`EodReportModal`** (default) — `{ open, onClose, defaultClientId?, defaultDate? }` — ClientSelect + DateField, live `buildEodReport` preview in mono `pre`, footer shows day's hours total + "Copy report" (clipboard + toast).
- **`EmptyState`** (default) — `{ icon: LucideIcon, title, hint?, action?: ReactNode }` — centered friendly empty card.
- **`StatCard`** (default) — `{ label, value, icon: LucideIcon, accent?='brand' ('brand'|'emerald'|'amber'|'violet'|'rose'|'sky'|'teal'), sub?, to? }` — dashboard stat tile; renders as `<Link>` when `to` set.
- **`KanbanBoard<T extends { id: string }>`** (default) — `{ columns: KanbanColumn[], items: T[], getColumn(item): string, renderCard(item): ReactNode, onMove(item, toKey), onCardClick?(item), columnFooter?(key): ReactNode, canMove?=true }` — generic kanban (HTML5 drag + "Move to…" select for touch). `KanbanColumn = { key, title, accent? /* tailwind bg class for header dot */ }`. Pass `canMove={can(user, feature, 'edit')}` so view-only users get no drag/move affordances (added at integration; Projects/Tasks/Meetings do this).

---

## Build notes (integration pass)

- `App.tsx` lazy-loads Projects, ProjectDetail, CrmTables, CrmTableDetail, CalendarPage, Meetings, Settings via `React.lazy` + a `Suspense` fallback inside `gated()`; keep new heavy routes lazy the same way.
- Bundling is the site's (`next build`, Turbopack); there is no DeskDev-specific `manualChunks` split any more. Route-level `lazy()` is what keeps the first load small.
