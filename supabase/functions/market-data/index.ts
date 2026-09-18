import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

type ModuleAction = 'view' | 'create' | 'edit' | 'delete'
type Membership = { role?: string; permissions?: Record<string, Record<string, boolean>>; active?: boolean }
type SeriesKey = keyof typeof SERIES

const SERIES = {
  // SGS 1 é dólar de venda, conforme o catálogo de dados abertos do BCB.
  dollar: { label: 'Dólar comercial (venda)', code: 1, suffix: 'R$' },
  selic: { label: 'Meta Selic', code: 432, suffix: '% a.a.' },
  ipca: { label: 'IPCA mensal', code: 433, suffix: '% a.m.' },
} as const

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, max-age=1800',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

function environment() {
  const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
  return { url: Deno.env.get('SUPABASE_URL') ?? '', key: publishableKeys.default ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '' }
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
  return row.role === 'owner' || row.permissions?.investments?.[action] === true
}

async function fetchSeries(key: SeriesKey) {
  const config = SERIES[key]
  const sourceUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${config.code}/dados/ultimos/1?formato=json`
  try {
    const response = await fetch(sourceUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`BCB ${response.status}`)
    const rows = await response.json() as Array<{ data?: string; valor?: string }>
    const latest = rows[0]
    const value = Number(String(latest?.valor ?? '').replace(',', '.'))
    if (!latest?.data || latest.valor == null || String(latest.valor).trim() === '' || !Number.isFinite(value)) throw new Error('invalid_bcb_response')
    return { key, label: config.label, value, suffix: config.suffix, referenceDate: latest.data, sourceUrl, stale: false }
  } catch {
    return { key, label: config.label, value: null, suffix: config.suffix, referenceDate: '', sourceUrl, stale: true }
  }
}

async function quotes(symbols: unknown) {
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > 20 || symbols.some(s => typeof s !== 'string' || !/^[A-Z]{4}\d{1,2}$/.test(s))) return respond({ error: 'invalid_symbols' }, 400)
  const token = Deno.env.get('BRAPI_TOKEN')
  if (!token) return respond({ error: 'quotes_not_configured' }, 503)
  const requested = [...new Set(symbols as string[])]
  const sourceUrl = `https://brapi.dev/api/v2/stocks/quote?symbols=${requested.join(',')}`
  const response = await fetch(sourceUrl, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) return respond({ error: response.status === 429 ? 'quotes_rate_limited' : 'quotes_unavailable' }, response.status === 429 ? 429 : 502)
  const body = await response.json()
  const checkedAt = new Date().toISOString()
  const normalized = requested.map(symbol => {
    const item = (Array.isArray(body.results) ? body.results : []).find((r: any) => (r.requestedSymbol || r.symbol) === symbol)
    const data = item?.data
    const timestamp = Date.parse(data?.regularMarketTime)
    const price = data?.regularMarketPrice
    const valid = typeof price === 'number' && Number.isFinite(price) && price > 0 && Number.isSafeInteger(Math.round(price * 100)) && data.currency === 'BRL' && Number.isFinite(timestamp) && timestamp <= Date.now() + 300000
    return { symbol, resolvedSymbol: item?.symbol || symbol, priceCents: valid ? Math.round(price * 100) : null, currency: 'BRL', referenceDate: valid ? new Date(timestamp).toISOString() : null, stale: !valid || Date.now() - timestamp > 36 * 3600000, source: 'brapi', sourceUrl, checkedAt, error: valid ? null : 'quote_unavailable' }
  })
  return respond({ source: 'brapi', checkedAt, quotes: normalized }, normalized.every(q => q.priceCents === null) ? 503 : 200)
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405)
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const workspaceId = String(body.workspaceId ?? '')
    if (!await authorize(request, workspaceId, 'view')) return respond({ error: 'forbidden' }, 403)
    if (body.action === 'quotes') return await quotes(body.symbols)
    const indicators = await Promise.all((Object.keys(SERIES) as SeriesKey[]).map(fetchSeries))
    if (indicators.every((item) => item.value === null)) return respond({ error: 'market_data_unavailable', indicators }, 503)
    return respond({ source: 'Banco Central do Brasil', checkedAt: new Date().toISOString(), indicators })
  } catch (error) {
    console.error('market-data', error)
    return respond({ error: 'internal_error' }, 500)
  }
})
