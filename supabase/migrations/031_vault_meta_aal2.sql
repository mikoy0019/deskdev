-- ============================================
-- DeskDev Studio — 031: vault_meta needs the second factor too
-- Apply AFTER 030 (it relies on vault_has_active_meta() from 030) and only
-- once the web app (and the mobile app, if it is still shipped) carry the
-- matching client change: both now answer "set up or locked?" with
-- vault_has_active_meta() and read the active generation only after the TOTP
-- step, and SetupGate verifies a code before it inserts a new generation.
--
-- Why: vault_meta holds the PBKDF2 salt and the wrapped data key. Readable at
-- aal1, a password-only admin session (an admin can get one for any admin
-- account by resetting its password) could copy both and brute-force the
-- master password offline, without ever passing the authenticator.
--
-- After this, below aal2 vault_meta reads as empty and inserts are refused.
-- Service-role callers (vault-reset, n8n) bypass RLS and are unaffected, and
-- vault_has_active_meta() is SECURITY DEFINER, so the phase check keeps
-- working at aal1.
--
-- Re-runnable: DROP POLICY IF EXISTS before each CREATE.
-- ============================================

DROP POLICY IF EXISTS "vault_meta_select_require_aal2" ON public.vault_meta;
CREATE POLICY "vault_meta_select_require_aal2"
  ON public.vault_meta AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2');

DROP POLICY IF EXISTS "vault_meta_insert_require_aal2" ON public.vault_meta;
CREATE POLICY "vault_meta_insert_require_aal2"
  ON public.vault_meta AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
