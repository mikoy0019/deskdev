import type {
  User, ClientCategory, Client, ProjectCategory, Project,
  Task, TaskActivity, TimeEntry,
  CrmTable, CrmColumn, CrmRow,
  EventItem, Notification, Campaign, Lead, JobPosting, LeadActivity,
  ChannelCategory, Channel, ChannelMessage, ShowcaseItem,
  RecordingFolder, MeetingRecording,
} from '../lib/types'
import { isoDate } from '../lib/format'

// Today-anchored dates so the UI always looks fresh
const now = new Date()

/** ISO timestamp offset from today */
const d = (offsetDays: number, hour = 9): string => {
  const x = new Date(now)
  x.setDate(x.getDate() + offsetDays)
  x.setHours(hour, 0, 0, 0)
  return x.toISOString()
}

/** ISO timestamp `offsetMinutes` from now — for SLA clocks measured in minutes. */
const mins = (offsetMinutes: number): string => new Date(now.getTime() + offsetMinutes * 60_000).toISOString()

/** Date-only 'YYYY-MM-DD' offset from today */
const day = (offsetDays: number): string => {
  const x = new Date(now)
  x.setDate(x.getDate() + offsetDays)
  return isoDate(x)
}

// ─── Users ──────────────────────────────────────────────────────────────────

export const seedUsers: User[] = [
  {
    id: 'u-admin',
    email: 'admin@deskdev.local',
    fullName: 'Maykie',
    title: 'Founder',
    avatarColor: 'bg-violet-500',
    role: 'admin',
    permissions: {},
    password: 'admin',
    createdAt: d(-120),
  },
  {
    id: 'u-member',
    email: 'member@deskdev.local',
    fullName: 'Alex Cruz',
    title: 'Developer',
    avatarColor: 'bg-emerald-500',
    role: 'member',
    permissions: {
      projects: 'edit',
      tasks: 'edit',
      clients: 'view',
      crm: 'none',
      calendar: 'view',
      meetings: 'edit',
      courses: 'view',
    },
    password: 'member',
    createdAt: d(-60),
  },
]

// ─── Client categories ──────────────────────────────────────────────────────

export const seedClientCategories: ClientCategory[] = [
  { id: 'cc-agency', name: 'Agency', color: '#8b5cf6', sortOrder: 0, createdAt: d(-90) },
  { id: 'cc-startup', name: 'Startup', color: '#0ea5e9', sortOrder: 1, createdAt: d(-90) },
  { id: 'cc-local', name: 'Local Business', color: '#10b981', sortOrder: 2, createdAt: d(-90) },
]

// ─── Clients ────────────────────────────────────────────────────────────────

export const seedClients: Client[] = [
  {
    id: 'cl-northwind',
    name: 'Northwind Digital',
    company: 'Northwind Digital LLC',
    email: 'ops@northwind.digital',
    phone: '555-0101',
    categoryId: 'cc-agency',
    engagement: 'full_time',
    status: 'active',
    timezone: 'America/New_York',
    color: '#8b5cf6',
    notes: 'White-label dev partner. Weekly sync Mondays 10am.',
    createdAt: d(-80),
    updatedAt: d(-2),
  },
  {
    id: 'cl-brightloop',
    name: 'BrightLoop',
    company: 'BrightLoop Inc',
    email: 'sam@brightloop.io',
    phone: '555-0202',
    categoryId: 'cc-startup',
    engagement: 'part_time',
    status: 'active',
    timezone: 'America/Los_Angeles',
    color: '#0ea5e9',
    notes: 'Seed-stage fintech. 20h/week retainer, mobile-first.',
    createdAt: d(-55),
    updatedAt: d(-1),
  },
  {
    id: 'cl-casapalma',
    name: 'Casa Palma Cafe',
    company: 'Casa Palma',
    email: 'hello@casapalma.ph',
    phone: '555-0303',
    categoryId: 'cc-local',
    engagement: 'gig_on_call',
    status: 'active',
    timezone: 'Asia/Manila',
    color: '#10b981',
    notes: 'Branding + social gigs, project-based billing.',
    createdAt: d(-40),
    updatedAt: d(-3),
  },
  {
    id: 'cl-vertex',
    name: 'Vertex Realty',
    company: 'Vertex Realty Group',
    email: 'admin@vertexrealty.com',
    categoryId: 'cc-agency',
    engagement: 'gig_on_call',
    status: 'paused',
    timezone: 'America/Chicago',
    color: '#f59e0b',
    notes: 'Engagement paused until August — budget review.',
    createdAt: d(-100),
    updatedAt: d(-10),
  },
]

// ─── Project categories ─────────────────────────────────────────────────────

export const seedProjectCategories: ProjectCategory[] = [
  { id: 'pc-nw-web', clientId: 'cl-northwind', name: 'Web Builds', color: '#8b5cf6', sortOrder: 0 },
  { id: 'pc-nw-seo', clientId: 'cl-northwind', name: 'SEO', color: '#f43f5e', sortOrder: 1 },
  { id: 'pc-nw-maint', clientId: 'cl-northwind', name: 'Maintenance', color: '#64748b', sortOrder: 2 },
  { id: 'pc-bl-app', clientId: 'cl-brightloop', name: 'Mobile App', color: '#0ea5e9', sortOrder: 0 },
  { id: 'pc-bl-site', clientId: 'cl-brightloop', name: 'Marketing Site', color: '#14b8a6', sortOrder: 1 },
  { id: 'pc-cp-brand', clientId: 'cl-casapalma', name: 'Branding', color: '#10b981', sortOrder: 0 },
  { id: 'pc-cp-social', clientId: 'cl-casapalma', name: 'Social Media', color: '#f97316', sortOrder: 1 },
  { id: 'pc-vx-web', clientId: 'cl-vertex', name: 'Website', color: '#f59e0b', sortOrder: 0 },
  { id: 'pc-vx-crm', clientId: 'cl-vertex', name: 'CRM Setup', color: '#a855f7', sortOrder: 1 },
]

