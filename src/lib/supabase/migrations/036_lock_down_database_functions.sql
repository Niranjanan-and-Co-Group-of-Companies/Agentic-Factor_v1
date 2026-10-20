-- ============================================================
-- Only the server may run the database functions that move credits or read any account's data.
--
-- Supabase lets the anon and authenticated roles execute every function in the public schema unless
-- that is revoked, so anyone holding the public (anon) key — it ships in the website and the app —
-- could call these through the REST API: add_credits_atomic_refund adds any number of credits to any
-- account, deduct_credits_atomic drains one, reset_monthly_usage resets everyone's usage, and the
-- match_* / get_* functions read another account's data by its id. The website and the app only call
-- them through the server (service role), so nothing else needs them.
--
-- team_has_access and mission_has_access stay callable: row-level security policies run them as the
-- signed-in user. Trigger functions are not callable over the API.
-- ============================================================

DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'add_credits_atomic_refund', 'deduct_credits_atomic', 'grant_topup_idempotent',
         'reset_monthly_usage', 'reset_daily_tokens',
         'get_tenant_stats', 'get_seat_count', 'get_approval_streak', 'get_next_snapshot_version',
         'touch_heartbeat', 'detect_deadlocked_missions',
         'match_agent_templates', 'match_asset_chunks', 'match_feedback_examples', 'match_mission_patterns'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END$$;

-- New functions start locked too: one that signed-in users must run needs its own GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Check: every function above should show false, false.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anyone_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS signed_in_users_can_run
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
 ORDER BY 1;
