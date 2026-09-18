import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const snapshot = { month: '2026-09', capturedAt: '2026-09-18', reserveGoalCents: 0, cashBalanceCents: 0, months: [], expenses: [], incomes: [], portfolio: [], goals: [], indicators: [], password: 'never-send-me' };
function harness(name, options = {}) {
  let handler; const calls = [];
  const env = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'public', ...options.env };
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: options.member === undefined ? { role: 'owner' } : options.member }) };
  const raw = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8').split(/\r?\n/).filter(l => !l.startsWith('import ')).join('\n');
  vm.runInNewContext(stripTypeScriptTypes(raw), {
    Deno: { env: { get: k => env[k] }, serve: h => handler = h },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from: () => query }),
    fetch: async (url, opts) => { calls.push({ url, opts }); return options.fetch(url, opts); },
    Request, Response, AbortSignal, console: { error() {} },
  });
  return { calls, request: body => handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ workspaceId, ...body }) })) };
}
const configured = { OPENAI_API_KEY: 'test-only', AURORA_MODEL: 'test-model' };
test('Aurora exige os dois módulos e não chama IA sem autorização', async () => {
  const h = harness('aurora', { env: configured, member: { role: 'member', permissions: { investments: { view: true } } } });
  assert.equal((await h.request({ snapshot })).status, 403); assert.equal(h.calls.length, 0);
});
test('Aurora sem chave é indisponível, sem inventar uma análise', async () => {
  const h = harness('aurora'); assert.equal((await h.request({ snapshot })).status, 503); assert.equal(h.calls.length, 0);
});
test('Aurora remove campos desconhecidos e extrai todas as mensagens de texto', async () => {
  const h = harness('aurora', { env: configured, fetch: async () => Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Análise A' }, { type: 'output_text', text: 'Análise B' }] }] }) });
  const response = await h.request({ snapshot }); assert.equal(response.status, 200);
  assert.equal((await response.json()).answer, 'Análise A\nAnálise B');
  const sent = JSON.parse(h.calls[0].opts.body); assert.equal(sent.store, false); assert.equal(sent.input.includes('never-send-me'), false);
});
test('Aurora rejeita valores inválidos antes de consumir a API e respostas truncadas', async () => {
  const h = harness('aurora', { env: configured, fetch: async () => Response.json({ status: 'incomplete', output: [] }) });
  assert.equal((await h.request({ snapshot: { ...snapshot, cashBalanceCents: 'invalid' } })).status, 400);
  assert.equal(h.calls.length, 0); assert.equal((await h.request({ snapshot })).status, 502);
});
test('cotações exigem ticker válido, chave e acesso ao ambiente', async () => {
  assert.equal((await harness('market-data').request({ action: 'quotes', symbols: ['PETR4'] })).status, 503);
  assert.equal((await harness('market-data', { env: { BRAPI_TOKEN: 'test-only' } }).request({ action: 'quotes', symbols: ['../../secret'] })).status, 400);
  assert.equal((await harness('market-data', { member: null }).request({ action: 'quotes', symbols: ['PETR4'] })).status, 403);
});
test('cotações parciais preservam indisponibilidade e moeda, preço e data reais', async () => {
  const h = harness('market-data', { env: { BRAPI_TOKEN: 'test-only' }, fetch: async () => Response.json({ results: [
    { symbol: 'PETR4', data: { regularMarketPrice: 30.42, currency: 'BRL', regularMarketTime: '2026-01-01T12:00:00Z' } },
    { symbol: 'VALE3', data: { regularMarketPrice: 10, currency: 'USD', regularMarketTime: '2026-01-01T12:00:00Z' } },
  ] }) });
  const response = await h.request({ action: 'quotes', symbols: ['PETR4', 'VALE3', 'ITUB4'] });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.quotes[0].priceCents, 3042); assert.equal(body.quotes[0].stale, true);
  assert.equal(body.quotes[1].priceCents, null); assert.equal(body.quotes[2].priceCents, null);
  assert.equal(h.calls[0].url.includes('test-only'), false);
});
