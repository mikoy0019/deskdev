import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { isAdmin } from '../lib/permissions'
import { cubeSnapshot } from './useCube'
import { emptyOperations, evaluateOperations, OPERATION_DEPARTMENTS, type CubeIntake, type OperationDepartment, type OperationState, type OperationWork } from './operations'

const KEY = 'deskdev-cube-operations:v1:local'
export const OPERATIONS_CHANGED = 'cube-operations-changed'
const changed = () => window.dispatchEvent(new Event(OPERATIONS_CHANGED))
function requireAdmin() {
  if (!isAdmin(cubeSnapshot(new Date().toISOString()).user)) throw new Error('An active admin is required for Cube operations.')
}
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
export function parseOperations(raw: string | null): OperationState {
  if (raw === null) return emptyOperations()
  const v: unknown = JSON.parse(raw)
  if (!isRecord(v) || v.version !== 1 || typeof v.enabled !== 'boolean' || !Array.isArray(v.teams) || !Array.isArray(v.intakes) || !Array.isArray(v.work) || !Array.isArray(v.history)
    || (v.lastRunAt !== null && !validTime(v.lastRunAt)) || (v.error !== null && typeof v.error !== 'string')) throw new Error('Cube operations storage is unreadable. Existing data has been preserved.')
  const teams = v.teams
  if (teams.length !== 7 || teams.some(t => !isRecord(t) || typeof t.code !== 'string' || !Object.hasOwn(OPERATION_DEPARTMENTS, t.code) || typeof t.enabled !== 'boolean' || (t.ownerId !== null && typeof t.ownerId !== 'string')) || new Set(teams.map(t => t.code)).size !== 7) throw new Error('Cube department settings are unreadable.')
  for (const intake of v.intakes) {
    if (!isRecord(intake) || typeof intake.projectId !== 'string' || !Number.isInteger(intake.version) || Number(intake.version) < 1) throw new Error('Cube intake records are unreadable.')
    intakeError(intake as unknown as CubeIntake)
  }
  for (const work of v.work) {
    if (!isRecord(work) || typeof work.department !== 'string' || !Object.hasOwn(OPERATION_DEPARTMENTS, work.department) || !['lead','task','project','integration','operation'].includes(String(work.subjectType))
      || !['open','resolved'].includes(String(work.status)) || !['attention','urgent'].includes(String(work.urgency)) || !validTime(work.firstSeenAt) || !validTime(work.updatedAt) || (work.urgentSinceAt !== null && !validTime(work.urgentSinceAt))
      || ['key','subjectId','title','instruction'].some(k => typeof work[k] !== 'string') || (work.ownerId !== null && typeof work.ownerId !== 'string')) throw new Error('Cube work records are unreadable.')
  }
  if (new Set(v.intakes.map(i => i.projectId)).size !== v.intakes.length || new Set(v.work.map(w => w.key)).size !== v.work.length) throw new Error('Cube operations contains duplicate records.')
  if (v.history.length > 200 || v.history.some(h => !isRecord(h) || typeof h.id !== 'string' || typeof h.action !== 'string' || (h.workKey !== null && typeof h.workKey !== 'string') || !validTime(h.at))) throw new Error('Cube operations history is unreadable.')
  return v as unknown as OperationState
}
export function intakeError(intake: CubeIntake): void {
  if (typeof intake.contractReference !== 'string' || intake.contractReference.length > 2000 || typeof intake.evidence !== 'string' || intake.evidence.length > 4000) throw new Error('Contract reference or evidence is too long.')
  if (['briefConfirmed','assetsConfirmed','creativeRequired','creativeApproved','qaConfirmed'].some(k => typeof intake[k as keyof CubeIntake] !== 'boolean')) throw new Error('Invalid intake confirmations.')
  if ((intake.briefConfirmed || intake.assetsConfirmed || intake.creativeApproved || intake.qaConfirmed) && !intake.evidence.trim()) throw new Error('Confirmations require evidence.')
}
async function localMutation(change: (state: OperationState) => OperationState): Promise<OperationState> {
  const write = () => {
    requireAdmin()
    const state = change(parseOperations(localStorage.getItem(KEY)))
    localStorage.setItem(KEY, JSON.stringify(state))
    changed()
    return state
  }
  return navigator.locks ? navigator.locks.request(KEY, write) : write()
}
function checkError(error: { message: string; code?: string } | null) {
  if (error) {
    if (['42P01','42883','PGRST202','PGRST205'].includes(error.code ?? '')) throw new Error('Shared Cube operations is not installed on this backend. Migration 053 must be applied in ledger order before remote automation is available.')
    throw new Error(error.message)
  }
}
// PostgREST caps responses; load every page rather than resolving work against a truncated list.
async function allRows(table: string, order: string) {
  // Raw PostgREST rows; loadOperations maps each field of each table explicitly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any>[] = []
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from(table).select('*').order(order).range(start, start + 499)
    checkError(error)
    result.push(...data ?? [])
    if ((data?.length ?? 0) < 500) return result
  }
}
export async function loadOperations(): Promise<OperationState> {
  requireAdmin()
  if (!isSupabaseConfigured) return parseOperations(localStorage.getItem(KEY))
  const [controls, teams, intakes, work, history] = await Promise.all([
    allRows('cube_control','id'), allRows('cube_departments','code'), allRows('cube_intakes','project_id'), allRows('cube_work_items','key'),
    supabase.from('cube_operation_history').select('id,work_key,action,at').order('id', { ascending: false }).limit(50),
  ])
  checkError(history.error)
  requireAdmin()
  if (controls.length !== 1 || teams.length !== 7) throw new Error('Cube operations records are unavailable for this account.')
  return {
    version: 1, enabled: controls[0].enabled, lastRunAt: controls[0].last_run_at, error: controls[0].last_error,
    teams: teams.map(t => ({ code: t.code as OperationDepartment, ownerId: t.owner_id, enabled: t.enabled })),
    intakes: intakes.map(i => ({ projectId: i.project_id, version: i.version, contractReference: i.contract_reference, briefConfirmed: i.brief_confirmed, assetsConfirmed: i.assets_confirmed, creativeRequired: i.creative_required, creativeApproved: i.creative_approved, qaConfirmed: i.qa_confirmed, evidence: i.evidence })),
    work: work.map(w => ({ key: w.key, department: w.department, subjectType: w.subject_type, subjectId: w.subject_id, title: w.title, instruction: w.instruction, urgency: w.urgency, ownerId: w.owner_id, status: w.status, firstSeenAt: w.first_seen_at, urgentSinceAt: w.urgent_since_at, updatedAt: w.updated_at }) as OperationWork),
    history: (history.data ?? []).reverse().map(h => ({ id: String(h.id), workKey: h.work_key, action: h.action, at: h.at })),
  }
}
export async function runOperations(): Promise<void> {
  requireAdmin()
  if (!isSupabaseConfigured) { await localMutation(state => evaluateOperations(cubeSnapshot(new Date().toISOString()), state)); return }
  const { error } = await supabase.rpc('cube_run')
  checkError(error)
  changed()
}
export async function configureOperations(department: OperationDepartment | 'workspace', ownerId: string | null, enabled: boolean) {
  requireAdmin()
  if (typeof enabled !== 'boolean' || (department !== 'workspace' && !Object.hasOwn(OPERATION_DEPARTMENTS, department))) throw new Error('Invalid Cube configuration.')
  if (!isSupabaseConfigured) {
    await localMutation(state => {
      const snapshot = cubeSnapshot(new Date().toISOString())
      if (ownerId && !snapshot.users.some(u => u.id === ownerId && isAdmin(u))) throw new Error('The department owner must be an active admin.')
      const next = department === 'workspace' ? { ...state, enabled } : { ...state, teams: state.teams.map(t => t.code === department ? { ...t, ownerId, enabled } : t) }
      return evaluateOperations(snapshot, next)
    })
  } else {
    const { error } = await supabase.rpc('cube_configure', { p_department: department, p_owner: ownerId, p_enabled: enabled })
    checkError(error)
    changed()
  }
}
export async function saveIntake(intake: CubeIntake) {
  requireAdmin()
  intakeError(intake)
  if (!isSupabaseConfigured) {
    await localMutation(state => {
      const snapshot = cubeSnapshot(new Date().toISOString())
      if (!snapshot.projects.some(p => p.id === intake.projectId)) throw new Error('Project not found.')
      const current = state.intakes.find(i => i.projectId === intake.projectId)
      if ((current?.version ?? 0) !== intake.version) throw new Error('Project intake changed. Reload before saving.')
      return evaluateOperations(snapshot, { ...state, intakes: [...state.intakes.filter(i => i.projectId !== intake.projectId), { ...intake, contractReference: intake.contractReference.trim(), version: intake.version + 1 }] })
    })
  } else {
    const { projectId, version, ...fields } = intake
    const { error } = await supabase.rpc('cube_save_intake', { p_project: projectId, p_version: version, p_intake: fields })
    checkError(error)
    changed()
  }
}
