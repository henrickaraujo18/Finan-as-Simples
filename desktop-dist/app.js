const tauriInvoke = window.__TAURI__?.core?.invoke;

const ENTITY_TYPES = [
  "transactions",
  "quotes",
  "products",
  "inventory",
  "employees",
  "settings",
  "customers",
  "suppliers",
];

const defaults = {
  companyName: "Minha empresa",
  openingBalanceCents: 0,
  taxRegime: "simples",
  effectiveTaxRate: 6,
  presumedTaxRate: 11.33,
  realIncomeTaxRate: 34,
  payrollBurdenRate: 28.8,
  fixedCostRate: 10,
  desiredMargin: 20,
};

const state = {
  page: "dashboard",
  online: navigator.onLine,
  runtime: null,
  data: Object.fromEntries(ENTITY_TYPES.map((type) => [type, []])),
  settings: { ...defaults },
  reportMonth: new Date().toISOString().slice(0, 7),
};

const el = (id) => document.getElementById(id);

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(cents = 0) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function parseMoney(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
  if (!text) return 0;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function pct(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function today() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function monthOf(date) {
  return String(date || "").slice(0, 7);
}

function normalizeTauriRow(row) {
  return {
    id: row.id,
    ...(row.data || {}),
    _version: row.version,
    _syncState: row.syncState,
    _updatedAt: row.updatedAt,
  };
}

function openWebDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("financa-simples-web", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entities")) {
        const store = db.createObjectStore("entities", { keyPath: "id" });
        store.createIndex("entityType", "entityType", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function webList(entityType) {
  const db = await openWebDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("entities", "readonly");
    const req = tx.objectStore("entities").index("entityType").getAll(entityType);
    req.onsuccess = () => resolve((req.result || []).filter((item) => !item.deleted).map((item) => ({
      id: item.id,
      ...(item.data || {}),
      _version: item.version,
      _syncState: "local",
      _updatedAt: item.updatedAt,
    })));
    req.onerror = () => reject(req.error);
  });
}

async function webSave(entityType, data, id = null) {
  const db = await openWebDb();
  const recordId = id || uuid();
  const current = await new Promise((resolve, reject) => {
    const tx = db.transaction("entities", "readonly");
    const req = tx.objectStore("entities").get(recordId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  const now = new Date().toISOString();
  const record = {
    id: recordId,
    entityType,
    data,
    version: (current?.version || 0) + 1,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    deleted: false,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction("entities", "readwrite");
    tx.objectStore("entities").put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return { id: recordId, ...data, _version: record.version, _syncState: "local", _updatedAt: now };
}

async function webDelete(entityType, id) {
  const db = await openWebDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("entities", "readwrite");
    const store = tx.objectStore("entities");
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, deleted: true, version: (req.result.version || 0) + 1, updatedAt: new Date().toISOString() });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

const storage = {
  async runtime() {
    if (tauriInvoke) return tauriInvoke("runtime_status");
    return { platform: "web", storage: "IndexedDB do navegador", offlineReady: true, syncQueueEnabled: false, databasePath: "Navegador" };
  },
  async list(type) {
    if (tauriInvoke) return (await tauriInvoke("list_entities", { entityType: type })).map(normalizeTauriRow);
    return webList(type);
  },
  async save(type, data, id = null) {
    if (tauriInvoke) return normalizeTauriRow(await tauriInvoke("upsert_entity", { input: { entityType: type, id, data } }));
    return webSave(type, data, id);
  },
  async remove(type, id) {
    if (tauriInvoke) return tauriInvoke("delete_entity", { entityType: type, id });
    return webDelete(type, id);
  },
  async pendingCount() {
    return tauriInvoke ? tauriInvoke("pending_sync_count") : 0;
  },
  async backup() {
    if (tauriInvoke) return tauriInvoke("create_backup");
    const snapshot = await buildSnapshot();
    downloadText(`financa-simples-backup-${today()}.json`, JSON.stringify(snapshot, null, 2), "application/json");
    return "Backup JSON baixado pelo navegador";
  },
};

async function loadAll() {
  const entries = await Promise.all(ENTITY_TYPES.map(async (type) => [type, await storage.list(type)]));
  for (const [type, rows] of entries) state.data[type] = rows;
  const saved = state.data.settings[0];
  state.settings = { ...defaults, ...(saved || {}) };
}

async function reloadType(type) {
  state.data[type] = await storage.list(type);
  if (type === "settings") state.settings = { ...defaults, ...(state.data.settings[0] || {}) };
}

function transactions() {
  return state.data.transactions || [];
}

function paidTransactions() {
  return transactions().filter((t) => t.status !== "pending");
}

function cashBalance() {
  return Number(state.settings.openingBalanceCents || 0) + paidTransactions().reduce((sum, t) => sum + (t.kind === "income" ? t.amountCents : -t.amountCents), 0);
}

function monthTransactions(month = state.reportMonth) {
  return transactions().filter((t) => monthOf(t.date) === month);
}

function monthMetrics(month = state.reportMonth) {
  const rows = monthTransactions(month);
  const revenue = rows.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amountCents || 0), 0);
  const expenses = rows.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amountCents || 0), 0);
  const resultBeforeTax = revenue - expenses;
  let estimatedTax = 0;
  if (state.settings.taxRegime === "real") {
    estimatedTax = Math.max(resultBeforeTax, 0) * Number(state.settings.realIncomeTaxRate || 0) / 100;
  } else if (state.settings.taxRegime === "presumido") {
    estimatedTax = revenue * Number(state.settings.presumedTaxRate || 0) / 100;
  } else {
    estimatedTax = revenue * Number(state.settings.effectiveTaxRate || 0) / 100;
  }
  return { rows, revenue, expenses, resultBeforeTax, estimatedTax: Math.round(estimatedTax), net: Math.round(resultBeforeTax - estimatedTax) };
}

function payrollTotal() {
  return (state.data.employees || []).filter((e) => e.active !== false).reduce((s, e) => s + Number(e.totalCostCents || 0), 0);
}

function inventoryValue() {
  return (state.data.inventory || []).reduce((s, i) => s + Math.round(Number(i.quantity || 0) * Number(i.unitCostCents || 0)), 0);
}

function receivables() {
  return transactions().filter((t) => t.kind === "income" && t.status === "pending").reduce((s, t) => s + Number(t.amountCents || 0), 0);
}

function payables() {
  return transactions().filter((t) => t.kind === "expense" && t.status === "pending").reduce((s, t) => s + Number(t.amountCents || 0), 0);
}

function pageTitle() {
  return {
    dashboard: "Visão geral",
    finance: "Financeiro",
    quotes: "Orçamentos de venda",
    products: "Produtos e precificação",
    inventory: "Estoque",
    employees: "Gestão de funcionários",
    reports: "Relatórios e análises",
    integrations: "Integrações",
    settings: "Configurações",
  }[state.page] || "Finança Simples";
}

function renderShellStatus() {
  state.online = navigator.onLine;
  el("pageTitle").textContent = pageTitle();
  el("connectionBadge").textContent = state.online ? "Online" : "Offline";
  el("connectionBadge").classList.toggle("online", state.online);
  el("platformBadge").textContent = state.runtime?.platform === "desktop" ? "Desktop" : "Web";
  el("storageLabel").textContent = state.runtime?.storage || "Armazenamento local";
  document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.page === state.page));
}