// ─── Projects ───────────────────────────────────────────────────────────────

export const seedProjects: Project[] = [
  {
    id: 'pr-portal', clientId: 'cl-northwind', categoryId: 'pc-nw-web',
    title: 'Client portal redesign', status: 'in_progress',
    startDate: day(-14), dueDate: day(14), budget: 8500,
    notes: 'Dashboard, auth, billing pages. Weekly demos.',
    assigneeId: 'u-member', position: 0, createdBy: 'u-admin',
    createdAt: d(-14), updatedAt: d(0, 8),
  },
  {
    id: 'pr-seo', clientId: 'cl-northwind', categoryId: 'pc-nw-seo',
    title: 'Q3 SEO audit', status: 'planning',
    startDate: day(3), dueDate: day(21), budget: 1800,
    assigneeId: 'u-admin', position: 1, createdBy: 'u-admin',
    createdAt: d(-5), updatedAt: d(-5),
  },
  {
    id: 'pr-maint', clientId: 'cl-northwind', categoryId: 'pc-nw-maint',
    title: 'Monthly maintenance retainer', status: 'in_progress',
    budget: 900, notes: 'Uptime, SSL, plugin updates across 6 sites.',
    assigneeId: 'u-admin', position: 2, createdBy: 'u-admin',
    createdAt: d(-60), updatedAt: d(0, 10),
  },
  {
    id: 'pr-iosv2', clientId: 'cl-brightloop', categoryId: 'pc-bl-app',
    title: 'iOS app v2.0', status: 'in_progress',
    startDate: day(-21), dueDate: day(10), budget: 12000,
    notes: 'Push notifications, payments, App Store re-submission.',
    assigneeId: 'u-admin', position: 0, createdBy: 'u-admin',
    createdAt: d(-21), updatedAt: d(0, 14),
  },
  {
    id: 'pr-landing', clientId: 'cl-brightloop', categoryId: 'pc-bl-site',
    title: 'Launch landing page', status: 'waiting',
    dueDate: day(7), budget: 2400,
    notes: 'Waiting on final copy from their marketing lead.',
    assigneeId: 'u-member', position: 1, createdBy: 'u-admin',
    createdAt: d(-8), updatedAt: d(-1),
  },
  {
    id: 'pr-menu', clientId: 'cl-casapalma', categoryId: 'pc-cp-brand',
    title: 'Menu redesign', status: 'done',
    startDate: day(-20), dueDate: day(-2), budget: 650,
    assigneeId: 'u-member', position: 0, createdBy: 'u-admin',
    createdAt: d(-20), updatedAt: d(-1, 16),
  },
  {
    id: 'pr-insta', clientId: 'cl-casapalma', categoryId: 'pc-cp-social',
    title: 'Instagram content engine', status: 'backlog',
    dueDate: day(30), budget: 1200,
    notes: 'Templates + 2-week content calendar to start.',
    position: 1, createdBy: 'u-admin',
    createdAt: d(-4), updatedAt: d(-4),
  },
  {
    id: 'pr-listings', clientId: 'cl-vertex', categoryId: 'pc-vx-web',
    title: 'Listings website rebuild', status: 'backlog',
    budget: 9500, notes: 'On hold with the engagement — scope agreed.',
    position: 0, createdBy: 'u-admin',
    createdAt: d(-35), updatedAt: d(-10),
  },
]

// ─── Tasks ──────────────────────────────────────────────────────────────────

