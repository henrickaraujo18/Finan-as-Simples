import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

type ModuleAction = 'view' | 'create' | 'edit' | 'delete'
type Membership = { role?: string; permissions?: Record<string, Record<string, boolean>>; active?: boolean }
type PluggyItem = { id: string; clientUserId?: string; connector?: { id?: number; name?: string }; connectorId?: number; status?: string; executionStatus?: string; consent?: { expiresAt?: string }; consentExpiresAt?: string }
type PluggyAccount = { id: string; name?: string; marketingName?: string; type?: string; subtype?: string; number?: string; currencyCode?: string; balance?: number; closingBalance?: number; creditLimit?: number; availableCreditLimit?: number }
type PluggyBill = { id: string; dueDate?: string; closeDate?: string; balanceCloseDate?: string; totalAmount?: number; minimumPayment?: number; status?: string }

const API_URL = 'https://api.pluggy.ai'
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
let cachedKey: { value: string; expiresAt: number } | null = null

function environment() {
  const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
  return {
    url: Deno.env.get('SUPABASE_URL') ?? '',
    key: publishableKeys.default ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    clientId: (Deno.env.get('PLUGGY_CLIENT_ID') ?? '').trim(),
    clientSecret: (Deno.env.get('PLUGGY_CLIENT_SECRET') ?? '').trim(),
  }
}

async function authorize(request: Request, workspaceId: string, action: ModuleAction) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) return false
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  const env = environment()
  if (!token || !env.url || !env.key) return false
  const client = createClient(env.url, env.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const user = await client.auth.getUser(token)
  if (user.error || !user.data.user) return false
  const membership = await client.from('workspace_memberships').select('role,permissions,active')
    .eq('workspace_id', workspaceId).eq('user_id', user.data.user.id).eq('active', true).maybeSingle()
  if (membership.error || !membership.data) return false
  const row = membership.data as Membership
  return row.role === 'owner' || row.permissions?.openFinance?.[action] === true
}

async function apiKey() {
  if (cachedKey && cachedKey.expiresAt > Date.now()) return cachedKey.value
  const env = environment()
  if (!env.clientId || !env.clientSecret) throw new Error('provider_not_configured')
  const response = await fetch(`${API_URL}/auth`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: env.clientId, clientSecret: env.clientSecret }),
    signal: AbortSignal.timeout(12000),
  })
  const body = await response.json().catch(() => ({})) as { apiKey?: string }
  if (!response.ok || !body.apiKey) throw new Error('provider_auth_failed')
  cachedKey = { value: body.apiKey, expiresAt: Date.now() + 110 * 60 * 1000 }
  return body.apiKey
}

async function pluggy<T>(path: string, init: RequestInit = {}) {
  const key = await apiKey()
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'X-API-KEY': key, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  })
  const body = await response.json().catch(() => ({})) as T
  if (!response.ok) throw new Error(`provider_error_${response.status}`)
  return body
}

function list<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object' && Array.isArray((value as { results?: unknown[] }).results)) return (value as { results: T[] }).results
  return []
}
const cents = (value: unknown) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0
const dateOnly = (value?: string) => value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
const mask = (value?: string) => { const last = String(value ?? '').replace(/\D/g, '').slice(-4); return last ? `•••• ${last}` : '' }

async function ownedItem(workspaceId: string, itemId: string) {
  const item = await pluggy<PluggyItem>(`/items/${encodeURIComponent(itemId)}`)
  if (!item.id || item.clientUserId !== workspaceId) throw new Error('item_not_owned')
  return item
}