function kpi(label, value, hint = "") {
  return `<article class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`;
}

function dashboardView() {
  const metrics = monthMetrics(new Date().toISOString().slice(0, 7));
  const margin = metrics.revenue ? (metrics.net / metrics.revenue) * 100 : 0;
  const lowStock = state.data.inventory.filter((i) => Number(i.quantity || 0) <= Number(i.minQuantity || 0)).length;
  const recent = [...transactions()].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  return `
    <section class="hero"><div><h2>${escapeHtml(state.settings.companyName)}</h2><p>Gestão financeira local-first. O desktop continua operando sem internet e a mesma interface roda no navegador.</p></div><button class="primary" data-page="finance">Novo lançamento</button></section>
    <section class="kpi-grid">
      ${kpi("Saldo de caixa", formatMoney(cashBalance()), "movimentos pagos")}
      ${kpi("Receita do mês", formatMoney(metrics.revenue), "competência")}
      ${kpi("Resultado líquido estimado", formatMoney(metrics.net), `margem ${pct(margin)}`)}
      ${kpi("A receber", formatMoney(receivables()), "pendente")}
      ${kpi("A pagar", formatMoney(payables()), "pendente")}
      ${kpi("Estoque", formatMoney(inventoryValue()), `${lowStock} alerta(s)`)}
      ${kpi("Custo mensal de pessoal", formatMoney(payrollTotal()), "funcionários ativos")}
      ${kpi("Orçamentos", String(state.data.quotes.length), "propostas cadastradas")}
    </section>
    <section class="panel"><div class="panel-head"><h3>Movimentações recentes</h3><button class="ghost" data-page="finance">Ver financeiro</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th class="right">Valor</th></tr></thead><tbody>
      ${recent.length ? recent.map((t) => `<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.description)}</td><td>${escapeHtml(t.category)}</td><td><span class="tag">${t.status === "pending" ? "Pendente" : "Pago"}</span></td><td class="right ${t.kind}">${t.kind === "income" ? "+" : "−"}${formatMoney(t.amountCents)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">Nenhum lançamento cadastrado.</td></tr>`}
    </tbody></table></div></section>`;
}

function financeView() {
  const rows = [...transactions()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `
    <div class="two-col">
      <section class="panel"><div class="panel-head"><h3>Novo lançamento</h3></div><form id="transactionForm" class="form panel-body">
        <div class="form-grid">
          <label>Tipo<select name="kind"><option value="income">Receita</option><option value="expense">Despesa</option></select></label>
          <label>Status<select name="status"><option value="paid">Pago/Recebido</option><option value="pending">Pendente</option></select></label>
          <label class="wide">Descrição<input name="description" required maxlength="160" placeholder="Venda, fornecedor, aluguel..."></label>
          <label>Categoria<input name="category" required placeholder="Vendas, Fornecedores..."></label>
          <label>Valor<input name="amount" required inputmode="decimal" placeholder="0,00"></label>
          <label>Data<input name="date" type="date" required value="${today()}"></label>
          <label>Vencimento<input name="dueDate" type="date"></label>
        </div><button class="primary" type="submit">Salvar lançamento</button><span class="form-msg" id="transactionMsg"></span>
      </form></section>
      <section class="panel"><div class="panel-head"><h3>Resumo</h3></div><div class="panel-body mini-kpis">
        ${kpi("Saldo", formatMoney(cashBalance()))}${kpi("A receber", formatMoney(receivables()))}${kpi("A pagar", formatMoney(payables()))}
      </div></section>
    </div>
    <section class="panel"><div class="panel-head"><h3>Livro caixa / contas</h3><button class="ghost" data-action="export-transactions">Exportar CSV</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Vencimento</th><th class="right">Valor</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((t) => `<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.description)}</td><td>${escapeHtml(t.category)}</td><td>${t.status === "pending" ? "Pendente" : "Pago"}</td><td>${escapeHtml(t.dueDate || "—")}</td><td class="right ${t.kind}">${t.kind === "income" ? "+" : "−"}${formatMoney(t.amountCents)}</td><td class="right"><button class="danger ghost" data-action="delete" data-type="transactions" data-id="${t.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty">Sem lançamentos.</td></tr>`}
    </tbody></table></div></section>`;
}

function quoteTotal(q) {
  const gross = Number(q.quantity || 0) * Number(q.unitPriceCents || 0);
  return Math.max(0, Math.round(gross * (1 - Number(q.discountPercent || 0) / 100)));
}

function quotesView() {
  const quotes = [...state.data.quotes].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `
    <div class="two-col"><section class="panel"><div class="panel-head"><h3>Novo orçamento</h3></div><form id="quoteForm" class="form panel-body"><div class="form-grid">
      <label class="wide">Cliente<input name="customer" required placeholder="Nome do cliente"></label>
      <label class="wide">Descrição<input name="description" required placeholder="Produto ou serviço"></label>
      <label>Quantidade<input name="quantity" type="number" min="0.01" step="0.01" value="1" required></label>
      <label>Valor unitário<input name="unitPrice" inputmode="decimal" required placeholder="0,00"></label>
      <label>Desconto %<input name="discountPercent" type="number" min="0" max="100" step="0.01" value="0"></label>
      <label>Validade<input name="validUntil" type="date"></label>
    </div><button class="primary">Criar orçamento</button></form></section>
    <section class="panel"><div class="panel-head"><h3>Fluxo</h3></div><div class="panel-body"><p class="muted">Aprovar → importar para o financeiro → acompanhar o recebimento. A importação cria uma conta a receber e preserva o vínculo com o orçamento.</p></div></section></div>
    <section class="cards-list">${quotes.length ? quotes.map((q) => `<article class="panel quote-card"><div><small>${escapeHtml(q.number)}</small><h3>${escapeHtml(q.customer)}</h3><p>${escapeHtml(q.description)}</p><strong>${formatMoney(quoteTotal(q))}</strong></div><div class="quote-actions"><span class="tag ${q.status}">${q.status === "approved" ? "Aprovado" : q.status === "rejected" ? "Recusado" : "Rascunho"}</span>${q.status === "draft" ? `<button class="ghost" data-action="quote-status" data-id="${q.id}" data-status="approved">Aprovar</button><button class="ghost" data-action="quote-status" data-id="${q.id}" data-status="rejected">Recusar</button>` : ""}${q.status === "approved" && !q.importedTransactionId ? `<button class="primary" data-action="quote-import" data-id="${q.id}">Importar financeiro</button>` : ""}${q.importedTransactionId ? `<span class="muted">Importado</span>` : ""}<button class="danger ghost" data-action="delete" data-type="quotes" data-id="${q.id}">Excluir</button></div></article>`).join("") : `<div class="empty panel">Nenhum orçamento cadastrado.</div>`}</section>`;
}

function productRecommendedPrice(p) {
  const base = Number(p.costCents || 0) + Number(p.laborCostCents || 0);
  const overhead = Number(p.overheadPercent ?? state.settings.fixedCostRate ?? 0) / 100;
  const tax = Number(p.taxPercent ?? state.settings.effectiveTaxRate ?? 0) / 100;
  const margin = Number(p.targetMarginPercent ?? state.settings.desiredMargin ?? 0) / 100;
  const loadedCost = base * (1 + overhead);
  const denominator = 1 - tax - margin;
  return denominator > 0 ? Math.round(loadedCost / denominator) : 0;
}

function productsView() {
  const products = state.data.products;
  return `
    <div class="two-col"><section class="panel"><div class="panel-head"><h3>Novo produto / serviço</h3></div><form id="productForm" class="form panel-body"><div class="form-grid">
      <label class="wide">Nome<input name="name" required></label><label>SKU<input name="sku"></label>
      <label>Custo de insumos<input name="cost" inputmode="decimal" required placeholder="0,00"></label>
      <label>Mão de obra direta<input name="laborCost" inputmode="decimal" placeholder="0,00"></label>
      <label>Rateio custos fixos %<input name="overheadPercent" type="number" step="0.01" value="${state.settings.fixedCostRate}"></label>
      <label>Tributos %<input name="taxPercent" type="number" step="0.01" value="${state.settings.effectiveTaxRate}"></label>
      <label>Margem desejada %<input name="targetMarginPercent" type="number" step="0.01" value="${state.settings.desiredMargin}"></label>
    </div><button class="primary">Calcular e salvar</button></form></section>
    <section class="panel"><div class="panel-head"><h3>Parâmetros</h3></div><div class="panel-body"><p class="muted">Regime: <strong>${escapeHtml(state.settings.taxRegime)}</strong>. A precificação usa custo + mão de obra + rateio de custos fixos e desconta tributos e margem desejada do preço final.</p></div></section></div>
    <section class="panel"><div class="panel-head"><h3>Produtos</h3><button class="ghost" data-action="export-products">Exportar CSV</button></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th class="right">Custo</th><th class="right">Preço sugerido</th><th class="right">Margem alvo</th><th></th></tr></thead><tbody>${products.length ? products.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sku || "—")}</td><td class="right">${formatMoney(Number(p.costCents || 0) + Number(p.laborCostCents || 0))}</td><td class="right"><strong>${formatMoney(p.salePriceCents || productRecommendedPrice(p))}</strong></td><td class="right">${pct(p.targetMarginPercent)}</td><td class="right"><button class="danger ghost" data-action="delete" data-type="products" data-id="${p.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty">Nenhum produto.</td></tr>`}</tbody></table></div></section>`;
}