export const seedTasks: Task[] = [
  { id: 't-dash', clientId: 'cl-northwind', projectId: 'pr-portal', title: 'Ship dashboard layout', status: 'in_progress', priority: 'high', dueDate: day(0), assigneeId: 'u-member', collaboratorIds: ['u-admin'], position: 0, archived: false, createdBy: 'u-admin', createdAt: d(-6), updatedAt: d(0, 9) },
  { id: 't-auth', clientId: 'cl-northwind', projectId: 'pr-portal', title: 'Wire up auth flow', status: 'todo', priority: 'high', dueDate: day(1), assigneeId: 'u-member', position: 1, archived: false, createdBy: 'u-admin', createdAt: d(-6), updatedAt: d(-6) },
  { id: 't-nav', clientId: 'cl-northwind', projectId: 'pr-portal', title: 'Fix mobile nav overlap', status: 'done', priority: 'med', assigneeId: 'u-member', position: 2, archived: false, completedAt: d(0, 15), createdBy: 'u-admin', createdAt: d(-3), updatedAt: d(0, 15) },
  { id: 't-qa', clientId: 'cl-northwind', projectId: 'pr-portal', title: 'QA checklist pass', status: 'todo', priority: 'med', dueDate: day(2), assigneeId: 'u-member', position: 3, archived: false, createdBy: 'u-admin', createdAt: d(-2), updatedAt: d(-2) },
  { id: 't-kw', clientId: 'cl-northwind', projectId: 'pr-seo', title: 'Pull keyword rankings', status: 'todo', priority: 'med', dueDate: day(3), assigneeId: 'u-admin', position: 0, archived: false, createdBy: 'u-admin', createdAt: d(-4), updatedAt: d(-4) },
  { id: 't-ssl', clientId: 'cl-northwind', projectId: 'pr-maint', title: 'Renew SSL certs', status: 'done', priority: 'low', assigneeId: 'u-admin', position: 0, archived: false, completedAt: d(0, 10), createdBy: 'u-admin', createdAt: d(-2), updatedAt: d(0, 10) },
  { id: 't-push', clientId: 'cl-brightloop', projectId: 'pr-iosv2', title: 'Integrate push notifications', status: 'in_progress', priority: 'high', dueDate: day(2), assigneeId: 'u-admin', position: 0, archived: false, createdBy: 'u-admin', createdAt: d(-5), updatedAt: d(0, 14) },
  { id: 't-crash', clientId: 'cl-brightloop', projectId: 'pr-iosv2', title: 'Fix crash on payment screen', status: 'blocked', priority: 'high', dueDate: day(0), assigneeId: 'u-admin', notes: 'Waiting on Stripe sandbox access from client', position: 1, archived: false, createdBy: 'u-admin', createdAt: d(-3), updatedAt: d(0, 14) },
  { id: 't-copy', clientId: 'cl-brightloop', projectId: 'pr-landing', title: 'Review landing copy', status: 'todo', priority: 'med', dueDate: day(1), assigneeId: 'u-member', position: 0, archived: false, createdBy: 'u-admin', createdAt: d(-1, 17), updatedAt: d(-1, 17) },
  { id: 't-shots', clientId: 'cl-brightloop', projectId: 'pr-iosv2', title: 'App Store screenshots', status: 'todo', priority: 'low', dueDate: day(6), position: 2, archived: false, createdBy: 'u-admin', createdAt: d(-2), updatedAt: d(-2) },
  { id: 't-menu', clientId: 'cl-casapalma', projectId: 'pr-menu', title: 'Print-ready menu PDF', status: 'done', priority: 'med', assigneeId: 'u-member', position: 0, archived: false, completedAt: d(-1, 16), createdBy: 'u-admin', createdAt: d(-8), updatedAt: d(-1, 16) },
  { id: 't-cal', clientId: 'cl-casapalma', projectId: 'pr-insta', title: 'Draft 2-week content calendar', status: 'todo', priority: 'med', dueDate: day(4), assigneeId: 'u-member', position: 0, archived: false, createdBy: 'u-admin', createdAt: d(-3), updatedAt: d(-3) },
  { id: 't-hours', clientId: 'cl-casapalma', title: 'Update Google Business hours', status: 'todo', priority: 'low', dueDate: day(1), position: 1, archived: false, createdBy: 'u-admin', createdAt: d(-1), updatedAt: d(-1) },
  { id: 't-assets', clientId: 'cl-vertex', projectId: 'pr-listings', title: 'Collect brand assets', status: 'blocked', priority: 'med', notes: 'Client paused engagement until August', position: 0, archived: false, createdBy: 'u-admin', createdAt: d(-30), updatedAt: d(-10) },
]

// ─── Task activity (today) ──────────────────────────────────────────────────

export const seedTaskActivity: TaskActivity[] = [
  { id: 'ta-1', taskId: 't-dash', clientId: 'cl-northwind', actorId: 'u-member', action: 'status_changed', detail: { from: 'todo', to: 'in_progress', note: 'Dashboard grid + sidebar done, polishing responsive states' }, createdAt: d(0, 9) },
  { id: 'ta-2', taskId: 't-nav', clientId: 'cl-northwind', actorId: 'u-member', action: 'status_changed', detail: { from: 'in_progress', to: 'done' }, createdAt: d(0, 15) },
  { id: 'ta-3', taskId: 't-nav', clientId: 'cl-northwind', actorId: 'u-member', action: 'completed', detail: { title: 'Fix mobile nav overlap' }, createdAt: d(0, 15) },
  { id: 'ta-4', taskId: 't-ssl', clientId: 'cl-northwind', actorId: 'u-admin', action: 'status_changed', detail: { from: 'todo', to: 'done' }, createdAt: d(0, 10) },
  { id: 'ta-5', taskId: 't-ssl', clientId: 'cl-northwind', actorId: 'u-admin', action: 'completed', detail: { title: 'Renew SSL certs' }, createdAt: d(0, 10) },
  { id: 'ta-6', taskId: 't-push', clientId: 'cl-brightloop', actorId: 'u-admin', action: 'status_changed', detail: { from: 'todo', to: 'in_progress', note: 'FCM wired on Android, iOS APNs cert pending' }, createdAt: d(0, 14) },
  { id: 'ta-7', taskId: 't-crash', clientId: 'cl-brightloop', actorId: 'u-admin', action: 'status_changed', detail: { from: 'in_progress', to: 'blocked', note: 'Blocked on Stripe sandbox credentials' }, createdAt: d(0, 14) },
]

// ─── Time entries (today + yesterday, two clients) ──────────────────────────

export const seedTimeEntries: TimeEntry[] = [
  { id: 'te-1', taskId: 't-dash', clientId: 'cl-northwind', userId: 'u-member', entryDate: day(0), minutes: 180, createdAt: d(0, 13) },
  { id: 'te-2', taskId: 't-nav', clientId: 'cl-northwind', userId: 'u-member', entryDate: day(0), minutes: 90, createdAt: d(0, 15) },
  { id: 'te-3', taskId: 't-push', clientId: 'cl-brightloop', userId: 'u-admin', entryDate: day(0), minutes: 120, createdAt: d(0, 16) },
  { id: 'te-4', taskId: 't-crash', clientId: 'cl-brightloop', userId: 'u-admin', entryDate: day(0), minutes: 45, note: 'Debugging payment crash', createdAt: d(0, 16) },
  { id: 'te-5', taskId: 't-dash', clientId: 'cl-northwind', userId: 'u-member', entryDate: day(-1), minutes: 150, createdAt: d(-1, 17) },
  { id: 'te-6', taskId: 't-push', clientId: 'cl-brightloop', userId: 'u-admin', entryDate: day(-1), minutes: 90, createdAt: d(-1, 18) },
]

