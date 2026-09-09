const invoke = window.__TAURI__?.core?.invoke;

const TYPES = ["transactions", "accounts", "cards", "categories", "investments", "settings"];
const PAYMENT_METHODS = {
  pix: "PIX",
  transfer: "Transferência",
  debit_card: "Cartão de débito",
  credit_card: "Cartão de crédito",
  boleto: "Boleto",
  cash: "Dinheiro",
  automatic_debit: "Débito automático",
  other: "Outro",
};
const ACCOUNT_TYPES = {
  checking: "Conta corrente",
  savings: "Poupança",
  digital: "Conta digital",
  cash: "Carteira / dinheiro",
  payment: "Conta de pagamento",
  other: "Outra",
};
const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard", "Outro"];
const INVESTMENT_TYPES = ["Tesouro Direto", "CDB", "LCI/LCA", "Fundo", "Ação", "ETF", "FII", "Cripto", "Previdência", "Outro"];
const DEFAULT_SETTINGS = {
  profileName: "Meu financeiro",
  averageMonthlyIncomeCents: 0,
  emergencyReserveGoalCents: 0,
  defaultAccountId: "",
  currency: "BRL",
};
const DEFAULT_CATEGORIES = [
  ["income", "Salário"], ["income", "Pró-labore"], ["income", "Freelance / Serviços"],
  ["income", "Rendimentos"], ["income", "Reembolso"], ["income", "Outras receitas"],
  ["expense", "Moradia"], ["expense", "Alimentação"], ["expense", "Transporte"],
  ["expense", "Saúde"], ["expense", "Educação"], ["expense", "Lazer"],
  ["expense", "Assinaturas"], ["expense", "Compras"], ["expense", "Impostos e taxas"],
  ["expense", "Financeiro"], ["expense", "Família"], ["expense", "Outras despesas"],
];

