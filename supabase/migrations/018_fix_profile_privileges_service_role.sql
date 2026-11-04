-- Fix: admins could not change a user's role/permissions from Settings.
-- The admin-users Edge Function updates profiles with the service-role key,
-- where auth.uid() is NULL, so is_admin() was false and the trigger raised
-- "Only admins can change role or permissions". The function already verifies
-- the caller is an admin, so service_role (and direct SQL) is allowed through.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.permissions IS DISTINCT FROM OLD.permissions)
     AND NOT public.is_admin()
     AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Only admins can change role or permissions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
