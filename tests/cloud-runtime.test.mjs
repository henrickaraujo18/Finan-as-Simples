import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
function harness(fetch, offline = false) {
  const calls = []; const timers = [];
  const window = { FSCore: {}, FSCloudConfig: { supabaseUrl: 'https://test.invalid', supabasePublishableKey: 'public' }, __TAURI__: { core: { invoke: async (command, args) => { calls.push(command); return { authenticated: command !== 'auth_logout', workspaces: [] }; } } }, addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('../desktop-dist/cloud-runtime-v16.js', import.meta.url), 'utf8'), {
    window, navigator: { onLine: !offline }, document: { documentElement: {}, getElementById: () => null, querySelector: () => null, addEventListener() {} },
    MutationObserver: class { observe() {} }, setTimeout: fn => timers.push(fn), clearTimeout() {}, setInterval() {}, fetch, console,
  });
  return { calls, timers, invoke: window.__TAURI__.core.invoke, runtime: window.FSCloudRuntime };
}
test('falha após autenticação local fecha a sessão parcial', async () => {
  const h = harness(async url => Response.json(url.includes('/signup') ? { user: { identities: [] } } : { error: 'invalid_credentials' }, { status: url.includes('/signup') ? 200 : 400 }));
  await assert.rejects(h.invoke('auth_login', { email: 'test@example.invalid', password: 'not-real' }));
  assert.equal(h.calls.at(-1), 'auth_logout'); assert.equal(h.runtime.isAuthenticated(), false);
});
test('offline usa autenticação local sem solicitar token cloud', async () => {
  let requests = 0; const h = harness(async () => { requests++; }, true);
  await h.invoke('auth_login', { email: 'test@example.invalid', password: 'not-real' });
  assert.deepEqual(h.calls, ['auth_login']); assert.equal(requests, 0);
});
test('login online reconcilia e sincroniza; alteração local agenda nova sincronização', async () => {
  const h = harness(async () => Response.json({ access_token: 'fake', refresh_token: 'fake', expires_in: 3600 }));
  await h.invoke('auth_login', {});
  assert.deepEqual(h.calls, ['auth_login', 'cloud_reconcile_login', 'cloud_sync']);
  await h.invoke('upsert_entity', {}); assert.equal(h.timers.length, 1);
  await h.invoke('auth_logout'); assert.equal(h.runtime.isAuthenticated(), false);
});