function inventoryView() {
  const items = state.data.inventory;
  const alerts = items.filter((i) => Number(i.quantity || 0) <= Number(i.minQuantity || 0));
  return `
    <div class="two-col"><section class="panel"><div class="panel-head"><h3>Novo item de estoque</h3></div><form id="inventoryForm" class="form panel-body"><div class="form-grid"><label class="wide">Item<input name="name" required></label><label>Unidade<input name="unit" value="un"></label><label>Quantidade<input name="quantity" type="number" step="0.001" value="0"></label><label>Estoque mínimo<input name="minQuantity" type="number" step="0.001" value="0"></label><label>Custo unitário<input name="unitCost" inputmode="decimal" placeholder="0,00"></label></div><button class="primary">Salvar item</button></form></section>
    <section class="panel"><div class="panel-head"><h3>Indicadores</h3></div><div class="panel-body mini-kpis">${kpi("Valor em estoque", formatMoney(inventoryValue()))}${kpi("Abaixo do mínimo", String(alerts.length))}</div></section></div>
    <section class="panel"><div class="panel-head"><h3>Posição de estoque</h3></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Unidade</th><th class="right">Quantidade</th><th class="right">Mínimo</th><th class="right">Custo unit.</th><th class="right">Valor</th><th></th></tr></thead><tbody>${items.length ? items.map((i) => `<tr class="${Number(i.quantity || 0) <= Number(i.minQuantity || 0) ? "alert-row" : ""}"><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.unit)}</td><td class="right">${Number(i.quantity || 0).toLocaleString("pt-BR")}</td><td class="right">${Number(i.minQuantity || 0).toLocaleString("pt-BR")}</td><td class="right">${formatMoney(i.unitCostCents)}</td><td class="right">${formatMoney(Math.round(Number(i.quantity || 0) * Number(i.unitCostCents || 0)))}</td><td class="right"><button class="ghost" data-action="stock-adjust" data-id="${i.id}">Movimentar</button><button class="danger ghost" data-action="delete" data-type="inventory" data-id="${i.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty">Nenhum item em estoque.</td></tr>`}</tbody></table></div></section>`;
}

