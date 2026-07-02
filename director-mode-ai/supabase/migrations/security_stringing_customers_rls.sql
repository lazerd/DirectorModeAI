-- SECURITY HOTFIX — stringing_customers PII exposure
--
-- stringing_customers exposed every customer's full_name, email, and phone to
-- ANONYMOUS (not-logged-in) visitors via the public anon key. It is a back-office
-- table with no public page, so we enable RLS and scope it to the owning user.
--
-- Run in Supabase -> SQL editor. Safe to re-run. Service-role (server routes)
-- bypasses RLS and is unaffected. After running, confirm the pro-shop customer
-- list at /stringing/customers still loads for you (it should).

ALTER TABLE public.stringing_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manages own stringing customers" ON public.stringing_customers;
CREATE POLICY "owner manages own stringing customers"
  ON public.stringing_customers
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Remove any lingering blanket read grant to anonymous visitors.
REVOKE SELECT ON public.stringing_customers FROM anon;