// ─── CRM: Leads Tracker ─────────────────────────────────────────────────────

export const seedCrmTables: CrmTable[] = [
  { id: 'crm-leads', name: 'Leads Tracker', color: '#0ea5e9', createdBy: 'u-admin', createdAt: d(-20), updatedAt: d(0, 8) },
]

export const seedCrmColumns: CrmColumn[] = [
  { id: 'col-name', tableId: 'crm-leads', name: 'Name', type: 'text', options: [], sortOrder: 0 },
  {
    id: 'col-stage', tableId: 'crm-leads', name: 'Stage', type: 'select', sortOrder: 1,
    options: [
      { id: 'st-new', label: 'New', color: '#0ea5e9' },
      { id: 'st-contacted', label: 'Contacted', color: '#f59e0b' },
      { id: 'st-proposal', label: 'Proposal', color: '#8b5cf6' },
      { id: 'st-won', label: 'Won', color: '#10b981' },
      { id: 'st-lost', label: 'Lost', color: '#f43f5e' },
    ],
  },
  { id: 'col-value', tableId: 'crm-leads', name: 'Deal Value', type: 'number', options: [], sortOrder: 2 },
  {
    id: 'col-tags', tableId: 'crm-leads', name: 'Tags', type: 'multi_select', sortOrder: 3,
    options: [
      { id: 'tg-web', label: 'Web', color: '#8b5cf6' },
      { id: 'tg-mobile', label: 'Mobile', color: '#0ea5e9' },
      { id: 'tg-seo', label: 'SEO', color: '#f43f5e' },
      { id: 'tg-retainer', label: 'Retainer', color: '#10b981' },
    ],
  },
  { id: 'col-follow', tableId: 'crm-leads', name: 'Follow-up', type: 'date', options: [], sortOrder: 4 },
  { id: 'col-hot', tableId: 'crm-leads', name: 'Hot Lead', type: 'checkbox', options: [], sortOrder: 5 },
  { id: 'col-site', tableId: 'crm-leads', name: 'Website', type: 'url', options: [], sortOrder: 6 },
  {
    id: 'col-source', tableId: 'crm-leads', name: 'Source', type: 'select', sortOrder: 7,
    // Acquisition channel — powers the Growth Hub source breakdown + source ROI.
    options: [
      { id: 'src-seo', label: 'SEO', color: '#f43f5e' },
      { id: 'src-referral', label: 'Referral', color: '#10b981' },
      { id: 'src-linkedin', label: 'LinkedIn', color: '#0ea5e9' },
      { id: 'src-outbound', label: 'Outbound', color: '#f59e0b' },
      { id: 'src-other', label: 'Other', color: '#8b5cf6' },
    ],
  },
]

export const seedCrmRows: CrmRow[] = [
  { id: 'row-1', tableId: 'crm-leads', position: 0, createdBy: 'u-admin', createdAt: d(-18), updatedAt: d(0, 8), values: { 'col-name': 'Harbor Dental', 'col-stage': 'st-proposal', 'col-value': 4500, 'col-tags': ['tg-web'], 'col-follow': day(1), 'col-hot': true, 'col-site': 'https://harbordental.com', 'col-source': 'src-referral' } },
  { id: 'row-2', tableId: 'crm-leads', position: 1, createdBy: 'u-admin', createdAt: d(-15), updatedAt: d(-2), values: { 'col-name': 'Peak Fitness', 'col-stage': 'st-contacted', 'col-value': 2800, 'col-tags': ['tg-web', 'tg-seo'], 'col-follow': day(3), 'col-hot': false, 'col-site': 'https://peakfitness.io', 'col-source': 'src-seo' } },
  { id: 'row-3', tableId: 'crm-leads', position: 2, createdBy: 'u-admin', createdAt: d(-12), updatedAt: d(-1), values: { 'col-name': 'Lumen Legal', 'col-stage': 'st-new', 'col-value': 7200, 'col-tags': ['tg-web', 'tg-retainer'], 'col-follow': day(2), 'col-hot': true, 'col-site': 'https://lumenlegal.co', 'col-source': 'src-linkedin' } },
  { id: 'row-4', tableId: 'crm-leads', position: 3, createdBy: 'u-admin', createdAt: d(-10), updatedAt: d(-4), values: { 'col-name': 'Sprout Grocers', 'col-stage': 'st-won', 'col-value': 3600, 'col-tags': ['tg-mobile'], 'col-follow': null, 'col-hot': false, 'col-site': 'https://sproutgrocers.com', 'col-source': 'src-outbound' } },
  { id: 'row-5', tableId: 'crm-leads', position: 4, createdBy: 'u-admin', createdAt: d(-8), updatedAt: d(-5), values: { 'col-name': 'Atlas Tours', 'col-stage': 'st-lost', 'col-value': 1500, 'col-tags': ['tg-seo'], 'col-follow': null, 'col-hot': false, 'col-site': 'https://atlastours.ph', 'col-source': 'src-seo' } },
  { id: 'row-6', tableId: 'crm-leads', position: 5, createdBy: 'u-admin', createdAt: d(-2), updatedAt: d(0, 8), values: { 'col-name': 'Nimbus HR', 'col-stage': 'st-contacted', 'col-value': 5400, 'col-tags': ['tg-web', 'tg-mobile'], 'col-follow': day(1), 'col-hot': true, 'col-site': 'https://nimbushr.com', 'col-source': 'src-linkedin' } },
]