function employeesView() {
  const employees = state.data.employees;
  return `
    <div class="two-col"><section class="panel"><div class="panel-head"><h3>Novo funcionário</h3></div><form id="employeeForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome<input name="name" required></label><label>Cargo<input name="role" required></label><label>Salário bruto<input name="salary" inputmode="decimal" required></label><label>Benefícios<input name="benefits" inputmode="decimal" placeholder="0,00"></label><label>Outros custos<input name="other" inputmode="decimal" placeholder="0,00"></label><label>Encargos estimados %<input name="burdenRate" type="number" step="0.01" value="${state.settings.payrollBurdenRate}"></label></div><button class="primary">Cadastrar funcionário</button></form></section>
    <section class="panel"><div class="panel-head"><h3>Custo da equipe</h3></div><div class="panel-body mini-kpis">${kpi("Mensal", formatMoney(payrollTotal()))}${kpi("Ativos", String(employees.filter((e) => e.active !== false).length))}</div></section></div>
    <section class="panel"><div class="panel-head"><h3>Funcionários</h3></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Cargo</th><th class="right">Salário</th><th class="right">Encargos</th><th class="right">Custo total</th><th></th></tr></thead><tbody>${employees.length ? employees.map((e) => `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.role)}</td><td class="right">${formatMoney(e.salaryCents)}</td><td class="right">${pct(e.burdenRate)}</td><td class="right"><strong>${formatMoney(e.totalCostCents)}</strong></td><td class="right"><button class="danger ghost" data-action="delete" data-type="employees" data-id="${e.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty">Nenhum funcionário.</td></tr>`}</tbody></table></div></section>`;
}

