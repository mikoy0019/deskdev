-- ============================================
-- DeskDev Studio — 045: lead-nudge is retired, so its health row is paused
--
-- 026 registered lead-nudge as an enabled daily job. 035 replaced it with
-- lead_followups_due(), the in-app digest per owner, and the workflow stays
-- switched off in n8n (automation/README.md → Workflows). With the row still
-- enabled, automation_health reported it 'stale' every day after its last
-- run, and Settings → Integrations showed a false alarm.
--
-- `enabled` mirrors whether the workflow is on in n8n (026), so this records
-- the operator state as it really is. Flip it back here if the email channel
-- is ever switched on again. Re-runnable.
-- ============================================

UPDATE public.automation_jobs
   SET enabled     = false,
       description = 'Retired (035: lead_followups_due in the app). Daily 08:00 Manila email of leads needing a reply or follow-up, if switched back on'
 WHERE job = 'lead-nudge';
