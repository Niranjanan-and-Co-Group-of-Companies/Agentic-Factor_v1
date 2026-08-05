import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, isAuthError } from '@/lib/supabase/middleware';

// GET /api/circuit — return circuit status for current tenant
export async function GET(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { getCircuitStatus } = await import('@/lib/middleware/circuit-breaker');
  const status = getCircuitStatus(tenantId);

  return NextResponse.json({ tenantId, ...status });
}

// POST /api/circuit — reset circuit for current tenant (self-service recovery)
export async function POST(request: NextRequest) {
  const authResult = await extractTenantContext(request);
  if (isAuthError(authResult)) return authResult;
  const { tenantId } = authResult;

  const { resetCircuit, getCircuitStatus } = await import('@/lib/middleware/circuit-breaker');
  resetCircuit(tenantId);
  const status = getCircuitStatus(tenantId);

  console.log(`[circuit] Manual reset by tenant ${tenantId}`);
  return NextResponse.json({ success: true, tenantId, status });
}