function reportsView() {
  const m = monthMetrics(state.reportMonth);
  const expenseGroups = new Map();
  m.rows.filter((t) => t.kind === "expense").forEach((t) => expenseGroups.set(t.category || "Outros", (expenseGroups.get(t.category || "Outros") || 0) + Number(t.amountCents || 0)));
  const cash = cashBalance();
  const inventory = inventoryValue();
  const rec = receivables();
  const pay = payables();
  const assets = cash + inventory + rec;
  const liabilities = pay;
  const equity = assets - liabilities;
  const currentRatio = liabilities > 0 ? assets / liabilities : null;
  return `
    <section class="report-toolbar panel"><label>Competência<input id="reportMonth" type="month" value="${state.reportMonth}"></label><div><button class="ghost" data-action="print-report">Imprimir / PDF</button><button class="ghost" data-action="export-transactions">CSV</button></div></section>
    <section class="kpi-grid">${kpi("Receita", formatMoney(m.revenue))}${kpi("Despesas", formatMoney(m.expenses))}${kpi("Tributos estimados", formatMoney(m.estimatedTax), state.settings.taxRegime)}${kpi("Resultado líquido", formatMoney(m.net))}${kpi("Ativos", formatMoney(assets))}${kpi("Passivos", formatMoney(liabilities))}${kpi("Patrimônio líquido", formatMoney(equity))}${kpi("Liquidez", currentRatio == null ? "∞" : currentRatio.toFixed(2))}</section>
    <div class="two-col"><section class="panel"><div class="panel-head"><h3>DRE gerencial</h3></div><div class="report-lines"><div><span>Receita bruta</span><strong>${formatMoney(m.revenue)}</strong></div>${[...expenseGroups.entries()].map(([name, value]) => `<div><span>(−) ${escapeHtml(name)}</span><strong>${formatMoney(value)}</strong></div>`).join("")}<div><span>Resultado antes dos tributos</span><strong>${formatMoney(m.resultBeforeTax)}</strong></div><div><span>(−) Tributos estimados</span><strong>${formatMoney(m.estimatedTax)}</strong></div><div class="total"><span>Resultado líquido</span><strong>${formatMoney(m.net)}</strong></div></div></section>
    <section class="panel"><div class="panel-head"><h3>Análise vertical</h3></div><div class="report-lines"><div><span>Receita</span><strong>100,0%</strong></div>${[...expenseGroups.entries()].map(([name, value]) => `<div><span>${escapeHtml(name)}</span><strong>${m.revenue ? pct(value / m.revenue * 100) : "0,0%"}</strong></div>`).join("")}<div class="total"><span>Margem líquida</span><strong>${m.revenue ? pct(m.net / m.revenue * 100) : "0,0%"}</strong></div></div></section></div>
    <div class="two-col"><section class="panel"><div class="panel-head"><h3>Balanço simplificado</h3></div><div class="report-lines"><div><span>Caixa e bancos</span><strong>${formatMoney(cash)}</strong></div><div><span>Contas a receber</span><strong>${formatMoney(rec)}</strong></div><div><span>Estoques</span><strong>${formatMoney(inventory)}</strong></div><div class="total"><span>Total do ativo</span><strong>${formatMoney(assets)}</strong></div><div><span>Contas a pagar</span><strong>${formatMoney(pay)}</strong></div><div class="total"><span>Patrimônio líquido</span><strong>${formatMoney(equity)}</strong></div></div></section>
    <section class="panel"><div class="panel-head"><h3>Saúde financeira</h3></div><div class="panel-body"><p class="analysis-text">${financialDiagnosis(m, assets, liabilities)}</p></div></section></div>`;
}