const S = {
  page: "dashboard",
  month: new Date().toISOString().slice(0, 7),
  runtime: null,
  data: Object.fromEntries(TYPES.map((type) => [type, []])),
  settings: { ...DEFAULT_SETTINGS },
  edit: { transactions: null, accounts: null, cards: null, investments: null, categories: null },
};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const money = (cents) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
const inputMoney = (cents) => (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
const parseMoney = (value) => {
  let text = String(value ?? "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
  if (!text) return 0;
  text = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const today = () => {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const monthOf = (date) => String(date || "").slice(0, 7);
const row = (entity) => ({ id: entity.id, ...(entity.data || {}), _updatedAt: entity.updatedAt });
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function list(type) {
  return (await invoke("list_entities", { entityType: type })).map(row);
}
async function save(type, data, id = null) {
  return row(await invoke("upsert_entity", { input: { entityType: type, id, data } }));
}
async function bulkSave(items) {
  if (!items.length) return [];
  const result = await invoke("upsert_entities", {
    inputs: items.map((item) => ({ entityType: item.type, id: item.id || null, data: item.data })),
  });
  return result.map(row);
}
async function remove(type, id) {
  return invoke("delete_entity", { entityType: type, id });
}
async function load() {
  for (const type of TYPES) S.data[type] = await list(type);
  S.settings = { ...DEFAULT_SETTINGS, ...(S.data.settings[0] || {}) };
  if (!S.settings.defaultAccountId && S.settings.defaultAccount) {
    S.settings.defaultAccountId = accounts().find((item) => item.name === S.settings.defaultAccount)?.id || "";
  }
  if (!S.data.categories.length) {
    await bulkSave(DEFAULT_CATEGORIES.map(([kind, name]) => ({ type: "categories", data: { kind, name, active: true } })));
    S.data.categories = await list("categories");
  }
}

const tx = () => S.data.transactions || [];
const accounts = () => S.data.accounts || [];
const cards = () => S.data.cards || [];
const categories = () => S.data.categories || [];
const investments = () => S.data.investments || [];
const accountById = (id) => accounts().find((item) => item.id === id);
const cardById = (id) => cards().find((item) => item.id === id);
const categoryById = (id) => categories().find((item) => item.id === id);
const accountName = (id) => accountById(id)?.name || "—";
const cardName = (id) => cardById(id)?.name || "—";
const categoryName = (item) => categoryById(item.categoryId)?.name || item.category || "Sem categoria";
const txAccountId = (item) => item.accountId || accounts().find((account) => account.name === item.account)?.id || "";

function pageTitle() {
  return {
    dashboard: "Dashboard",
    transactions: "Lançamentos",
    accounts: "Contas & Cartões",
    openfinance: "Open Finance",
    investments: "Investimentos",
    settings: "Parametrização",
  }[S.page] || "Finança Simples";
}

function shell() {
  $("pageTitle").textContent = pageTitle();
  $("connectionBadge").textContent = navigator.onLine ? "Online" : "Offline";
  $("connectionBadge").classList.toggle("online", navigator.onLine);
  $("platformBadge").textContent = "Windows";
  $("storageLabel").textContent = S.runtime?.storage || "SQLite local";
  document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.page === S.page));
}

function dateParts(dateString) {
  const [year, month, day] = String(dateString || today()).split("-").map(Number);
  return { year, month, day };
}
function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}
function buildDate(year, month1to12, day) {
  const normalized = new Date(year, month1to12 - 1, 1, 12, 0, 0);
  const y = normalized.getFullYear();
  const m = normalized.getMonth() + 1;
  const d = Math.min(Math.max(1, Number(day || 1)), daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addMonths(dateString, months, forcedDay = null) {
  const { year, month, day } = dateParts(dateString);
  const base = new Date(year, month - 1 + Number(months || 0), 1, 12, 0, 0);
  return buildDate(base.getFullYear(), base.getMonth() + 1, forcedDay ?? day);
}
function addFrequency(dateString, frequency, index) {
  if (!index) return dateString;
  const date = new Date(`${dateString}T12:00:00`);
  if (frequency === "weekly") date.setDate(date.getDate() + 7 * index);
  else if (frequency === "monthly") return addMonths(dateString, index);
  else if (frequency === "yearly") date.setFullYear(date.getFullYear() + index);
  return date.toISOString().slice(0, 10);
}
function firstCardDueDate(card, purchaseDate) {
  const { year, month, day } = dateParts(purchaseDate);
  const closingDay = Math.max(1, Math.min(31, Number(card.closingDay || 1)));
  const dueDay = Math.max(1, Math.min(31, Number(card.dueDay || 1)));
  let monthOffset = dueDay <= closingDay ? 1 : 0;
  if (day > closingDay) monthOffset += 1;
  const base = new Date(year, month - 1 + monthOffset, 1, 12, 0, 0);
  return buildDate(base.getFullYear(), base.getMonth() + 1, dueDay);
}
function splitAmount(totalCents, count) {
  count = Math.max(1, Number(count || 1));
  const base = Math.floor(totalCents / count);
  let remainder = totalCents - base * count;
  return Array.from({ length: count }, () => base + (remainder-- > 0 ? 1 : 0));
}
function effectiveDate(item) {
  if (item.kind === "expense" && item.paymentMethod === "credit_card") return item.dueDate || item.date;
  if (item.status === "pending" && item.dueDate) return item.dueDate;
  return item.date;
}
function effectiveMonth(item) {
  return monthOf(effectiveDate(item));
}
function isExpense(item) { return item.kind === "expense"; }
function isIncome(item) { return item.kind === "income"; }
function isTransfer(item) { return item.kind === "transfer"; }
function isCardPayment(item) { return item.kind === "card_payment"; }

function accountBalance(accountId) {
  const account = accountById(accountId);
  let balance = Number(account?.openingBalanceCents ?? account?.balanceCents ?? 0);
  for (const item of tx()) {
    if (item.status !== "paid") continue;
    const amount = Number(item.amountCents || 0);
    if (isIncome(item) && txAccountId(item) === accountId) balance += amount;
    if (isExpense(item) && item.paymentMethod !== "credit_card" && txAccountId(item) === accountId) balance -= amount;
    if (isCardPayment(item) && txAccountId(item) === accountId) balance -= amount;
    if (isTransfer(item)) {
      if (txAccountId(item) === accountId) balance -= amount;
      if (item.targetAccountId === accountId) balance += amount;
    }
  }
  return balance;
}
function totalCashBalance() {
  return accounts().reduce((sum, account) => sum + accountBalance(account.id), 0);
}
function cardUsed(cardId) {
  return tx().filter((item) => isExpense(item) && item.paymentMethod === "credit_card" && item.cardId === cardId && item.status !== "paid")
    .reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
}
function cardAvailable(card) {
  return Math.max(0, Number(card.limitCents || 0) - cardUsed(card.id));
}
function invoiceGroups() {
  const groups = new Map();
  for (const item of tx().filter((x) => isExpense(x) && x.paymentMethod === "credit_card" && x.cardId)) {
    const invoiceMonth = item.invoiceMonth || monthOf(item.dueDate);
    const key = `${item.cardId}|${invoiceMonth}`;
    if (!groups.has(key)) groups.set(key, { cardId: item.cardId, invoiceMonth, amountCents: 0, pendingCents: 0, paidCents: 0, items: [] });
    const group = groups.get(key);
    group.amountCents += Number(item.amountCents || 0);
    group[item.status === "paid" ? "paidCents" : "pendingCents"] += Number(item.amountCents || 0);
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => `${a.invoiceMonth}${a.cardId}`.localeCompare(`${b.invoiceMonth}${b.cardId}`));
}
function currentMonthMetrics() {
  const rows = tx().filter((item) => effectiveMonth(item) === S.month && !isTransfer(item) && !isCardPayment(item));
  const sum = (kind, status) => rows.filter((item) => item.kind === kind && item.status === status)
    .reduce((total, item) => total + Number(item.amountCents || 0), 0);
  const incomePaid = sum("income", "paid");
  const incomePending = sum("income", "pending");
  const expensePaid = sum("expense", "paid");
  const expensePending = sum("expense", "pending");
  const cardCommitted = rows.filter((item) => isExpense(item) && item.paymentMethod === "credit_card")
    .reduce((total, item) => total + Number(item.amountCents || 0), 0);
  const averageIncome = Number(S.settings.averageMonthlyIncomeCents || 0);
  return {
    rows,
    incomePaid,
    incomePending,
    expensePaid,
    expensePending,
    resultPaid: incomePaid - expensePaid,
    resultForecast: incomePaid + incomePending - expensePaid - expensePending,
    cardCommitted,
    cardCommitmentPct: averageIncome ? cardCommitted / averageIncome * 100 : 0,
  };
}
function investmentMetrics() {
  let cost = 0;
  let current = 0;
  for (const item of investments()) {
    cost += Math.round(Number(item.quantity || 0) * Number(item.averagePriceCents || 0));
    current += Math.round(Number(item.quantity || 0) * Number(item.currentPriceCents || 0));
  }
  return { cost, current, gain: current - cost };
}
function k(label, value, hint = "") {
  return `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
}
function tag(text, tone = "") {
  return `<span class="tag ${tone}">${esc(text)}</span>`;
}
function accountOptions(selected = "", includeBlank = true) {
  const list = accounts().filter((item) => item.active !== false);
  return `${includeBlank ? `<option value="">Selecione...</option>` : ""}${list.map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${esc(item.name)}${item.institution ? ` — ${esc(item.institution)}` : ""}</option>`).join("")}`;
}
function cardOptions(selected = "") {
  const list = cards().filter((item) => item.active !== false);
  return `<option value="">Selecione...</option>${list.map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${esc(item.name)}${item.last4 ? ` •••• ${esc(item.last4)}` : ""} — limite ${money(item.limitCents)}</option>`).join("")}`;
}
function categoryOptions(kind, selected = "") {
  return `<option value="">Selecione...</option>${categories().filter((item) => item.active !== false && item.kind === kind).sort((a, b) => a.name.localeCompare(b.name)).map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}`;
}

function dashboard() {
  const m = currentMonthMetrics();
  const im = investmentMetrics();
  const recent = [...tx()].sort((a, b) => String(b._updatedAt || b.date).localeCompare(String(a._updatedAt || a.date))).slice(0, 8);
  const dueSoon = tx().filter((item) => item.status === "pending" && item.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 8);
  const cats = new Map();
  const expenseTotal = m.rows.filter(isExpense).reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  for (const item of m.rows.filter(isExpense)) {
    const name = categoryName(item);
    cats.set(name, (cats.get(name) || 0) + Number(item.amountCents || 0));
  }
  const monthInvoices = invoiceGroups().filter((group) => group.invoiceMonth === S.month);
  return `<section class="hero"><div><h2>${esc(S.settings.profileName)}</h2><p>Controle financeiro completo no Windows: contas, cartões, parcelas, faturas e investimentos no banco local.</p></div><div class="button-row"><button class="ghost" data-page="accounts">Contas & Cartões</button><button class="primary" data-page="transactions">Novo lançamento</button></div></section>
  <section class="report-toolbar panel"><label>Mês de análise<input id="month" type="month" value="${S.month}"></label><span class="muted">Compras no cartão entram no mês de vencimento da parcela/fatura.</span></section>
  <section class="kpi-grid">${k("Saldo em contas", money(totalCashBalance()), `${accounts().length} conta(s)`)}${k("Receitas realizadas", money(m.incomePaid), `${money(m.incomePending)} a receber`)}${k("Despesas realizadas", money(m.expensePaid), `${money(m.expensePending)} a pagar`)}${k("Resultado realizado", money(m.resultPaid), `previsto ${money(m.resultForecast)}`)}${k("Faturas do mês", money(monthInvoices.reduce((s, g) => s + g.amountCents, 0)), `${monthInvoices.length} fatura(s)`)}${k("Comprometimento cartões", pct(m.cardCommitmentPct), money(m.cardCommitted))}${k("Investimentos", money(im.current), `resultado ${money(im.gain)}`)}${k("Reserva de emergência", S.settings.emergencyReserveGoalCents ? pct(Math.min(100, totalCashBalance() / Number(S.settings.emergencyReserveGoalCents) * 100)) : "—", S.settings.emergencyReserveGoalCents ? `meta ${money(S.settings.emergencyReserveGoalCents)}` : "meta não definida")}</section>
  <div class="two-col"><section class="panel"><div class="panel-head"><h3>Próximos vencimentos</h3><button class="ghost" data-page="transactions">Ver lançamentos</button></div><div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Origem</th><th class="right">Valor</th></tr></thead><tbody>${dueSoon.length ? dueSoon.map((item) => `<tr><td>${esc(item.dueDate)}</td><td>${esc(item.description)}</td><td>${item.cardId ? esc(cardName(item.cardId)) : esc(accountName(item.accountId))}</td><td class="right expense">${money(item.amountCents)}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nenhum vencimento pendente.</td></tr>`}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h3>Faturas do mês</h3><button class="ghost" data-page="accounts">Gerenciar</button></div><div class="table-wrap"><table><thead><tr><th>Cartão</th><th>Status</th><th class="right">Fatura</th></tr></thead><tbody>${monthInvoices.length ? monthInvoices.map((g) => `<tr><td>${esc(cardName(g.cardId))}</td><td>${g.pendingCents ? tag("Pendente", "warn") : tag("Paga", "ok")}</td><td class="right">${money(g.amountCents)}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">Nenhuma fatura neste mês.</td></tr>`}</tbody></table></div></section></div>
  <div class="two-col"><section class="panel"><div class="panel-head"><h3>Despesas por categoria</h3></div><div class="table-wrap"><table><thead><tr><th>Categoria</th><th class="right">Valor</th><th class="right">%</th></tr></thead><tbody>${cats.size ? [...cats].sort((a, b) => b[1] - a[1]).map(([name, value]) => `<tr><td>${esc(name)}</td><td class="right">${money(value)}</td><td class="right">${pct(expenseTotal ? value / expenseTotal * 100 : 0)}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">Sem despesas neste mês.</td></tr>`}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h3>Últimos lançamentos</h3></div><div class="table-wrap"><table><tbody>${recent.length ? recent.map((item) => `<tr><td>${esc(effectiveDate(item) || item.date)}</td><td>${esc(item.description)}</td><td>${item.installmentCount > 1 ? tag(`${item.installmentNumber}/${item.installmentCount}`) : ""}</td><td class="right ${isIncome(item) ? "income" : isExpense(item) ? "expense" : ""}">${isIncome(item) ? "+" : isExpense(item) ? "−" : ""}${money(item.amountCents)}</td></tr>`).join("") : `<tr><td class="empty">Nenhum lançamento.</td></tr>`}</tbody></table></div></section></div>`;
}

function txForm() {
  const edit = S.edit.transactions ? tx().find((item) => item.id === S.edit.transactions) : null;
  const kind = edit?.kind === "card_payment" ? "expense" : edit?.kind || "expense";
  const payment = edit?.paymentMethod || (kind === "income" ? "transfer" : "pix");
  const isInstallmentEdit = Boolean(edit?.installmentGroupId);
  const defaultAccountId = (edit ? txAccountId(edit) : "") || S.settings.defaultAccountId || "";
  return `<section class="panel"><div class="panel-head"><div><h3>${edit ? "Editar" : "Novo"} lançamento</h3><small>${accounts().length ? "Selecione contas e cartões cadastrados." : "Cadastre uma conta antes de lançar movimentos."}</small></div>${edit ? `<button class="ghost" data-action="cancel" data-type="transactions">Cancelar</button>` : ""}</div>
  <form id="txForm" class="form panel-body">
    ${!accounts().length ? `<div class="notice warn"><strong>Nenhuma conta cadastrada.</strong><span>Vá em Contas & Cartões e cadastre pelo menos uma conta para que os saldos e lançamentos façam sentido.</span><button type="button" class="ghost" data-page="accounts">Cadastrar conta</button></div>` : ""}
    <div class="form-grid">
      <label>Tipo<select name="kind" id="txKind"><option value="expense" ${kind === "expense" ? "selected" : ""}>Despesa</option><option value="income" ${kind === "income" ? "selected" : ""}>Receita</option><option value="transfer" ${kind === "transfer" ? "selected" : ""}>Transferência entre contas</option></select></label>
      <label id="statusField">Status<select name="status"><option value="paid" ${edit?.status !== "pending" ? "selected" : ""}>Realizado</option><option value="pending" ${edit?.status === "pending" ? "selected" : ""}>Pendente / a vencer</option></select></label>
      <label class="wide">Descrição<input name="description" required value="${esc(edit?.description || "")}" placeholder="Ex.: Supermercado, salário, aluguel"></label>
      <label id="categoryField">Categoria<select name="categoryId" id="categorySelect">${categoryOptions(kind === "income" ? "income" : "expense", edit?.categoryId || "")}</select></label>
      <label id="paymentField">Forma de pagamento<select name="paymentMethod" id="paymentMethod">${Object.entries(PAYMENT_METHODS).map(([value, label]) => `<option value="${value}" ${payment === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label id="accountField">Conta<select name="accountId">${accountOptions(defaultAccountId)}</select></label>
      <label id="targetAccountField" class="hidden">Conta de destino<select name="targetAccountId">${accountOptions(edit?.targetAccountId || "")}</select></label>
      <label id="cardField" class="hidden">Cartão<select name="cardId" id="cardId">${cardOptions(edit?.cardId || "")}</select></label>
      <label>Valor ${isInstallmentEdit ? "da parcela" : "total"}<input name="amount" required value="${edit ? inputMoney(edit.amountCents) : ""}" placeholder="0,00"></label>
      <label>Data<input name="date" type="date" required value="${edit?.date || today()}"></label>
      <label id="dueDateField">Vencimento<input name="dueDate" type="date" value="${edit?.dueDate || ""}"></label>
      <label id="installmentsField" class="hidden">Parcelas<select name="installmentCount" ${isInstallmentEdit ? "disabled" : ""}>${Array.from({ length: 60 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${(edit?.installmentCount || 1) === n ? "selected" : ""}>${n}x</option>`).join("")}</select></label>
      <label id="recurrenceField">Repetir<select name="recurrence"><option value="none">Não repetir</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
      <label id="repeatCountField">Quantidade de ocorrências<input name="repeatCount" type="number" min="1" max="120" value="1"></label>
      <label class="wide">Observação<input name="notes" value="${esc(edit?.notes || "")}" placeholder="Opcional"></label>
    </div>
    ${isInstallmentEdit ? `<div class="notice"><strong>Parcela ${edit.installmentNumber}/${edit.installmentCount}</strong><span>Esta edição altera somente esta parcela. A série original permanece vinculada pelo mesmo grupo.</span></div>` : ""}
    <div class="button-row"><button class="primary" ${accounts().length ? "" : "disabled"}>${edit ? "Salvar alteração" : "Salvar lançamento"}</button><span id="msg" class="form-msg"></span></div>
  </form></section>`;
}

function transactionRows() {
  return tx().filter((item) => effectiveMonth(item) === S.month && !isCardPayment(item))
    .sort((a, b) => String(effectiveDate(b)).localeCompare(String(effectiveDate(a))));
}
function originLabel(item) {
  if (item.paymentMethod === "credit_card") return cardName(item.cardId);
  if (item.kind === "transfer") return `${accountName(item.accountId)} → ${accountName(item.targetAccountId)}`;
  return accountName(txAccountId(item));
}
function transactionsPage() {
  const rows = transactionRows();
  return `<div class="two-col">${txForm()}<section class="panel"><div class="panel-head"><div><h3>Importar fatura CSV</h3><small>Importe itens de uma fatura para um cartão já cadastrado.</small></div></div><form id="importForm" class="form panel-body">
    <label>Cartão<select name="cardId" required>${cardOptions("")}</select></label>
    <label>Vencimento da fatura<input name="dueDate" type="date" required></label>
    <label>Arquivo CSV<input name="file" type="file" accept=".csv,text/csv" required></label>
    <p class="muted">Aceita cabeçalhos como <strong>data</strong>, <strong>descrição</strong> e <strong>valor</strong>. Os itens serão criados como despesas pendentes daquela fatura.</p>
    <button class="ghost" ${cards().length ? "" : "disabled"}>Importar fatura</button><span id="importMsg" class="form-msg"></span>
  </form></section></div>
  <section class="panel"><div class="report-toolbar"><label>Mês<input id="month" type="month" value="${S.month}"></label><div><button class="ghost" data-action="exportTx">Exportar CSV</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Competência</th><th>Descrição</th><th>Categoria</th><th>Conta / Cartão</th><th>Parcela</th><th>Status</th><th class="right">Valor</th><th></th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td>${esc(effectiveDate(item))}</td><td>${esc(item.description)}</td><td>${esc(categoryName(item))}</td><td>${esc(originLabel(item))}</td><td>${item.installmentCount > 1 ? `${item.installmentNumber}/${item.installmentCount}` : "—"}</td><td>${item.status === "pending" ? tag("Pendente", "warn") : tag("Realizado", "ok")}</td><td class="right ${isIncome(item) ? "income" : isExpense(item) ? "expense" : ""}">${isIncome(item) ? "+" : isExpense(item) ? "−" : ""}${money(item.amountCents)}</td><td class="right actions-cell">${item.status === "pending" && item.paymentMethod !== "credit_card" ? `<button class="ghost" data-action="settle" data-id="${item.id}">Baixar</button>` : ""}<button class="ghost" data-action="edit" data-type="transactions" data-id="${item.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="transactions" data-id="${item.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="8" class="empty">Nenhum lançamento neste mês.</td></tr>`}</tbody></table></div>
  </section>`;
}

function accountForm() {
  const edit = S.edit.accounts ? accounts().find((item) => item.id === S.edit.accounts) : null;
  return `<section class="panel"><div class="panel-head"><h3>${edit ? "Editar" : "Nova"} conta</h3>${edit ? `<button class="ghost" data-action="cancel" data-type="accounts">Cancelar</button>` : ""}</div><form id="accountForm" class="form panel-body"><div class="form-grid">
    <label class="wide">Nome da conta<input name="name" required value="${esc(edit?.name || "")}" placeholder="Ex.: Nubank, Caixa, Carteira"></label>
    <label>Instituição<input name="institution" value="${esc(edit?.institution || "")}" placeholder="Banco ou instituição"></label>
    <label>Tipo<select name="type">${Object.entries(ACCOUNT_TYPES).map(([value, label]) => `<option value="${value}" ${edit?.type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label>Saldo inicial<input name="openingBalance" value="${edit ? inputMoney(edit.openingBalanceCents ?? edit.balanceCents) : ""}" placeholder="0,00"></label>
    <label>Ativa<select name="active"><option value="true" ${edit?.active !== false ? "selected" : ""}>Sim</option><option value="false" ${edit?.active === false ? "selected" : ""}>Não</option></select></label>
  </div><button class="primary">Salvar conta</button></form></section>`;
}
function cardForm() {
  const edit = S.edit.cards ? cards().find((item) => item.id === S.edit.cards) : null;
  return `<section class="panel"><div class="panel-head"><h3>${edit ? "Editar" : "Novo"} cartão</h3>${edit ? `<button class="ghost" data-action="cancel" data-type="cards">Cancelar</button>` : ""}</div><form id="cardForm" class="form panel-body"><div class="form-grid">
    <label class="wide">Nome do cartão<input name="name" required value="${esc(edit?.name || "")}" placeholder="Ex.: Nubank Platinum"></label>
    <label>Instituição<input name="institution" value="${esc(edit?.institution || "")}"></label>
    <label>Bandeira<select name="brand">${CARD_BRANDS.map((brand) => `<option ${edit?.brand === brand ? "selected" : ""}>${brand}</option>`).join("")}</select></label>
    <label>Final do cartão<input name="last4" maxlength="4" inputmode="numeric" value="${esc(edit?.last4 || "")}" placeholder="1234"></label>
    <label>Conta que paga a fatura<select name="accountId" required>${accountOptions(edit?.accountId || S.settings.defaultAccountId || "")}</select></label>
    <label>Limite<input name="limit" required value="${edit ? inputMoney(edit.limitCents) : ""}" placeholder="0,00"></label>
    <label>Dia do fechamento<input name="closingDay" type="number" min="1" max="31" required value="${edit?.closingDay || 1}"></label>
    <label>Dia do vencimento<input name="dueDay" type="number" min="1" max="31" required value="${edit?.dueDay || 10}"></label>
    <label>Ativo<select name="active"><option value="true" ${edit?.active !== false ? "selected" : ""}>Sim</option><option value="false" ${edit?.active === false ? "selected" : ""}>Não</option></select></label>
  </div><button class="primary" ${accounts().length ? "" : "disabled"}>Salvar cartão</button></form></section>`;
}
function accountsPage() {
  const invoices = invoiceGroups();
  return `<section class="hero"><div><h2>Contas & Cartões</h2><p>Cadastre onde o dinheiro está e quais cartões geram faturas. Esses cadastros alimentam os seletores dos lançamentos.</p></div><div>${tag(`${accounts().length} conta(s)`)} ${tag(`${cards().length} cartão(ões)`)}</div></section>
  <div class="two-col">${accountForm()}${cardForm()}</div>
  <section class="panel"><div class="panel-head"><h3>Contas</h3><strong>${money(totalCashBalance())}</strong></div><div class="table-wrap"><table><thead><tr><th>Conta</th><th>Instituição</th><th>Tipo</th><th class="right">Saldo inicial</th><th class="right">Saldo atual</th><th></th></tr></thead><tbody>${accounts().length ? accounts().map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.institution || "—")}</td><td>${esc(ACCOUNT_TYPES[item.type] || "Outra")}</td><td class="right">${money(item.openingBalanceCents ?? item.balanceCents)}</td><td class="right">${money(accountBalance(item.id))}</td><td class="right actions-cell"><button class="ghost" data-action="edit" data-type="accounts" data-id="${item.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="accounts" data-id="${item.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty">Cadastre sua primeira conta.</td></tr>`}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h3>Cartões de crédito</h3></div><div class="cards-grid">${cards().length ? cards().map((card) => `<article class="credit-card"><div class="credit-card-top"><div><strong>${esc(card.name)}</strong><small>${esc(card.institution || "")}${card.last4 ? ` •••• ${esc(card.last4)}` : ""}</small></div>${card.active === false ? tag("Inativo") : tag(card.brand || "Cartão", "ok")}</div><div class="credit-card-values"><div><span>Limite</span><strong>${money(card.limitCents)}</strong></div><div><span>Em aberto</span><strong>${money(cardUsed(card.id))}</strong></div><div><span>Disponível</span><strong>${money(cardAvailable(card))}</strong></div></div><div class="credit-card-foot"><span>Fecha dia ${esc(card.closingDay)} · vence dia ${esc(card.dueDay)}</span><span>Paga por ${esc(accountName(card.accountId))}</span></div><div class="button-row"><button class="ghost" data-action="edit" data-type="cards" data-id="${card.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="cards" data-id="${card.id}">Excluir</button></div></article>`).join("") : `<div class="empty-card">Cadastre um cartão para usar parcelamento e faturas.</div>`}</div></section>
  <section class="panel"><div class="panel-head"><h3>Faturas e parcelas</h3><span class="muted">O pagamento da fatura reduz a conta vinculada sem duplicar a despesa.</span></div><div class="table-wrap"><table><thead><tr><th>Mês</th><th>Cartão</th><th>Parcelas</th><th class="right">Total</th><th class="right">Em aberto</th><th>Status</th><th></th></tr></thead><tbody>${invoices.length ? invoices.map((group) => { const card = cardById(group.cardId); const canPay = group.pendingCents > 0 && card?.accountId; return `<tr><td>${esc(group.invoiceMonth)}</td><td>${esc(cardName(group.cardId))}</td><td>${group.items.length}</td><td class="right">${money(group.amountCents)}</td><td class="right">${money(group.pendingCents)}</td><td>${group.pendingCents ? tag("Aberta", "warn") : tag("Paga", "ok")}</td><td class="right">${canPay ? `<button class="primary compact" data-action="payInvoice" data-card-id="${group.cardId}" data-month="${group.invoiceMonth}">Pagar fatura</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">As faturas aparecerão quando houver compras no cartão.</td></tr>`}</tbody></table></div></section>`;
}

function openFinancePage() {
  return `<section class="hero"><div><h2>Open Finance</h2><p>As contas locais já funcionam integralmente offline. A sincronização automática com bancos será ligada somente por backend seguro, sem gravar credenciais no aplicativo.</p></div><span class="status-badge ${navigator.onLine ? "online" : ""}">${navigator.onLine ? "Internet disponível" : "Offline"}</span></section>
  <section class="kpi-grid">${k("Contas cadastradas", String(accounts().length), money(totalCashBalance()))}${k("Cartões", String(cards().length), money(cards().reduce((s, c) => s + Number(c.limitCents || 0), 0)))}${k("Banco local", S.runtime?.databaseHealthy ? "Íntegro" : "Verificar", S.runtime?.databaseCheck || "—")}${k("Sincronização bancária", "Não conectada", "backend seguro pendente")}</section>
  <section class="panel"><div class="panel-head"><h3>Contas disponíveis no Finança Simples</h3><button class="ghost" data-page="accounts">Gerenciar contas e cartões</button></div><div class="table-wrap"><table><thead><tr><th>Conta</th><th>Instituição</th><th>Tipo</th><th class="right">Saldo atual</th></tr></thead><tbody>${accounts().length ? accounts().map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.institution || "—")}</td><td>${esc(ACCOUNT_TYPES[item.type] || "Outra")}</td><td class="right">${money(accountBalance(item.id))}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nenhuma conta cadastrada.</td></tr>`}</tbody></table></div></section>`;
}

function investmentForm() {
  const edit = S.edit.investments ? investments().find((item) => item.id === S.edit.investments) : null;
  return `<section class="panel"><div class="panel-head"><h3>${edit ? "Editar" : "Novo"} investimento</h3>${edit ? `<button class="ghost" data-action="cancel" data-type="investments">Cancelar</button>` : ""}</div><form id="investmentForm" class="form panel-body"><div class="form-grid">
    <label>Tipo<select name="type">${INVESTMENT_TYPES.map((type) => `<option ${edit?.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
    <label>Ativo / nome<input name="name" required value="${esc(edit?.name || "")}" placeholder="Ex.: Tesouro Selic 2029"></label>
    <label>Instituição<input name="institution" value="${esc(edit?.institution || "")}"></label>
    <label>Código / ticker<input name="ticker" value="${esc(edit?.ticker || "")}"></label>
    <label>Quantidade<input name="quantity" type="number" step="0.00000001" required value="${edit?.quantity ?? 0}"></label>
    <label>Preço médio<input name="averagePrice" required value="${edit ? inputMoney(edit.averagePriceCents) : ""}" placeholder="0,00"></label>
    <label>Preço atual<input name="currentPrice" required value="${edit ? inputMoney(edit.currentPriceCents) : ""}" placeholder="0,00"></label>
    <label>Data da posição<input name="date" type="date" value="${edit?.date || today()}"></label>
  </div><button class="primary">Salvar investimento</button></form></section>`;
}
function investmentsPage() {
  const m = investmentMetrics();
  return `<section class="kpi-grid">${k("Total aplicado", money(m.cost))}${k("Valor atual", money(m.current))}${k("Resultado", money(m.gain), m.cost ? pct(m.gain / m.cost * 100) : "—")}${k("Ativos", String(investments().length))}</section><div class="two-col">${investmentForm()}<section class="panel"><div class="panel-head"><h3>Resumo</h3></div><div class="panel-body"><p class="muted">O módulo mantém sua posição local. Cotações automáticas serão adicionadas como serviço online, mantendo o último preço disponível quando offline.</p></div></section></div>
  <section class="panel"><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Ativo</th><th>Instituição</th><th class="right">Quantidade</th><th class="right">Custo</th><th class="right">Atual</th><th class="right">Resultado</th><th></th></tr></thead><tbody>${investments().length ? investments().map((item) => { const cost = Math.round(Number(item.quantity || 0) * Number(item.averagePriceCents || 0)); const current = Math.round(Number(item.quantity || 0) * Number(item.currentPriceCents || 0)); return `<tr><td>${esc(item.type || "Outro")}</td><td>${esc(item.name)} ${item.ticker ? tag(item.ticker) : ""}</td><td>${esc(item.institution || "—")}</td><td class="right">${esc(item.quantity)}</td><td class="right">${money(cost)}</td><td class="right">${money(current)}</td><td class="right ${current - cost >= 0 ? "income" : "expense"}">${money(current - cost)}</td><td class="right actions-cell"><button class="ghost" data-action="edit" data-type="investments" data-id="${item.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="investments" data-id="${item.id}">Excluir</button></td></tr>`; }).join("") : `<tr><td colspan="8" class="empty">Nenhum investimento.</td></tr>`}</tbody></table></div></section>`;
}

function categoryForm() {
  const edit = S.edit.categories ? categories().find((item) => item.id === S.edit.categories) : null;
  return `<form id="categoryForm" class="form"><div class="form-grid"><label>Tipo<select name="kind"><option value="expense" ${edit?.kind !== "income" ? "selected" : ""}>Despesa</option><option value="income" ${edit?.kind === "income" ? "selected" : ""}>Receita</option></select></label><label>Nome<input name="name" required value="${esc(edit?.name || "")}"></label></div><div class="button-row"><button class="ghost">${edit ? "Salvar categoria" : "Adicionar categoria"}</button>${edit ? `<button type="button" class="ghost" data-action="cancel" data-type="categories">Cancelar</button>` : ""}</div></form>`;
}
function settingsPage() {
  return `<div class="two-col"><section class="panel"><div class="panel-head"><h3>Parametrização financeira</h3></div><form id="settingsForm" class="form panel-body"><div class="form-grid">
    <label class="wide">Nome do perfil<input name="profileName" value="${esc(S.settings.profileName)}"></label>
    <label>Renda média mensal<input name="averageMonthlyIncome" value="${inputMoney(S.settings.averageMonthlyIncomeCents)}"></label>
    <label>Meta de reserva de emergência<input name="emergencyReserveGoal" value="${inputMoney(S.settings.emergencyReserveGoalCents)}"></label>
    <label>Conta padrão<select name="defaultAccountId">${accountOptions(S.settings.defaultAccountId || "")}</select></label>
  </div><button class="primary">Salvar parâmetros</button><span id="settingsMsg" class="form-msg"></span></form></section>
  <section class="panel"><div class="panel-head"><h3>Banco local e segurança</h3></div><div class="panel-body"><div class="report-lines"><div><span>Armazenamento</span><strong>${esc(S.runtime?.storage || "SQLite")}</strong></div><div><span>Integridade</span><strong>${S.runtime?.databaseHealthy ? "OK" : esc(S.runtime?.databaseCheck || "Verificar")}</strong></div><div><span>Caminho</span><strong>${esc(S.runtime?.databasePath || "—")}</strong></div></div><div class="button-row"><button class="ghost" data-action="backup">Criar backup</button><button class="ghost" data-action="snapshot">Exportar dados JSON</button><button class="ghost" data-action="print">Imprimir / PDF</button></div><span id="backupMsg" class="form-msg"></span></div></section></div>
  <section class="panel"><div class="panel-head"><div><h3>Categorias</h3><small>Estas categorias aparecem automaticamente no lançamento conforme Receita ou Despesa.</small></div></div><div class="panel-body">${categoryForm()}</div><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Categoria</th><th></th></tr></thead><tbody>${categories().sort((a, b) => `${a.kind}${a.name}`.localeCompare(`${b.kind}${b.name}`)).map((item) => `<tr><td>${item.kind === "income" ? tag("Receita", "ok") : tag("Despesa", "warn")}</td><td>${esc(item.name)}</td><td class="right actions-cell"><button class="ghost" data-action="edit" data-type="categories" data-id="${item.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="categories" data-id="${item.id}">Excluir</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

function render() {
  shell();
  const view = $("view");
  view.innerHTML = {
    dashboard,
    transactions: transactionsPage,
    accounts: accountsPage,
    openfinance: openFinancePage,
    investments: investmentsPage,
    settings: settingsPage,
  }[S.page]();
  bindPage();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function setMessage(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
}
function refreshTxFields() {
  const form = $("txForm");
  if (!form) return;
  const kind = form.elements.kind.value;
  const payment = form.elements.paymentMethod?.value;
  const isTransferKind = kind === "transfer";
  const isCard = kind === "expense" && payment === "credit_card";
  $("statusField")?.classList.toggle("hidden", isTransferKind || isCard);
  $("categoryField")?.classList.toggle("hidden", isTransferKind);
  $("paymentField")?.classList.toggle("hidden", isTransferKind);
  $("targetAccountField")?.classList.toggle("hidden", !isTransferKind);
  $("cardField")?.classList.toggle("hidden", !isCard);
  $("installmentsField")?.classList.toggle("hidden", !isCard);
  $("accountField")?.classList.toggle("hidden", isCard);
  $("dueDateField")?.classList.toggle("hidden", isCard || isTransferKind);
  $("recurrenceField")?.classList.toggle("hidden", isCard || isTransferKind || Boolean(S.edit.transactions));
  $("repeatCountField")?.classList.toggle("hidden", isCard || isTransferKind || Boolean(S.edit.transactions));
  const categorySelect = $("categorySelect");
  if (categorySelect && !isTransferKind) {
    const current = categorySelect.value;
    categorySelect.innerHTML = categoryOptions(kind === "income" ? "income" : "expense", current);
  }
}

async function saveTransactionForm(form) {
  const values = formObject(form);
  const edit = S.edit.transactions ? tx().find((item) => item.id === S.edit.transactions) : null;
  const kind = values.kind;
  const amountCents = parseMoney(values.amount);
  if (amountCents <= 0) throw new Error("Informe um valor maior que zero.");
  if (kind === "transfer" && (!values.accountId || !values.targetAccountId || values.accountId === values.targetAccountId)) throw new Error("Selecione contas de origem e destino diferentes.");

  if (edit) {
    const paymentMethod = kind === "transfer" ? "transfer" : values.paymentMethod;
    const data = {
      ...edit,
      kind,
      description: values.description.trim(),
      categoryId: kind === "transfer" ? "" : values.categoryId,
      paymentMethod,
      accountId: paymentMethod === "credit_card" ? "" : values.accountId,
      targetAccountId: kind === "transfer" ? values.targetAccountId : "",
      cardId: paymentMethod === "credit_card" ? values.cardId : "",
      amountCents,
      date: values.date,
      dueDate: paymentMethod === "credit_card" ? edit.dueDate : values.dueDate,
      status: paymentMethod === "credit_card" ? edit.status : kind === "transfer" ? "paid" : values.status,
      notes: values.notes || "",
    };
    delete data.id;
    delete data._updatedAt;
    await save("transactions", data, edit.id);
    S.edit.transactions = null;
    return;
  }

  if (kind === "expense" && values.paymentMethod === "credit_card") {
    const card = cardById(values.cardId);
    if (!card) throw new Error("Selecione um cartão cadastrado.");
    const installmentCount = Math.max(1, Number(values.installmentCount || 1));
    const amounts = splitAmount(amountCents, installmentCount);
    const groupId = uid();
    const firstDue = firstCardDueDate(card, values.date);
    const items = amounts.map((part, index) => {
      const dueDate = addMonths(firstDue, index, Number(card.dueDay || 10));
      return {
        type: "transactions",
        data: {
          kind: "expense",
          description: values.description.trim(),
          categoryId: values.categoryId,
          paymentMethod: "credit_card",
          accountId: "",
          cardId: card.id,
          amountCents: part,
          totalPurchaseCents: amountCents,
          date: values.date,
          purchaseDate: values.date,
          dueDate,
          invoiceMonth: monthOf(dueDate),
          status: "pending",
          installmentGroupId: groupId,
          installmentNumber: index + 1,
          installmentCount,
          source: "manual",
          notes: values.notes || "",
        },
      };
    });
    await bulkSave(items);
    return;
  }

  const recurrence = values.recurrence || "none";
  const repeatCount = recurrence === "none" ? 1 : Math.max(1, Math.min(120, Number(values.repeatCount || 1)));
  const groupId = repeatCount > 1 ? uid() : "";
  const items = Array.from({ length: repeatCount }, (_, index) => {
    const date = addFrequency(values.date, recurrence, index);
    const dueDate = values.dueDate ? addFrequency(values.dueDate, recurrence, index) : "";
    return {
      type: "transactions",
      data: {
        kind,
        description: values.description.trim(),
        categoryId: kind === "transfer" ? "" : values.categoryId,
        paymentMethod: kind === "transfer" ? "transfer" : values.paymentMethod,
        accountId: values.accountId,
        targetAccountId: kind === "transfer" ? values.targetAccountId : "",
        cardId: "",
        amountCents,
        date,
        dueDate,
        status: kind === "transfer" ? "paid" : (index > 0 ? "pending" : values.status),
        recurrenceGroupId: groupId,
        recurrence,
        recurrenceNumber: index + 1,
        recurrenceCount: repeatCount,
        source: "manual",
        notes: values.notes || "",
      },
    };
  });
  await bulkSave(items);
}

async function settleInvoice(cardId, invoiceMonth) {
  const card = cardById(cardId);
  if (!card?.accountId) throw new Error("Este cartão não possui uma conta vinculada para pagamento da fatura.");
  const items = tx().filter((item) => item.cardId === cardId && item.invoiceMonth === invoiceMonth && item.paymentMethod === "credit_card" && item.status !== "paid");
  if (!items.length) return;
  const amountCents = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const updates = items.map((item) => {
    const data = { ...item, status: "paid", paidAt: today() };
    delete data.id; delete data._updatedAt;
    return { type: "transactions", id: item.id, data };
  });
  updates.push({
    type: "transactions",
    data: {
      kind: "card_payment",
      description: `Pagamento fatura ${card.name} ${invoiceMonth}`,
      accountId: card.accountId,
      cardId,
      invoiceMonth,
      amountCents,
      date: today(),
      status: "paid",
      paymentMethod: "transfer",
      source: "invoice_payment",
    },
  });
  await bulkSave(updates);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const parseLine = (line) => {
    const cells = [];
    let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
      else value += ch;
    }
    cells.push(value.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const index = (names) => headers.findIndex((header) => names.some((name) => header.includes(name)));
  const dateIndex = index(["data", "date"]), descriptionIndex = index(["descricao", "historico", "estabelecimento", "description"]), valueIndex = index(["valor", "amount"]);
  if (descriptionIndex < 0 || valueIndex < 0) throw new Error("CSV sem colunas reconhecíveis de descrição e valor.");
  return lines.slice(1).map(parseLine).map((cells) => ({
    date: dateIndex >= 0 ? normalizeImportedDate(cells[dateIndex]) : today(),
    description: cells[descriptionIndex] || "Compra importada",
    amountCents: Math.abs(parseMoney(cells[valueIndex])),
  })).filter((item) => item.amountCents > 0);
}
function normalizeImportedDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const br = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (br) return `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${String(br[2]).padStart(2, "0")}-${String(br[1]).padStart(2, "0")}`;
  return today();
}

async function importInvoice(form) {
  const values = formObject(form);
  const card = cardById(values.cardId);
  if (!card) throw new Error("Selecione o cartão da fatura.");
  const file = form.elements.file.files[0];
  if (!file) throw new Error("Selecione um arquivo CSV.");
  const items = parseCsv(await file.text());
  if (!items.length) throw new Error("Nenhum lançamento válido encontrado.");
  const dueDate = values.dueDate;
  await bulkSave(items.map((item) => ({ type: "transactions", data: {
    kind: "expense",
    description: item.description,
    categoryId: "",
    paymentMethod: "credit_card",
    accountId: "",
    cardId: card.id,
    amountCents: item.amountCents,
    date: item.date,
    purchaseDate: item.date,
    dueDate,
    invoiceMonth: monthOf(dueDate),
    status: "pending",
    installmentGroupId: "",
    installmentNumber: 1,
    installmentCount: 1,
    source: "invoice_import",
  } })));
  return items.length;
}

function download(name, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function exportTransactions() {
  const rows = transactionRows();
  const header = ["Data", "Vencimento", "Tipo", "Descrição", "Categoria", "Conta/Cartão", "Parcela", "Status", "Valor"];
  const csv = [header, ...rows.map((item) => [item.date || "", item.dueDate || "", item.kind, item.description || "", categoryName(item), originLabel(item), item.installmentCount > 1 ? `${item.installmentNumber}/${item.installmentCount}` : "", item.status, (Number(item.amountCents || 0) / 100).toFixed(2).replace(".", ",")])]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\r\n");
  download(`financa-simples-${S.month}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
}

function bindPage() {
  $("month")?.addEventListener("change", (event) => { S.month = event.target.value; render(); });
  $("txKind")?.addEventListener("change", refreshTxFields);
  $("paymentMethod")?.addEventListener("change", refreshTxFields);
  refreshTxFields();

  $("txForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("msg", "Salvando...");
    try {
      await saveTransactionForm(event.currentTarget);
      await load();
      setMessage("msg", "Salvo.");
      render();
    } catch (error) { setMessage("msg", error.message || String(error), true); }
  });
  $("importForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("importMsg", "Importando...");
    try {
      const count = await importInvoice(event.currentTarget);
      await load();
      setMessage("importMsg", `${count} item(ns) importado(s).`);
      render();
    } catch (error) { setMessage("importMsg", error.message || String(error), true); }
  });
  $("accountForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    const editId = S.edit.accounts;
    await save("accounts", { name: values.name.trim(), institution: values.institution.trim(), type: values.type, openingBalanceCents: parseMoney(values.openingBalance), active: values.active !== "false" }, editId);
    S.edit.accounts = null; await load(); render();
  });
  $("cardForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    const closingDay = Number(values.closingDay), dueDay = Number(values.dueDay), limitCents = parseMoney(values.limit);
    if (!values.accountId) return alert("Selecione a conta que paga a fatura.");
    if (limitCents <= 0) return alert("Informe o limite do cartão.");
    await save("cards", { name: values.name.trim(), institution: values.institution.trim(), brand: values.brand, last4: values.last4.replace(/\D/g, "").slice(-4), accountId: values.accountId, limitCents, closingDay, dueDay, active: values.active !== "false" }, S.edit.cards);
    S.edit.cards = null; await load(); render();
  });
  $("investmentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    await save("investments", { type: values.type, name: values.name.trim(), institution: values.institution.trim(), ticker: values.ticker.trim(), quantity: Number(values.quantity || 0), averagePriceCents: parseMoney(values.averagePrice), currentPriceCents: parseMoney(values.currentPrice), date: values.date }, S.edit.investments);
    S.edit.investments = null; await load(); render();
  });
  $("settingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    const data = { profileName: values.profileName.trim() || "Meu financeiro", averageMonthlyIncomeCents: parseMoney(values.averageMonthlyIncome), emergencyReserveGoalCents: parseMoney(values.emergencyReserveGoal), defaultAccountId: values.defaultAccountId || "", currency: "BRL" };
    const id = S.data.settings[0]?.id || null;
    await save("settings", data, id); await load(); setMessage("settingsMsg", "Parâmetros salvos."); render();
  });
  $("categoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    await save("categories", { kind: values.kind, name: values.name.trim(), active: true }, S.edit.categories);
    S.edit.categories = null; await load(); render();
  });
}

async function actionClick(target) {
  const button = target.closest("button");
  if (!button) return;
  if (button.dataset.page) { S.page = button.dataset.page; render(); return; }
  const action = button.dataset.action;
  const type = button.dataset.type;
  const id = button.dataset.id;
  if (!action) return;
  try {
    if (action === "cancel") { S.edit[type] = null; render(); }
    else if (action === "edit") { S.edit[type] = id; render(); }
    else if (action === "delete") {
      if (!confirm("Excluir este registro?")) return;
      if (type === "accounts" && (cards().some((card) => card.accountId === id) || tx().some((item) => item.accountId === id || item.targetAccountId === id))) return alert("Esta conta está vinculada a cartão ou lançamento. Edite os vínculos antes de excluir.");
      if (type === "cards" && tx().some((item) => item.cardId === id)) return alert("Este cartão possui lançamentos. Desative-o em vez de excluir.");
      await remove(type, id); await load(); render();
    } else if (action === "settle") {
      const item = tx().find((x) => x.id === id); if (!item) return;
      const data = { ...item, status: "paid", paidAt: today() }; delete data.id; delete data._updatedAt;
      await save("transactions", data, id); await load(); render();
    } else if (action === "payInvoice") {
      if (!confirm(`Confirmar pagamento da fatura ${button.dataset.month} de ${cardName(button.dataset.cardId)}?`)) return;
      await settleInvoice(button.dataset.cardId, button.dataset.month); await load(); render();
    } else if (action === "exportTx") exportTransactions();
    else if (action === "backup") { const path = await invoke("create_backup"); setMessage("backupMsg", `Backup criado em ${path}`); }
    else if (action === "snapshot") { const data = await invoke("export_snapshot"); download(`financa-simples-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json"); }
    else if (action === "print") window.print();
  } catch (error) { alert(error.message || String(error)); }
}

document.addEventListener("click", (event) => actionClick(event.target));
document.querySelectorAll(".nav button").forEach((button) => button.addEventListener("click", () => { S.page = button.dataset.page; render(); }));
window.addEventListener("online", render);
window.addEventListener("offline", render);

async function boot() {
  try {
    if (!invoke) throw new Error("API local do Tauri não disponível.");
    S.runtime = await invoke("runtime_status");
    await load();
    render();
  } catch (error) {
    $("view").innerHTML = `<section class="fatal"><h2>Não foi possível iniciar o Finança Simples</h2><p>${esc(error.message || error)}</p></section>`;
  }
}
boot();