import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function edge(name, options = {}) {
  let handler;
  const calls = [];
  const membership = options.membership === undefined ? { role: "owner", active: true } : options.membership;
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: membership }; } };
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-test-key", ...(options.configured ? { PLUGGY_CLIENT_ID: "test-id", PLUGGY_CLIENT_SECRET: "test-secret-not-real" } : {}) };
  const raw = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
  // Git no Windows pode converter o checkout para CRLF. O mock não depende do EOL.
  const source = (options.crlf ? raw.replace(/\r?\n/g, "\r\n") : raw).split(/\r?\n/).filter((line) => !line.startsWith("import ")).join("\n");
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "user-a" } } }) }, from: () => query }),
    fetch: async (url) => { calls.push(url); return options.fetch ? options.fetch(url) : new Response("[]"); },
    Request, Response, AbortSignal, console: { error() {} },
  });
  return { calls, request: (body = {}, authenticated = true) => handler(new Request("https://test.invalid", { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { Authorization: "Bearer test-user-token" } : {}) }, body: JSON.stringify({ workspaceId, ...body }) })) };
}

test("funções não acessam provedores sem sessão ou membership", async () => {
  for (const name of ["market-data", "open-finance"]) {
    for (const options of [{ membership: null }, { user: false }, { membership: null, crlf: true }]) {
      const h = edge(name, options);
      assert.equal((await h.request()).status, 403);
      assert.equal(h.calls.length, 0);
    }
    assert.equal((await edge(name).request({}, false)).status, 403);
  }
});

test("Open Finance não emite token de conexão antes da homologação", async () => {
  const h = edge("open-finance", { configured: true });
  const status = await (await h.request({ action: "status" })).json();
  assert.equal(status.configured, true);
  assert.equal(status.connectionEnabled, false);
  assert.equal((await h.request({ action: "createConnectToken" })).status, 409);
  assert.equal(h.calls.length, 0);
});

test("Open Finance recusa item pertencente a outro ambiente", async () => {
  const h = edge("open-finance", { configured: true, fetch: (url) => new Response(JSON.stringify(url.endsWith("/auth") ? { apiKey: "test-provider-key" } : { id: "item-a", clientUserId: "other-workspace" })) });
  assert.equal((await h.request({ action: "syncItem", itemId: "item-a" })).status, 403);
  assert.equal(h.calls.some((url) => url.includes("/accounts")), false);
});

test("indicadores indisponíveis não são convertidos em zero nem reportados como sucesso", async () => {
  const h = edge("market-data", { fetch: () => new Response(JSON.stringify([{ data: "11/09/2026", valor: "" }])) });
  const response = await h.request();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.indicators.every((item) => item.value === null), true);
});

test("indicadores preservam valor zero válido e identificam dólar como venda", async () => {
  const h = edge("market-data", { fetch: () => new Response(JSON.stringify([{ data: "11/09/2026", valor: "0.00" }])) });
  const response = await h.request();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.indicators[0].value, 0);
  assert.match(body.indicators[0].label, /venda/);
});