// ─── Growth: outbound campaigns (manual tracker) ────────────────────────────

export const seedCampaigns: Campaign[] = [
  { id: 'cmp-1', name: 'Q3 Dental Outreach', channel: 'email', status: 'active', contacted: 40, opens: 22, replies: 6, positive: 3, weekOf: day(-1), ownerId: 'u-admin', createdAt: d(-6), updatedAt: d(0, 8) },
  { id: 'cmp-2', name: 'LinkedIn SaaS Founders', channel: 'linkedin', status: 'active', contacted: 25, opens: 0, replies: 4, positive: 2, weekOf: day(-1), ownerId: 'u-admin', createdAt: d(-5), updatedAt: d(0, 8) },
  { id: 'cmp-3', name: 'Cold Call — Local Retail', channel: 'cold_call', status: 'paused', contacted: 18, opens: 0, replies: 2, positive: 1, weekOf: day(-1), ownerId: 'u-member', createdAt: d(-4), updatedAt: d(-1) },
  { id: 'cmp-4', name: 'August Newsletter', channel: 'email', status: 'done', contacted: 120, opens: 54, replies: 9, positive: 4, weekOf: day(-8), ownerId: 'u-admin', createdAt: d(-12), updatedAt: d(-8) },
]

// ─── Growth: leads (Growth Hub's own pipeline — separate from Operations CRM) ─

export const seedLeads: Lead[] = [
  // firstRespondedAt/lastTouchAt drive speed-to-lead + "going cold". ld-2 is
  // deliberately stale (touched 9 days ago) so the cold detection has a subject.
  { id: 'ld-1', name: 'Harbor Dental', company: 'Harbor Dental', email: 'ops@harbordental.com', stage: 'proposal', value: 4500, source: 'referral', followUp: day(1), hot: true, firstRespondedAt: d(-18, 11), lastTouchAt: d(-1), createdAt: d(-18), updatedAt: d(0, 8) },
  { id: 'ld-2', name: 'Peak Fitness', company: 'Peak Fitness', email: 'hello@peakfitness.io', stage: 'contacted', value: 2800, source: 'seo', followUp: day(3), hot: false, firstRespondedAt: d(-14), lastTouchAt: d(-9), createdAt: d(-15), updatedAt: d(-2) },
  { id: 'ld-3', name: 'Lumen Legal', company: 'Lumen Legal', email: 'intake@lumenlegal.co', stage: 'new', value: 7200, source: 'linkedin', followUp: day(2), hot: true, createdAt: d(-12), updatedAt: d(-1) },
  { id: 'ld-4', name: 'Sprout Grocers', company: 'Sprout Grocers', email: 'team@sproutgrocers.com', stage: 'won', value: 3600, source: 'outbound', hot: false, firstRespondedAt: d(-10, 10), lastTouchAt: d(-4), createdAt: d(-10), updatedAt: d(-4) },
  { id: 'ld-5', name: 'Atlas Tours', company: 'Atlas Tours', email: 'info@atlastours.ph', stage: 'lost', value: 1500, source: 'seo', hot: false, lostReason: 'no_decision', firstRespondedAt: d(-7), lastTouchAt: d(-5), createdAt: d(-8), updatedAt: d(-5) },
  { id: 'ld-6', name: 'Nimbus HR', company: 'Nimbus HR', email: 'people@nimbushr.com', stage: 'contacted', value: 5400, source: 'linkedin', followUp: day(1), hot: true, firstRespondedAt: d(-2, 10), lastTouchAt: d(0, 8), createdAt: d(-2), updatedAt: d(0, 8) },
  // Won ~40 days ago (a prior month). "Won this month" must NOT count this, even
  // though updatedAt is recent — that's the whole point of dating wins by event.
  { id: 'ld-7', name: 'Vertex Realty', company: 'Vertex Realty', email: 'admin@vertexrealty.com', stage: 'won', value: 6200, source: 'referral', hot: false, firstRespondedAt: d(-44), lastTouchAt: d(-40), createdAt: d(-45), updatedAt: d(-1) },
  // Site-form intake (034): ld-8 arrived 50 minutes ago and nobody has replied,
  // so its SLA clock is amber; ld-9 failed the bot check and sits in quarantine.
  {
    id: 'ld-8', name: 'Maya Santos', company: 'Kalye Coffee Co.', email: 'maya@kalyecoffee.ph', phone: '+63 917 555 0142',
    stage: 'new', value: 0, source: 'website', hot: true, ownerId: 'u-admin',
    services: ['website', 'automation'], budgetBand: '2_5k_5k', timeline: 'asap', form: 'contact',
    message: 'We run three coffee shops in Makati and want online ordering for pickup, plus a loyalty program that does not need a separate app. Our current site is a single page on a builder and we can no longer update the menu ourselves.',
    attribution: { first: { utm_source: 'google', utm_medium: 'cpc', landing_page: '/services' }, last: { referrer: 'https://www.google.com/', landing_page: '/contact' } },
    consentAt: mins(-50), score: 66, scoreBreakdown: { budget: 16, timeline: 20, business_email: 10, company: 5, phone: 5, detailed_message: 5, multiple_services: 5 },
    slaDueAt: mins(10), submissionCount: 1, lastSubmittedAt: mins(-50), createdAt: mins(-50), updatedAt: mins(-50),
  },
  {
    id: 'ld-9', name: 'SEO Expert', email: 'rank1@freeseo.example', stage: 'new', value: 0, source: 'website', hot: false,
    form: 'contact', message: 'We can get your site to page one in 7 days. Reply for a free audit!!!',
    spam: true, spamReason: 'turnstile_failed', score: 0, scoreBreakdown: {}, submissionCount: 1,
    lastSubmittedAt: d(-1, 3), createdAt: d(-1, 3), updatedAt: d(-1, 3),
  },
]