async function itemSnapshot(workspaceId: string, itemId: string) {
  const item = await ownedItem(workspaceId, itemId)
  const accountResponse = await pluggy<unknown>(`/accounts?itemId=${encodeURIComponent(item.id)}`)
  const accounts = list<PluggyAccount>(accountResponse).filter((account) => Boolean(account.id)).map((account) => ({
    providerAccountId: account.id,
    providerItemId: item.id,
    name: account.marketingName?.trim() || account.name?.trim() || (account.type?.toUpperCase() === 'CREDIT' ? 'Cartão' : 'Conta'),
    type: account.type?.toUpperCase() || 'BANK', subtype: account.subtype ?? '', numberMask: mask(account.number),
    currency: account.currencyCode || 'BRL', balanceCents: cents(account.closingBalance ?? account.balance),
    creditLimitCents: account.creditLimit == null ? null : cents(account.creditLimit),
    availableCreditLimitCents: account.availableCreditLimit == null ? null : cents(account.availableCreditLimit),
    syncedAt: new Date().toISOString(),
  }))
  const bills = [] as Array<Record<string, unknown>>
  for (const account of accounts.filter((account) => account.type === 'CREDIT')) {
    const billResponse = await pluggy<unknown>(`/bills?accountId=${encodeURIComponent(account.providerAccountId)}`)
    for (const bill of list<PluggyBill>(billResponse)) {
      if (!bill.id) continue
      bills.push({ providerBillId: bill.id, providerAccountId: account.providerAccountId, providerItemId: item.id,
        accountName: account.name, dueDate: dateOnly(bill.dueDate), closeDate: dateOnly(bill.closeDate ?? bill.balanceCloseDate),
        totalAmountCents: cents(bill.totalAmount), minimumPaymentCents: bill.minimumPayment == null ? null : cents(bill.minimumPayment),
        status: bill.status || 'OPEN', syncedAt: new Date().toISOString() })
    }
  }
  return {
    connection: { providerItemId: item.id, connectorId: item.connector?.id ?? item.connectorId ?? null,
      institutionName: item.connector?.name?.trim() || 'Instituição financeira', status: item.status || 'UPDATED',
      executionStatus: item.executionStatus || '', consentExpiresAt: item.consent?.expiresAt ?? item.consentExpiresAt ?? '',
      lastSyncAt: new Date().toISOString() },
    accounts, bills,
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405)
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? 'status')
    const workspaceId = String(body.workspaceId ?? '')
    const permission: ModuleAction = action === 'disconnect' ? 'delete'
      : action === 'createConnectToken' || action === 'registerItem' ? 'create'
      : action === 'status' ? 'view' : 'edit'
    if (!await authorize(request, workspaceId, permission)) return respond({ error: 'forbidden' }, 403)
    const env = environment()
    const configured = Boolean(env.clientId && env.clientSecret)
    if (action === 'status') return respond({ provider: 'Pluggy', configured })
    if (!configured) return respond({ error: 'provider_not_configured' }, 503)
    if (action === 'createConnectToken') {
      const itemId = String(body.itemId ?? '').trim()
      if (itemId) await ownedItem(workspaceId, itemId)
      const token = await pluggy<{ accessToken?: string }>('/connect_token', {
        method: 'POST', body: JSON.stringify({ ...(itemId ? { itemId } : {}), options: { clientUserId: workspaceId, avoidDuplicates: true } }),
      })
      if (!token.accessToken) throw new Error('connect_token_missing')
      return respond({ accessToken: token.accessToken })
    }
    if (action === 'registerItem' || action === 'syncItem') {
      const itemId = String(body.itemId ?? '').trim()
      if (!itemId) return respond({ error: 'invalid_item' }, 400)
      return respond(await itemSnapshot(workspaceId, itemId))
    }
    if (action === 'disconnect') {
      const itemId = String(body.itemId ?? '').trim()
      if (!itemId) return respond({ error: 'invalid_item' }, 400)
      await ownedItem(workspaceId, itemId)
      await pluggy<Record<string, unknown>>(`/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      return respond({ ok: true })
    }
    return respond({ error: 'invalid_action' }, 400)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'internal_error'
    const status = code === 'provider_not_configured' ? 503 : code === 'item_not_owned' ? 403 : 502
    console.error('open-finance', code)
    return respond({ error: code }, status)
  }
})