function financialDiagnosis(m, assets, liabilities) {
  const margin = m.revenue ? m.net / m.revenue * 100 : 0;
  const liquidity = liabilities ? assets / liabilities : 99;
  const parts = [];
  parts.push(m.net >= 0 ? `O período apresenta resultado positivo de ${formatMoney(m.net)}.` : `O período apresenta prejuízo de ${formatMoney(Math.abs(m.net))}.`);
  parts.push(`A margem líquida estimada é ${pct(margin)}.`);
  parts.push(liquidity >= 1.2 ? `A liquidez corrente simplificada está confortável (${liquidity.toFixed(2)}).` : `A liquidez simplificada está pressionada (${liquidity.toFixed(2)}); priorize caixa e redução de obrigações de curto prazo.`);
  return parts.join(" ");
}

function integrationsView() {
  return `<section class="integration-grid">
    ${integrationCard("Open Finance / Pluggy", "Importação e conciliação bancária", "A conexão com o provedor exige backend seguro; dados já sincronizados devem permanecer em cache local.")}
    ${integrationCard("Cotações", "Moedas, índices e ativos", "Quando online o sistema poderá atualizar as séries; offline usa a última informação armazenada.")}
    ${integrationCard("Agente IA", "Análise financeira assistida", "KPIs e cálculos determinísticos funcionam localmente; respostas generativas exigem serviço online.")}
    ${integrationCard("Sincronização em nuvem", "Desktop ↔ Web", "A camada local já versiona registros e mantém fila; o endpoint de nuvem deve ser configurado antes de produção multiusuário.")}
  </section>`;
}

function integrationCard(title, subtitle, text) {
  return `<article class="panel integration-card"><div class="panel-head"><h3>${escapeHtml(title)}</h3><span class="tag ${state.online ? "approved" : ""}">${state.online ? "Internet disponível" : "Offline"}</span></div><div class="panel-body"><strong>${escapeHtml(subtitle)}</strong><p class="muted">${escapeHtml(text)}</p></div></article>`;
}

function settingsView() {
  return `<section class="panel"><div class="panel-head"><h3>Empresa e parâmetros gerenciais</h3></div><form id="settingsForm" class="form panel-body"><div class="form-grid">
    <label class="wide">Nome da empresa<input name="companyName" value="${escapeHtml(state.settings.companyName)}"></label>
    <label>Saldo inicial<input name="openingBalance" value="${(Number(state.settings.openingBalanceCents || 0) / 100).toFixed(2).replace(".", ",")}"></label>
    <label>Regime tributário<select name="taxRegime"><option value="simples" ${state.settings.taxRegime === "simples" ? "selected" : ""}>Simples Nacional</option><option value="presumido" ${state.settings.taxRegime === "presumido" ? "selected" : ""}>Lucro Presumido</option><option value="real" ${state.settings.taxRegime === "real" ? "selected" : ""}>Lucro Real</option></select></label>
    <label>Alíquota efetiva Simples %<input name="effectiveTaxRate" type="number" step="0.01" value="${state.settings.effectiveTaxRate}"></label>
    <label>Tributos Presumido %<input name="presumedTaxRate" type="number" step="0.01" value="${state.settings.presumedTaxRate}"></label>
    <label>IR/CSLL Real %<input name="realIncomeTaxRate" type="number" step="0.01" value="${state.settings.realIncomeTaxRate}"></label>
    <label>Encargos de folha %<input name="payrollBurdenRate" type="number" step="0.01" value="${state.settings.payrollBurdenRate}"></label>
    <label>Rateio de custos fixos %<input name="fixedCostRate" type="number" step="0.01" value="${state.settings.fixedCostRate}"></label>
    <label>Margem padrão %<input name="desiredMargin" type="number" step="0.01" value="${state.settings.desiredMargin}"></label>
  </div><div class="button-row"><button class="primary">Salvar configurações</button><button type="button" class="ghost" data-action="backup">Criar backup</button></div><p class="muted">Os percentuais tributários são parâmetros gerenciais configuráveis, não substituem a apuração fiscal oficial.</p><div id="settingsMsg" class="form-msg"></div></form></section>`;
}

