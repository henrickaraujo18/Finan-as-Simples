import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function render(page) {
  const elements = {
    view: { dataset: {}, innerHTML: "", querySelectorAll: () => [] },
    pageTitle: { textContent: "" },
    workspaceSelector: { value: "" },
  };
  const settings = {
    profileName: "Meu financeiro",
    openingBalanceCents: 0,
    averageMonthlyIncomeCents: 0,
    emergencyReserveGoalCents: 0,
  };
  const data = {
    settings: [], investments: [], investment_goals: [], market_data: [],
    open_finance_connections: [], open_finance_accounts: [], open_finance_bills: [],
  };
  const money = (cents) => `R$ ${(Number(cents || 0) / 100).toFixed(2)}`;
  const core = {
    S: { page, month: "2026-09", settings, data },
    INVESTMENT_TYPES: ["CDB", "Ação"], money, pct: (value) => `${Number(value || 0).toFixed(1)}%`,
    parseMoney: (value) => Math.round(Number(String(value || "0").replaceAll(".", "").replace(",", ".")) * 100) || 0,
    inputMoney: (value) => (Number(value || 0) / 100).toFixed(2).replace(".", ","), today: () => "2026-09-11",
    save: async () => ({}), bulkSave: async () => [], remove: async () => {}, load: async () => {},
    investments: () => data.investments, investmentGoals: () => data.investment_goals, marketData: () => data.market_data,
    openFinanceConnections: () => data.open_finance_connections, openFinanceAccounts: () => data.open_finance_accounts,
    openFinanceBills: () => data.open_finance_bills,
    monthMetrics: () => ({ expensePaid: 0 }), investmentMetrics: () => ({ cost: 0, current: 0, gain: 0 }), totalCashBalance: () => 0,
  };
  const context = {
    window: { FSCore: core, addEventListener: () => {} },
    document: {
      body: {}, getElementById: (id) => elements[id] || null,
      addEventListener: () => {}, createElement: () => ({ addEventListener: () => {} }),
    },
    navigator: { onLine: false },
    MutationObserver: class { observe() {} },
    FormData: class { entries() { return []; } },
    Intl, Date, Math, Number, String, Set, Map, Promise,
    confirm: () => false,
    setTimeout: () => 0,
    queueMicrotask: (callback) => callback(),
    console,
  };
  vm.createContext(context);
  const source = readFileSync(new URL("../desktop-dist/app-v17.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "app-v17.js" });
  return elements;
}

test("tela avançada de investimentos renderiza carteira e metas", () => {
  const elements = render("investments");
  assert.match(elements.view.innerHTML, /Indicadores oficiais/);
  assert.match(elements.view.innerHTML, /Nova meta financeira/);
  assert.match(elements.view.innerHTML, /Como preencher a posição/);
  assert.equal(elements.pageTitle.textContent, "Investimentos");
});

test("tela Open Finance renderiza estado offline com dados locais", () => {
  const elements = render("openfinance");
  assert.match(elements.view.innerHTML, /Open Finance/);
  assert.match(elements.view.innerHTML, /Disponível ao entrar online/);
  assert.match(elements.view.innerHTML, /Contas e cartões sincronizados/);
  assert.equal(elements.pageTitle.textContent, "Open Finance");
});
