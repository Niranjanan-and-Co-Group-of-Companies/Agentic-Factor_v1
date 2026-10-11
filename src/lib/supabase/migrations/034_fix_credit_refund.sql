-- add_credits_atomic_refund() logged its event with entity_id = p_tenant_id::TEXT, but
-- events.entity_id is UUID, so the INSERT failed and rolled back the credit update with it:
-- no refund (e.g. for agents skipped after an early halt) has ever been applied.
CREATE OR REPLACE FUNCTION public.add_credits_atomic_refund(
  p_tenant_id   UUID,
  p_amount      INTEGER,
  p_reason      TEXT DEFAULT 'refund'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.tenant_billing SET
    credits_remaining        = COALESCE(credits_remaining, 0) + p_amount,
    credits_used_this_month  = GREATEST(0, COALESCE(credits_used_this_month, 0) - p_amount),
    updated_at               = now()
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.events (
    tenant_id, event_type, entity_type, entity_id, payload
  ) VALUES (
    p_tenant_id, 'billing.credit_refunded', 'billing', p_tenant_id,
    jsonb_build_object('amount', p_amount, 'reason', p_reason)
  );

  RETURN TRUE;
END;
$$;