function render() {
  renderShellStatus();
  const views = {
    dashboard: dashboardView,
    finance: financeView,
    quotes: quotesView,
    products: productsView,
    inventory: inventoryView,
    employees: employeesView,
    reports: reportsView,
    integrations: integrationsView,
    settings: settingsView,
  };
  el("view").innerHTML = (views[state.page] || dashboardView)();
  bindForms();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForms() {
  el("transactionForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = formData(event.currentTarget);
    const amountCents = parseMoney(f.amount);
    if (amountCents <= 0) return setMsg("transactionMsg", "Informe um valor válido.", true);
    await storage.save("transactions", { kind: f.kind, status: f.status, description: f.description.trim(), category: f.category.trim(), amountCents, date: f.date, dueDate: f.dueDate || "", source: "manual", createdAt: new Date().toISOString() });
    await reloadType("transactions"); render();
  });

  el("quoteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const f = formData(event.currentTarget);
    const count = state.data.quotes.length + 1;
    await storage.save("quotes", { number: `ORC-${new Date().getFullYear()}-${String(count).padStart(4, "0")}`, customer: f.customer.trim(), description: f.description.trim(), quantity: Number(f.quantity || 1), unitPriceCents: parseMoney(f.unitPrice), discountPercent: Number(f.discountPercent || 0), date: today(), validUntil: f.validUntil || "", status: "draft", importedTransactionId: null });
    await reloadType("quotes"); render();
  });

  el("productForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const f = formData(event.currentTarget);
    const product = { name: f.name.trim(), sku: f.sku.trim(), costCents: parseMoney(f.cost), laborCostCents: parseMoney(f.laborCost), overheadPercent: Number(f.overheadPercent || 0), taxPercent: Number(f.taxPercent || 0), targetMarginPercent: Number(f.targetMarginPercent || 0) };
    product.salePriceCents = productRecommendedPrice(product);
    if (!product.salePriceCents) return alert("Tributos + margem precisam ser menores que 100%.");
    await storage.save("products", product); await reloadType("products"); render();
  });

  el("inventoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const f = formData(event.currentTarget);
    await storage.save("inventory", { name: f.name.trim(), unit: f.unit.trim() || "un", quantity: Number(f.quantity || 0), minQuantity: Number(f.minQuantity || 0), unitCostCents: parseMoney(f.unitCost) });
    await reloadType("inventory"); render();
  });

  el("employeeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const f = formData(event.currentTarget);
    const salaryCents = parseMoney(f.salary), benefitsCents = parseMoney(f.benefits), otherCents = parseMoney(f.other), burdenRate = Number(f.burdenRate || 0);
    const totalCostCents = Math.round(salaryCents * (1 + burdenRate / 100) + benefitsCents + otherCents);
    await storage.save("employees", { name: f.name.trim(), role: f.role.trim(), salaryCents, benefitsCents, otherCents, burdenRate, totalCostCents, active: true });
    await reloadType("employees"); render();
  });

  el("settingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const f = formData(event.currentTarget);
    const data = { companyName: f.companyName.trim() || "Minha empresa", openingBalanceCents: parseMoney(f.openingBalance), taxRegime: f.taxRegime, effectiveTaxRate: Number(f.effectiveTaxRate || 0), presumedTaxRate: Number(f.presumedTaxRate || 0), realIncomeTaxRate: Number(f.realIncomeTaxRate || 0), payrollBurdenRate: Number(f.payrollBurdenRate || 0), fixedCostRate: Number(f.fixedCostRate || 0), desiredMargin: Number(f.desiredMargin || 0) };
    await storage.save("settings", data, state.data.settings[0]?.id || null); await reloadType("settings"); setMsg("settingsMsg", "Configurações salvas localmente."); renderShellStatus();
  });

  el("reportMonth")?.addEventListener("change", (event) => { state.reportMonth = event.target.value; render(); });
}

