import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

async function authHarness(options = {}) {
  const nodes = new Map();
  const observers = [];
  const listeners = new Map();
  const timers = [];
  const delayed = new Map(); let timerId = 0;
  const calls = [];
  let writes = 0;
  const element = () => ({
    id: "", dataset: {}, className: "", disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    querySelectorAll: () => [],
    append(child) { nodes.set(child.id, child); },
    set innerHTML(value) {
      writes++;
      if (value.includes('id="workspaceSelector"')) nodes.set("workspaceSelector", { value: "workspace-a", disabled: false });
    },
  });
  const actions = { prepend(child) { nodes.set(child.id, child); } };
  const permissions = Object.fromEntries(["dashboard", "transactions", "settings", "investments", "accounts"].map((name) => [name, { view: true, create: true, edit: true, delete: true }]));
  const status = { authenticated: true, activeWorkspaceId: "workspace-a", permissions, user: { email: "test@example.com" }, workspaces: [{ id: "workspace-a", name: "A", role: "owner" }, { id: "workspace-b", name: "B", role: "owner" }] };
  const core = { S: { page: "dashboard", edit: { transactions: "old-record" } }, load: async () => {} };
  const context = {
    window: { FSCore: core, __TAURI__: { core: { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "check_and_install_update") {
        if (options.updateFails) throw new Error("offline");
        return { configured: true, available: false };
      }
      return command === "auth_switch_workspace" ? { ...status, activeWorkspaceId: args.workspaceId } : status;
    } } }, addEventListener() {}, dispatchEvent() {} },
    document: { body: {}, getElementById: (id) => nodes.get(id), createElement: element,
      querySelector: (selector) => selector === ".topbar-actions" ? actions : null,
      querySelectorAll: () => [], addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); } },
    navigator: { onLine: Boolean(options.online) }, Event,
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    setTimeout: (fn, ms) => { const id = ++timerId; if (ms === 0) timers.push(fn); else delayed.set(id, { fn, ms }); return id; },
    clearTimeout: id => delayed.delete(id),
    alert() {}, console,
  };
  vm.runInNewContext(readFileSync(new URL("../desktop-dist/auth-v16.js", import.meta.url), "utf8"), context);
  await core.load();
  timers.splice(0).forEach((fn) => fn());
  return { core, calls, nodes, observers, listeners, delayed, auth: context.window.FSAuth, writes: () => writes };
}

test("atualização do cabeçalho converge sem ciclo infinito de MutationObserver", async () => {
  const h = await authHarness();
  assert.equal(h.writes(), 1);
  for (let index = 0; index < 30; index++) h.observers.forEach((callback) => callback());
  assert.equal(h.writes(), 1);
});

test("updater consulta após 20s, repete em 6h e reduz espera para 15min em falha", async () => {
  for (const updateFails of [false, true]) {
    const h = await authHarness({ online: true, updateFails });
    const [id, timer] = [...h.delayed.entries()][0]; assert.equal(timer.ms, 20000);
    h.delayed.delete(id); timer.fn();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(h.calls.filter(c => c.command === "check_and_install_update").length, 1);
    assert.equal([...h.delayed.values()][0].ms, (updateFails ? 15 * 60 : 6 * 60 * 60) * 1000);
  }
});

test("operação em andamento bloqueia troca de ambiente e libera o seletor ao terminar", async () => {
  const h = await authHarness();
  const release = h.auth.lockWorkspace();
  assert.equal(h.nodes.get("workspaceSelector").disabled, true);
  h.listeners.get("change").forEach((fn) => fn({ target: { id: "workspaceSelector", value: "workspace-b" } }));
  assert.equal(h.calls.some((call) => call.command === "auth_switch_workspace"), false);
  assert.equal(h.nodes.get("workspaceSelector").value, "workspace-a");
  release(); release();
  assert.equal(h.nodes.get("workspaceSelector").disabled, false);
  h.listeners.get("change").forEach((fn) => fn({ target: { id: "workspaceSelector", value: "workspace-b" } }));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(h.auth.workspaceId(), "workspace-b");
  assert.equal(h.core.S.edit.transactions, null);
});


test("Open Finance fica fora da gestão de permissões da versão 1.7", () => {
  const source = readFileSync(new URL("../desktop-dist/auth-v16.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\["openFinance",\s*"Open Finance"\]/);
  assert.doesNotMatch(source, /view\("dashboard",\s*"analytics",\s*"openFinance"/);
});