/** Lead history — what makes response time / velocity / win dating real. */
export const seedLeadActivity: LeadActivity[] = [
  { id: 'la-1', leadId: 'ld-1', actorId: 'u-admin', action: 'created', detail: { name: 'Harbor Dental' }, createdAt: d(-18) },
  { id: 'la-2', leadId: 'ld-1', actorId: 'u-admin', action: 'stage_changed', detail: { from: 'new', to: 'contacted' }, createdAt: d(-18, 11) },
  { id: 'la-3', leadId: 'ld-1', actorId: 'u-admin', action: 'stage_changed', detail: { from: 'contacted', to: 'proposal' }, createdAt: d(-6) },
  { id: 'la-4', leadId: 'ld-1', actorId: 'u-admin', action: 'contacted', detail: {}, createdAt: d(-1) },
  { id: 'la-5', leadId: 'ld-2', actorId: 'u-admin', action: 'created', detail: { name: 'Peak Fitness' }, createdAt: d(-15) },
  { id: 'la-6', leadId: 'ld-2', actorId: 'u-admin', action: 'stage_changed', detail: { from: 'new', to: 'contacted' }, createdAt: d(-14) },
  { id: 'la-7', leadId: 'ld-2', actorId: 'u-admin', action: 'contacted', detail: {}, createdAt: d(-9) },
  { id: 'la-8', leadId: 'ld-3', actorId: 'u-admin', action: 'created', detail: { name: 'Lumen Legal' }, createdAt: d(-12) },
  { id: 'la-9', leadId: 'ld-4', actorId: 'u-admin', action: 'created', detail: { name: 'Sprout Grocers' }, createdAt: d(-10) },
  { id: 'la-10', leadId: 'ld-4', actorId: 'u-admin', action: 'stage_changed', detail: { from: 'new', to: 'contacted' }, createdAt: d(-10, 10) },
  { id: 'la-11', leadId: 'ld-4', actorId: 'u-admin', action: 'won', detail: { name: 'Sprout Grocers', value: 3600, source: 'outbound' }, createdAt: d(-4) },
  { id: 'la-12', leadId: 'ld-5', actorId: 'u-admin', action: 'created', detail: { name: 'Atlas Tours' }, createdAt: d(-8) },
  { id: 'la-13', leadId: 'ld-5', actorId: 'u-admin', action: 'lost', detail: { name: 'Atlas Tours', reason: 'no_decision' }, createdAt: d(-5) },
  { id: 'la-14', leadId: 'ld-6', actorId: 'u-admin', action: 'created', detail: { name: 'Nimbus HR' }, createdAt: d(-2) },
  { id: 'la-15', leadId: 'ld-6', actorId: 'u-admin', action: 'stage_changed', detail: { from: 'new', to: 'contacted' }, createdAt: d(-2, 10) },
  { id: 'la-16', leadId: 'ld-6', actorId: 'u-admin', action: 'contacted', detail: {}, createdAt: d(0, 8) },
  { id: 'la-17', leadId: 'ld-7', actorId: 'u-admin', action: 'created', detail: { name: 'Vertex Realty' }, createdAt: d(-45) },
  { id: 'la-18', leadId: 'ld-7', actorId: 'u-admin', action: 'won', detail: { name: 'Vertex Realty', value: 6200, source: 'referral' }, createdAt: d(-40) },
  { id: 'la-19', leadId: 'ld-8', action: 'submitted', detail: { form: 'contact', services: ['website', 'automation'] }, createdAt: mins(-50) },
  { id: 'la-20', leadId: 'ld-8', action: 'assigned', detail: { to: 'u-admin', via: 'round_robin' }, createdAt: mins(-50) },
  { id: 'la-21', leadId: 'ld-9', action: 'submitted', detail: { form: 'contact', quarantined: true }, createdAt: d(-1, 3) },
]

// ─── Growth: job postings (demo — the finder writes real ones via n8n) ──────

export const seedJobPostings: JobPosting[] = [
  { id: 'jp-1', source: 'adzuna', url: 'https://example.com/jobs/wp-dev', title: 'WordPress Developer (Contract)', company: 'BrightMedia', location: 'Remote', remote: true, category: 'IT Jobs', tag: 'gig', salaryText: '$40/hr', postedAt: d(-1), dismissed: false, createdAt: d(-1) },
  { id: 'jp-2', source: 'adzuna', url: 'https://example.com/jobs/web-designer', title: 'Hiring: In-house Web Designer', company: 'Peak Dental Group', location: 'Manila, PH', remote: false, category: 'Design', tag: 'lead', dismissed: false, postedAt: d(-2), createdAt: d(-2) },
  { id: 'jp-3', source: 'onlinejobs', url: 'https://example.com/jobs/shopify', title: 'Shopify Store Setup', company: 'GreenLeaf Organics', location: 'Remote', remote: true, category: 'E-commerce', tag: 'gig', dismissed: false, postedAt: d(0, 8), createdAt: d(0, 8) },
]

// ─── Events & meetings (this week) ──────────────────────────────────────────

