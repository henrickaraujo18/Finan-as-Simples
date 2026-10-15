import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function updaterHarness({ online = true, configured = true, fail = false } = {}) {
  const scheduled = new Map(), windowEvents = new Map(), calls = [];
  let nextTimer = 0;
  const status = { textContent: "" };
  const navigator = { onLine: online };
  const context = {
    window: {
      FSCore: { S: { page: "dashboard" }, load: async () => {} },
      __TAURI__: { core: { invoke: async (command) => {
        calls.push(command);
        if (command !== "check_and_install_update") throw new Error("Login não deveria ser exigido");
        if (fail) throw new Error("Manifesto indisponível: 404");
        return { configured, available: false };
      } } },
      addEventListener(type, callback) { windowEvents.set(type, callback); },
    },
    document: {
      body: {}, getElementById(id) { return id === "updateState" ? status : null; },
      addEventListener() {}, querySelectorAll: () => [],
    },
    navigator, console,
    MutationObserver: class { observe() {} },
    setTimeout(fn, ms) { const id = ++nextTimer; scheduled.set(id, { fn, ms }); return id; },
    clearTimeout(id) { scheduled.delete(id); },
  };
  vm.runInNewContext(readFileSync(new URL("../desktop-dist/auth-v16.js", import.meta.url), "utf8"), context);
  return {
    scheduled, windowEvents, calls, navigator, status,
    async fireOne() {
      const [[id, timer]] = scheduled.entries();
      scheduled.delete(id);
      timer.fn();
      for (let n = 0; n < 12; n++) await Promise.resolve();
      return timer.ms;
    },
  };
}

test("atualizador é agendado antes do login e verifica mesmo com gate de autenticação", async () => {
  const h = updaterHarness({ online: true });
  assert.deepEqual([...h.scheduled.values()].map(x => x.ms), [20000]);
  await h.fireOne();
  assert.equal(h.calls.filter(x => x === "check_and_install_update").length, 1);
  assert.deepEqual([...h.scheduled.values()].map(x => x.ms), [6 * 60 * 60 * 1000]);
});

test("ao reconectar verifica em um segundo sem esperar login nem 20 segundos", async () => {
  const h = updaterHarness({ online: false });
  assert.equal(h.scheduled.size, 0);
  h.navigator.onLine = true;
  h.windowEvents.get("online")();
  assert.deepEqual([...h.scheduled.values()].map(x => x.ms), [1000]);
  await h.fireOne();
  assert.equal(h.calls.filter(x => x === "check_and_install_update").length, 1);
});

test("app não assinado informa instalação manual e não repete verificações inúteis", async () => {
  const h = updaterHarness({ configured: false });
  await h.fireOne();
  assert.match(h.status.textContent, /Instale uma versão assinada manualmente/);
  assert.equal(h.scheduled.size, 0);
  h.windowEvents.get("online")();
  assert.equal(h.scheduled.size, 0);
});

test("erro real do manifesto aparece no aviso; agenda 15 minutos", async () => {
  const h = updaterHarness({ fail: true });
  await h.fireOne();
  assert.match(h.status.textContent, /404/);
  assert.deepEqual([...h.scheduled.values()].map(x => x.ms), [15 * 60 * 1000]);
});

test("versão está sincronizada entre pacote, Cargo, Tauri e lockfiles", () => {
  const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  const version = JSON.parse(read("package.json")).version;
  assert.equal(version, "1.7.2");
  assert.equal(JSON.parse(read("package-lock.json")).version, version);
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, version);
  assert.match(read("src-tauri/Cargo.toml"), new RegExp("version = \"" + version.replaceAll(".", "\\.") + "\""));
  assert.match(read("src-tauri/Cargo.lock").replaceAll("\r\n", "\n"), /name = "financa-simples-desktop"\nversion = "1\.7\.1"/);
});