function setMsg(id, text, error = false) {
  const node = el(id); if (!node) return; node.textContent = text; node.classList.toggle("error", error);
}

async function buildSnapshot() {
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), platform: state.runtime?.platform, data: Object.fromEntries(ENTITY_TYPES.map((t) => [t, state.data[t]])) };
}

function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportTransactions() {
  const header = ["Data", "Tipo", "Status", "Descrição", "Categoria", "Valor", "Vencimento"];
  const rows = transactions().map((t) => [t.date, t.kind, t.status, t.description, t.category, (Number(t.amountCents || 0) / 100).toFixed(2), t.dueDate || ""]);
  downloadText(`lancamentos-${today()}.csv`, [header, ...rows].map((r) => r.map(csvEscape).join(";")).join("\n"), "text/csv;charset=utf-8");
}

function exportProducts() {
  const header = ["Produto", "SKU", "Custo", "Preço sugerido", "Margem alvo %"];
  const rows = state.data.products.map((p) => [p.name, p.sku || "", ((Number(p.costCents || 0) + Number(p.laborCostCents || 0)) / 100).toFixed(2), (Number(p.salePriceCents || 0) / 100).toFixed(2), p.targetMarginPercent || 0]);
  downloadText(`produtos-${today()}.csv`, [header, ...rows].map((r) => r.map(csvEscape).join(";")).join("\n"), "text/csv;charset=utf-8");
}

async function handleAction(target) {
  const action = target.dataset.action;
  if (action === "delete") {
    if (!confirm("Excluir este registro?")) return;
    await storage.remove(target.dataset.type, target.dataset.id); await reloadType(target.dataset.type); render(); return;
  }
  if (action === "quote-status") {
    const q = state.data.quotes.find((x) => x.id === target.dataset.id); if (!q) return;
    await storage.save("quotes", { ...stripMeta(q), status: target.dataset.status }, q.id); await reloadType("quotes"); render(); return;
  }
  if (action === "quote-import") {
    const q = state.data.quotes.find((x) => x.id === target.dataset.id); if (!q) return;
    const transaction = await storage.save("transactions", { kind: "income", status: "pending", description: `Orçamento ${q.number} — ${q.customer}`, category: "Vendas", amountCents: quoteTotal(q), date: today(), dueDate: q.validUntil || "", source: "quote", quoteId: q.id, createdAt: new Date().toISOString() });
    await storage.save("quotes", { ...stripMeta(q), importedTransactionId: transaction.id }, q.id); await Promise.all([reloadType("quotes"), reloadType("transactions")]); render(); return;
  }
  if (action === "stock-adjust") {
    const item = state.data.inventory.find((x) => x.id === target.dataset.id); if (!item) return;
    const raw = prompt(`Movimentação de ${item.name}. Use positivo para entrada e negativo para saída:`, "0"); if (raw == null) return;
    const delta = Number(String(raw).replace(",", ".")); if (!Number.isFinite(delta) || delta === 0) return;
    await storage.save("inventory", { ...stripMeta(item), quantity: Number(item.quantity || 0) + delta, lastMovementAt: new Date().toISOString() }, item.id); await reloadType("inventory"); render(); return;
  }
  if (action === "export-transactions") return exportTransactions();
  if (action === "export-products") return exportProducts();
  if (action === "print-report") return window.print();
  if (action === "backup") {
    const result = await storage.backup(); alert(result); return;
  }
}

function stripMeta(record) {
  const { id, _version, _syncState, _updatedAt, ...data } = record; return data;
}

document.addEventListener("click", async (event) => {
  const pageTarget = event.target.closest("[data-page]");
  if (pageTarget) { state.page = pageTarget.dataset.page; render(); return; }
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    try { await handleAction(actionTarget); } catch (error) { alert(String(error?.message || error)); }
  }
});

window.addEventListener("online", () => { state.online = true; renderShellStatus(); });
window.addEventListener("offline", () => { state.online = false; renderShellStatus(); });

async function boot() {
  try {
    state.runtime = await storage.runtime();
    await loadAll();
    render();
    if (!tauriInvoke && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (error) {
    el("view").innerHTML = `<section class="fatal"><h2>Não foi possível iniciar o Finança Simples</h2><p>${escapeHtml(String(error?.message || error))}</p></section>`;
  }
}

boot();