export const seedEvents: EventItem[] = [
  {
    id: 'ev-nwsync', kind: 'meeting', title: 'Northwind weekly sync',
    clientId: 'cl-northwind', startsAt: d(0, 10), endsAt: d(0, 11),
    allDay: false, meetingLink: 'https://meet.google.com/nw-sync',
    notes: 'Reviewed portal redesign progress\nClient approved new dashboard layout\nAction: ship auth flow by Friday',
    color: '#8b5cf6', recurrence: 'none', createdBy: 'u-admin',
    createdAt: d(-7), updatedAt: d(0, 11),
  },
  {
    id: 'ev-bltriage', kind: 'meeting', title: 'BrightLoop payment bug triage',
    clientId: 'cl-brightloop', startsAt: d(0, 14), endsAt: d(0, 15),
    allDay: false, meetingLink: 'https://meet.google.com/bl-triage',
    notes: 'Walked through crash logs together\nBlocked on Stripe sandbox access — client sending credentials today',
    color: '#0ea5e9', recurrence: 'none', createdBy: 'u-admin',
    createdAt: d(-1), updatedAt: d(0, 15),
  },
  {
    id: 'ev-design', kind: 'meeting', title: 'Portal design review',
    clientId: 'cl-northwind', startsAt: d(2, 15), endsAt: d(2, 16),
    allDay: false, meetingLink: 'https://meet.google.com/nw-design',
    color: '#8b5cf6', recurrence: 'none', createdBy: 'u-admin',
    createdAt: d(-2), updatedAt: d(-2),
  },
  {
    id: 'ev-launch', kind: 'meeting', title: 'v2.0 launch planning',
    clientId: 'cl-brightloop', startsAt: d(3, 11), endsAt: d(3, 12),
    allDay: false, meetingLink: 'https://meet.google.com/bl-launch',
    color: '#0ea5e9', recurrence: 'none', createdBy: 'u-admin',
    createdAt: d(-1), updatedAt: d(-1),
  },
  {
    id: 'ev-invoice', kind: 'event', title: 'Invoice day',
    description: 'Send invoices to all active retainers',
    startsAt: d(1, 9), allDay: true,
    color: '#f59e0b', recurrence: 'none', createdBy: 'u-admin',
    createdAt: d(-10), updatedAt: d(-10),
  },
  {
    id: 'ev-focus', kind: 'event', title: 'Focus block — deep work',
    startsAt: d(-7, 8), endsAt: d(-7, 10), allDay: false,
    color: '#10b981', recurrence: 'weekly', recurrenceUntil: day(60),
    createdBy: 'u-admin', createdAt: d(-7), updatedAt: d(-7),
  },
  {
    id: 'ev-pickup', kind: 'event', title: 'Casa Palma menu print pickup',
    clientId: 'cl-casapalma', startsAt: d(1, 16), allDay: false,
    location: 'PrintHub, Ayala Ave', color: '#10b981', recurrence: 'none',
    createdBy: 'u-admin', createdAt: d(-2), updatedAt: d(-2),
  },
  {
    id: 'ev-portfolio', kind: 'event', title: 'Portfolio update',
    description: 'Add portal + menu projects to the site',
    startsAt: d(4, 13), endsAt: d(4, 15), allDay: false,
    color: '#64748b', recurrence: 'none', createdBy: 'u-admin',
    createdAt: d(-1), updatedAt: d(-1),
  },
]

// ─── Notifications ──────────────────────────────────────────────────────────

export const seedNotifications: Notification[] = [
  { id: 'n-1', userId: 'u-admin', actorId: 'u-member', type: 'task_updated', title: "Alex moved task 'Ship dashboard layout' to In Progress", entity: 'task', entityId: 't-dash', read: false, createdAt: d(0, 9) },
  { id: 'n-2', userId: 'u-member', actorId: 'u-admin', type: 'task_assigned', title: "Maykie assigned you 'Review landing copy'", entity: 'task', entityId: 't-copy', read: false, createdAt: d(-1, 17) },
  { id: 'n-3', userId: 'u-admin', type: 'due_reminder', title: "Task 'Fix crash on payment screen' is due today", entity: 'task', entityId: 't-crash', read: false, createdAt: d(0, 7) },
  { id: 'n-4', userId: 'u-admin', type: 'system', title: 'Welcome to DeskDev Studio', body: 'Your workspace is ready. Add clients, projects, and tasks to get rolling.', read: true, createdAt: d(-7) },
]

// ─── Channels ───────────────────────────────────────────────────────────────
// Same starter layout migration 023 creates on a fresh Supabase project.

export const seedChannelCategories: ChannelCategory[] = [
  { id: 'cc-info', name: 'Information', position: 0, createdBy: 'u-admin', createdAt: d(-30), updatedAt: d(-30) },
  { id: 'cc-text', name: 'Text channels', position: 1, createdBy: 'u-admin', createdAt: d(-30), updatedAt: d(-30) },
]

export const seedChannels: Channel[] = [
  {
    id: 'ch-announcements', categoryId: 'cc-info', name: 'announcements',
    topic: 'Studio-wide news. Admins post, everyone reacts.', kind: 'announcement',
    isPrivate: false, memberIds: [], position: 0, createdBy: 'u-admin',
    lastMessageAt: d(-1, 10), createdAt: d(-30), updatedAt: d(-30),
  },
  {
    id: 'ch-general', categoryId: 'cc-text', name: 'general',
    topic: 'Anything and everything for the whole team.', kind: 'text',
    isPrivate: false, memberIds: [], position: 0, createdBy: 'u-admin',
    lastMessageAt: d(0, 9), createdAt: d(-30), updatedAt: d(-30),
  },
  {
    id: 'ch-wins', categoryId: 'cc-text', name: 'wins',
    topic: 'Shipped something? Landed a client? Share it here.', kind: 'text',
    isPrivate: false, memberIds: [], position: 1, createdBy: 'u-admin',
    lastMessageAt: d(-30), createdAt: d(-30), updatedAt: d(-30),
  },
]

export const seedChannelMessages: ChannelMessage[] = [
  {
    id: 'cm-1', channelId: 'ch-announcements', senderId: 'u-admin',
    body: 'Welcome to Channels! Use #general for day-to-day chat and #wins to celebrate. @everyone',
    pinnedAt: d(-1, 10), pinnedBy: 'u-admin', createdAt: d(-1, 10),
  },
  { id: 'cm-2', channelId: 'ch-general', senderId: 'u-member', body: 'Morning! Dashboard layout is up for review 👀', createdAt: d(0, 8) },
  { id: 'cm-3', channelId: 'ch-general', senderId: 'u-admin', body: 'Nice — I will take a look after standup.', replyToId: 'cm-2', createdAt: d(0, 9) },
]

// ─── Showcase (037) — a few entries in each state for the local demo ───────
// Images are left unset: the screens fall back to a monogram, as the public
// site does, until a screenshot is uploaded.

export const seedShowcaseItems: ShowcaseItem[] = [
  {
    id: 'sc-1', slug: 'command-desk', kind: 'product', title: 'Command Desk', url: 'https://example.com/command-desk', linkPublic: true,
    industry: 'Operations', summary: 'The studio workspace we run our own client delivery on: projects, tasks, CRM, calendar and a team chat in one place.',
    resultTag: 'In daily use', stack: ['Next.js', 'Supabase', 'TypeScript'], status: 'published', featured: true, homeFeatured: true,
    sortOrder: 0, consent: 'internal', linkStatus: 'ok', linkFailCount: 0, publishedAt: d(-30), publishedBy: 'u-admin',
    createdBy: 'u-admin', createdAt: d(-31), updatedAt: d(-30),
  },
  {
    id: 'sc-2', slug: 'northwind-client-portal', kind: 'web_app', title: 'Northwind client portal', url: 'https://example.com/northwind', linkPublic: false,
    industry: 'Agency', summary: 'A self-serve portal where Northwind customers track campaigns and approve deliverables.',
    stack: ['React', 'Supabase'], status: 'published', featured: false, homeFeatured: false, sortOrder: 10,
    consent: 'granted', consentNote: 'Approved by email; no public link', consentAt: d(-20), projectId: 'pr-portal', clientId: 'cl-northwind',
    linkStatus: 'ok', linkFailCount: 0, publishedAt: d(-19), publishedBy: 'u-admin', createdBy: 'u-admin', createdAt: d(-21), updatedAt: d(-19),
  },
  {
    id: 'sc-3', slug: 'casa-palma-menu', kind: 'website', title: 'Casa Palma menu site', url: 'https://example.com/casapalma', linkPublic: true,
    industry: 'Restaurant', summary: 'A fast menu site the kitchen updates themselves, with printed menus generated from the same data.',
    stack: ['Next.js'], status: 'ready', featured: false, homeFeatured: false, sortOrder: 20, consent: 'unknown',
    projectId: 'pr-menu', clientId: 'cl-casapalma', linkStatus: 'unknown', linkFailCount: 0,
    createdBy: 'u-admin', createdAt: d(-1, 16), updatedAt: d(-1, 16),
  },
  {
    id: 'sc-4', slug: 'vertex-listings', kind: 'website', title: 'Vertex Realty listings', linkPublic: true, industry: 'Real estate',
    stack: [], status: 'draft', featured: false, homeFeatured: false, sortOrder: 30, consent: 'unknown',
    clientId: 'cl-vertex', linkStatus: 'unknown', linkFailCount: 0, createdBy: 'u-member', createdAt: d(-2), updatedAt: d(-2),
  },
  {
    id: 'sc-5', slug: 'old-bakery-site', kind: 'website', title: 'Old bakery site', url: 'https://example.com/bakery', linkPublic: true,
    industry: 'Food', summary: 'A legacy portfolio entry whose site went offline.', stack: ['WordPress'], status: 'hidden',
    featured: false, homeFeatured: false, sortOrder: 40, consent: 'legacy', linkStatus: 'down', linkFailCount: 3, linkCheckedAt: d(-1),
    createdAt: d(-90), updatedAt: d(-1),
  },
]

// ─── Meeting recordings (058) ───────────────────────────────────────────────

export const seedRecordingFolders: RecordingFolder[] = [
  { id: 'rf-nw-kickoffs', clientId: 'cl-northwind', name: 'Kickoffs', createdBy: 'u-admin', createdAt: d(-10), updatedAt: d(-10) },
]

export const seedMeetingRecordings: MeetingRecording[] = [
  {
    id: 'mr-portal-demo', clientId: 'cl-northwind', projectId: 'pr-portal', title: 'Portal weekly demo',
    url: 'https://vimeo.com/76979871', recordedOn: day(-2), notes: 'Walkthrough of the dashboard layout and auth flow.',
    createdBy: 'u-admin', createdAt: d(-2), updatedAt: d(-2),
  },
  {
    id: 'mr-nw-kickoff', clientId: 'cl-northwind', folderId: 'rf-nw-kickoffs', title: 'Northwind kickoff call',
    url: 'https://vimeo.com/76979871', recordedOn: day(-12), createdBy: 'u-admin', createdAt: d(-12), updatedAt: d(-12),
  },
]
