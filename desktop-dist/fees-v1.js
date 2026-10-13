(function feesModule() {
  "use strict";
  const C = window.FSCore;
  if (!C) return;
  const TYPES = { clients: "fee_clients", charges: "fee_charges", receipts: "fee_receipts" };
  const state = { tab: "dashboard", month: C.S.month, editClientId: "", editChargeId: "", message: "", error: false, busy: false };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const clients = () => C.S.data[TYPES.clients] || [];
  const charges = () => C.S.data[TYPES.charges] || [];
  const receipts = () => C.S.data[TYPES.receipts] || [];
  const can = (action) => !window.FSAuth || window.FSAuth.can("transactions", action);
  const isoToday = () => C.today();
  const amount = (v) => C.money(v);
  const cents = (v) => C.parseMoney(v);
  const input = (v) => C.inputMoney(v);
  const safeDate = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const x = String(v || "").trim();
    if (/^\d{4}-\d\d-\d\d/.test(x)) return x.slice(0, 10);
    const m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
  };
  const norm = (s) => String(s ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const client = (id) => clients().find((x) => x.id === id);
  const paid = (id) => receipts().filter((r) => r.chargeId === id).reduce((s, r) => s + Number(r.amountCents || 0), 0);
  const balance = (r) => Math.max(0, Number(r.amountCents || 0) - paid(r.id));
  const status = (r) => balance(r) === 0 ? "Quitado" : (r.dueDate < isoToday() ? "Vencido" : paid(r.id) ? "Parcial" : "Pendente");
  const chip = (value) => `<span class="tag ${value === "Quitado" ? "ok" : value === "Vencido" ? "warn" : ""}">${esc(value)}</span>`;
  const memo = (text, error = false) => { state.message = text; state.error = error; };
  const say = () => state.message ? `<p class="fee-message ${state.error ? "error" : ""}" role="status">${esc(state.message)}</p>` : "";
  const sum = (xs, get) => xs.reduce((s, x) => s + Number(get(x) || 0), 0);
  const opt = (list, current = "", placeholder = "Selecione") => `<option value="">${esc(placeholder)}</option>` + list.map((x) => `<option value="${esc(x.id)}" ${x.id === current ? "selected" : ""}>${esc(x.label)}</option>`).join("");
  const clientOptions = (selected = "") => opt(clients().filter((c) => c.active !== false).map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` })), selected);
  const bankOptions = (selected = "") => opt(C.accounts().filter((a) => a.active !== false).map((a) => ({ id: a.id, label: a.name })), selected, "Selecione a conta de recebimento");
  const tabs = [["dashboard", "Dashboard"], ["clients", "Clientes"], ["charges", "Cobranças"], ["receipts", "Recebimentos"], ["import", "Importar / Exportar"]];
  const header = () => `<section class="hero"><div><h2>Honorários contábeis</h2><p>Carteira de clientes, cobranças recorrentes, recebimentos e inadimplência.</p></div></section>
    <div class="fee-tabs">${tabs.map(([id, label]) => `<button type="button" class="${state.tab === id ? "active" : "ghost"}" data-fee-tab="${id}">${label}</button>`).join("")}</div>${say()}`;
  function summary(month) {
    const list = charges().filter((x) => x.competence === month);
    const monthlyReceipts = receipts().filter((r) => r.date?.slice(0, 7) === month);
    const expected = sum(list, (x) => x.amountCents);
    const attributed = sum(list, (x) => paid(x.id));
    const overdue = charges().filter((x) => x.dueDate < isoToday() && balance(x) > 0);
    return { expected, attributed, open: Math.max(0, expected - attributed), collected: sum(monthlyReceipts, (r) => r.amountCents), overdue: sum(overdue, balance), overdueCount: overdue.length, chargeCount: list.length };
  }
  const kpi = (label, value, hint) => `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
  function dashboardPage() {
    const m = summary(state.month);
    const start = `${state.month.slice(0, 4)}-01`;
    const latest = charges().filter((x) => balance(x) && x.dueDate < isoToday()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 12);
    const months = Array.from({ length: 12 }, (_, n) => `${start.slice(0, 4)}-${String(n + 1).padStart(2, "0")}`);
    const metrics = months.map((month) => ({ month, ...summary(month) }));
    const peak = Math.max(1, ...metrics.map((x) => x.expected));
    return `<section class="panel fee-filter"><label>Competência <input type="month" id="feeMonth" value="${state.month}"></label><span class="muted">Recebido: data do caixa. Previsto e aberto: competência. Vencido: carteira inteira até hoje.</span></section>
      <section class="kpi-grid">${kpi("Faturamento previsto", amount(m.expected), `${m.chargeCount} cobranças na competência`)}
      ${kpi("Entradas no caixa", amount(m.collected), "Recebimentos efetivos no mês")}
      ${kpi("Recebido da competência", amount(m.attributed), "Inclui pagamentos em outros meses")}
      ${kpi("Aberto da competência", amount(m.open), "Ainda não quitado")}
      ${kpi("Inadimplência vencida", amount(m.overdue), `${m.overdueCount} cobranças vencidas`)}
      ${kpi("Taxa de recebimento", m.expected ? `${(m.attributed / m.expected * 100).toFixed(1).replace(".", ",")}%` : "—", "Sobre o faturamento da competência")}</section>
      <section class="panel"><div class="panel-head"><h3>Evolução por competência — ${esc(start.slice(0, 4))}</h3></div><div class="panel-body fee-chart">${metrics.map((x) => `<div class="fee-bar-row"><span>${x.month.slice(-2)}</span><div class="fee-bar-bg"><div class="fee-bar-forecast" style="width:${(x.expected / peak * 100).toFixed(2)}%"></div><div class="fee-bar-paid" style="width:${(x.attributed / peak * 100).toFixed(2)}%"></div></div><small>${amount(x.attributed)} / ${amount(x.expected)}</small></div>`).join("")}<p class="muted">Verde: recebido da competência; cinza: faturamento previsto.</p></div></section>
      <section class="panel"><div class="panel-head"><h3>Inadimplentes — mais antigos</h3></div>${chargeTable(latest)}</section>`;
  }
  const chargeTable = (rows) => `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Competência</th><th>Vencimento</th><th>Situação</th><th class="right">Cobrado</th><th class="right">Recebido</th><th class="right">Em aberto</th></tr></thead><tbody>${rows.length ? rows.map((c) => `<tr><td>${esc(client(c.clientId)?.name || "Cliente não encontrado")}</td><td>${esc(c.competence)}</td><td>${esc(c.dueDate)}</td><td>${chip(status(c))}</td><td class="right">${amount(c.amountCents)}</td><td class="right">${amount(paid(c.id))}</td><td class="right">${amount(balance(c))}</td></tr>`).join("") : '<tr><td colspan="7" class="empty">Nenhum registro.</td></tr>'}</tbody></table></div>`;
  function clientPage() {
    const c = client(state.editClientId) || {};
    return `<div class="two-col"><section class="panel"><div class="panel-head"><h3>${c.id ? "Editar cliente" : "Cadastrar cliente"}</h3></div><form id="feeClientForm" class="form panel-body"><div class="form-grid">
    <label>Código <input required name="code" value="${esc(c.code || "")}" placeholder="CLI-001"></label>
    <label>Razão social / nome <input required name="name" value="${esc(c.name || "")}"></label>
    <label>Nome fantasia <input name="tradeName" value="${esc(c.tradeName || "")}"></label>
    <label>CPF / CNPJ <input name="taxId" value="${esc(c.taxId || "")}"></label>
    <label>Regime tributário <select name="taxRegime">${["MEI", "Simples Nacional", "Lucro Presumido", "Lucro Real", "Outro"].map((x) => `<option ${c.taxRegime === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label>Honorário mensal (R$) <input required name="monthlyFee" inputmode="decimal" value="${esc(input(c.monthlyFeeCents))}"></label>
    <label>Dia do vencimento <input required name="dueDay" type="number" min="1" max="31" value="${esc(c.dueDay || 10)}"></label>
    <label>Início do contrato <input name="startDate" type="date" value="${esc(c.startDate || "")}"></label>
    <label>WhatsApp <input name="phone" value="${esc(c.phone || "")}"></label>
    <label>E-mail <input type="email" name="email" value="${esc(c.email || "")}"></label>
    <label>Status <select name="active"><option value="true">Ativo</option><option value="false" ${c.active === false ? "selected" : ""}>Inativo</option></select></label>
    <label class="wide">Observações <input name="notes" value="${esc(c.notes || "")}"></label></div><div class="button-row">
    <button class="primary" ${!can(c.id ? "edit" : "create") ? "disabled" : ""}>Salvar cliente</button>${c.id ? '<button type="button" class="ghost" data-fee-action="cancel">Cancelar</button>' : ""}</div></form></section>
    <section class="panel"><div class="panel-head"><h3>Carteira de clientes (${clients().length})</h3></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Cliente</th><th>Regime</th><th>Mensal</th><th>Situação</th><th></th></tr></thead><tbody>${clients().sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.taxRegime || "—")}</td><td>${amount(x.monthlyFeeCents)}</td><td>${x.active === false ? "Inativo" : "Ativo"}</td><td><button type="button" class="ghost" data-fee-action="edit-client" data-id="${esc(x.id)}">Editar</button></td></tr>`).join("")}</tbody></table></div></section></div>`;
  }
  function chargePage() {
    const c = charges().find((x) => x.id === state.editChargeId) || {};
    const openRows = charges().filter((x) => x.competence === state.month).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return `<section class="panel fee-filter"><label>Competência <input id="feeMonth" type="month" value="${state.month}"></label><button type="button" class="primary" data-fee-action="generate" ${!can("create") ? "disabled" : ""}>Gerar mensalidades dos clientes ativos</button></section>
    <section class="panel"><div class="panel-head"><h3>${c.id ? "Editar cobrança" : "Cobrança avulsa"}</h3></div><form id="feeChargeForm" class="form panel-body"><div class="form-grid">
    <label>Cliente <select name="clientId" required>${clientOptions(c.clientId)}</select></label>
    <label>Competência <input name="competence" type="month" required value="${esc(c.competence || state.month)}"></label>
    <label>Tipo <select name="kind"><option value="extra">Avulsa</option><option value="monthly" ${c.kind === "monthly" ? "selected" : ""}>Mensalidade</option></select></label>
    <label>Valor (R$) <input name="amount" inputmode="decimal" required value="${esc(input(c.amountCents))}"></label>
    <label>Vencimento <input name="dueDate" type="date" required value="${esc(c.dueDate || `${state.month}-10`)}"></label>
    <label>Descrição <input name="description" value="${esc(c.description || "")}" placeholder="Serviços contábeis"></label></div><div class="button-row"><button class="primary" ${!can(c.id ? "edit" : "create") ? "disabled" : ""}>Salvar cobrança</button>${c.id ? '<button type="button" class="ghost" data-fee-action="cancel">Cancelar</button>' : ""}</div></form></section>
    <section class="panel"><div class="panel-head"><h3>Cobranças — ${esc(state.month)}</h3></div>${chargeTable(openRows)}<div class="panel-body"><div class="fee-action-list">${openRows.map((x) => `<button type="button" class="ghost" data-fee-action="edit-charge" data-id="${esc(x.id)}" ${!can("edit") ? "disabled" : ""}>Editar: ${esc(client(x.clientId)?.name || x.id)} (${esc(x.competence)})</button>`).join("")}</div></div></section>`;
  }
  function receiptPage() {
    const outstanding = charges().filter((x) => balance(x) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const recent = [...receipts()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150);
    return `<section class="panel"><div class="panel-head"><h3>Registrar recebimento e lançar no livro-caixa</h3></div><form id="feeReceiptForm" class="form panel-body"><div class="form-grid">
      <label class="wide">Cobrança em aberto <select required name="chargeId">${opt(outstanding.map((x) => ({ id: x.id, label: `${client(x.clientId)?.name || "Cliente"} • ${x.competence} • saldo ${amount(balance(x))}` })))}</select></label>
      <label>Data de recebimento <input name="date" type="date" required value="${isoToday()}"></label>
      <label>Valor recebido (R$) <input name="amount" inputmode="decimal" required placeholder="0,00"></label>
      <label>Forma de pagamento <select name="paymentMethod"><option value="pix">PIX</option><option value="transfer">Transferência</option><option value="boleto">Boleto</option><option value="cash">Dinheiro</option><option value="other">Outros</option></select></label>
      <label>Conta de entrada <select required name="accountId">${bankOptions()}</select></label>
      <label>Observação <input name="notes" placeholder="Opcional"></label></div>
      <p class="muted">Cada recebimento cria uma única receita realizada, vinculada à cobrança. Pagamentos parciais são permitidos.</p><button class="primary" ${!can("create") ? "disabled" : ""}>Confirmar recebimento</button></form></section>
      <section class="panel"><div class="panel-head"><h3>Últimos recebimentos</h3></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Competência</th><th>Forma</th><th>Conta</th><th class="right">Valor</th></tr></thead><tbody>${recent.length ? recent.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(client(r.clientId)?.name || "—")}</td><td>${esc(charges().find((x) => x.id === r.chargeId)?.competence || "—")}</td><td>${esc(r.paymentMethod)}</td><td>${esc(C.accountName(r.accountId))}</td><td class="right">${amount(r.amountCents)}</td></tr>`).join("") : '<tr><td colspan="6" class="empty">Nenhum recebimento cadastrado.</td></tr>'}</tbody></table></div></section>`;
  }
  function importPage() {
    return `<section class="panel"><div class="panel-head"><h3>Importar os dados da planilha original</h3></div><div class="panel-body">
    <p>Na planilha Excel, exporte cada aba como CSV (separador ponto e vírgula), na ordem: Clientes, Honorários e Recebimentos. Os campos são reconhecidos pelos cabeçalhos da planilha. Linhas vazias são ignoradas.</p>
    <form id="feeImportForm" class="form"><div class="form-grid"><label>Aba de origem <select name="section"><option value="clients">Clientes</option><option value="charges">Honorários</option><option value="receipts">Recebimentos</option></select></label>
    <label>Arquivo CSV <input required type="file" name="file" accept=".csv,text/csv"></label>
    <label>Conta para entradas importadas <select name="accountId">${bankOptions()}</select></label></div>
    <p class="muted">Para importar recebimentos, selecione uma conta. Valores já registrados no sistema são ignorados pelo ID original. Revise cobranças e pagamentos antes da importação.</p>
    <button class="primary" ${!can("create") ? "disabled" : ""}>Importar</button></form></div></section>
    <section class="panel"><div class="panel-head"><h3>Exportar dados</h3></div><div class="panel-body fee-action-list">${tabs.slice(1, 4).map(([t, name]) => `<button type="button" class="ghost" data-fee-action="export" data-section="${t}">Exportar ${name} em CSV</button>`).join("")}</div></section>`;
  }
  function page() {
    if (!can("view")) return '<section class="panel"><p>Você não tem permissão de acesso aos honorários neste ambiente.</p></section>';
    return header() + ({ dashboard: dashboardPage, clients: clientPage, charges: chargePage, receipts: receiptPage, import: importPage }[state.tab] || dashboardPage)();
  }
  const rowsFromCsv = (text) => {
    const result = []; let row = [], cell = "", quoted = false;
    const textClean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    for (let i = 0; i < textClean.length; i++) {
      const ch = textClean[i];
      if (ch === '"') { if (quoted && textClean[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (ch === ";" && !quoted) { row.push(cell); cell = ""; }
      else if (ch === "\n" && !quoted) { row.push(cell); if (row.some((x) => x.trim())) result.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    row.push(cell); if (row.some((x) => x.trim())) result.push(row);
    return result;
  };
  function fileRows(text, section) {
    const rows = rowsFromCsv(text);
    const title = section === "clients" ? "codigo" : section === "charges" ? "id cobranca" : "id pagamento";
    const ix = rows.findIndex((line) => norm(line[0]).includes(title));
    if (ix < 0) throw new Error("Cabeçalho da aba não identificado. Exporte a aba original em CSV separado por ponto e vírgula.");
    const cols = rows[ix].map(norm);
    const get = (r, ...aliases) => {
      const j = cols.findIndex((s) => aliases.some((a) => s === a || s.includes(a)));
      return j < 0 ? "" : String(r[j] ?? "").trim();
    };
    return rows.slice(ix + 1).map((r) => ({
      code: get(r, "codigo"),
      name: get(r, "cliente / razao social"),
      tradeName: get(r, "nome fantasia"),
      taxId: get(r, "cpf / cnpj"),
      taxRegime: get(r, "regime tributario", "regime"),
      monthlyFee: get(r, "honorario mensal"),
      dueDay: get(r, "vencimento (dia)"),
      startDate: get(r, "inicio contrato"),
      contractStatus: get(r, "contrato"),
      phone: get(r, "telefone"),
      email: get(r, "e-mail"),
      notes: get(r, "observacoes"),
      externalId: get(r, "id cobranca", "id pagamento"),
      competence: get(r, "competencia"),
      clientCode: get(r, "codigo cliente"),
      kind: get(r, "tipo"),
      chargeValue: get(r, "valor devido") || get(r, "valor informado"),
      dueDate: get(r, "vencimento"),
      receiptDate: get(r, "data recebimento"),
      chargeExternalId: get(r, "id cobranca"),
      receivedValue: get(r, "valor recebido"),
      paymentMethod: get(r, "meio de pagamento"),
    }));
  }
  async function importSheet(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const section = values.section;
    const file = form.elements.file.files?.[0];
    if (!file || file.size > 3_000_000) throw new Error("Selecione um CSV com até 3 MB.");
    const all = fileRows(await file.text(), section);
    const inputs = [];
    const receiptBatchTotals = new Map();
    const seenReceiptIds = new Set();
    if (section === "clients") {
      for (const r of all) {
        if (!r.name || !r.code) continue;
        const ex = clients().find((x) => norm(x.code) === norm(r.code));
        inputs.push({ type: TYPES.clients, id: ex?.id || C.uid(), data: {
          code: r.code, name: r.name, tradeName: r.tradeName, taxId: r.taxId,
          taxRegime: r.taxRegime || "Outro", monthlyFeeCents: cents(r.monthlyFee),
          dueDay: Math.min(31, Math.max(1, Number(r.dueDay) || 10)), startDate: safeDate(r.startDate),
          phone: r.phone, email: r.email, notes: r.notes, active: norm(r.contractStatus) !== "inativo",
        } });
      }
    } else if (section === "charges") {
      for (const r of all) {
        if (!r.competence || !r.clientCode || !cents(r.chargeValue)) continue;
        const cl = clients().find((x) => norm(x.code) === norm(r.clientCode));
        if (!cl) throw new Error(`Cliente ${r.clientCode} não cadastrado. Importe Clientes primeiro.`);
        const externalId = r.externalId;
        const ex = charges().find((x) => x.externalId === externalId && externalId);
        if (ex) continue;
        const competence = /^\d{4}-\d{2}$/.test(r.competence) ? r.competence : (safeDate(r.competence).slice(0, 7));
        if (!competence) throw new Error(`Competência inválida no registro ${externalId}.`);
        const dueDate = safeDate(r.dueDate) || C.buildDate(Number(competence.slice(0, 4)), Number(competence.slice(5)), cl.dueDay);
        inputs.push({ type: TYPES.charges, id: C.uid(), data: {
          clientId: cl.id, competence, kind: norm(r.kind).includes("mens") ? "monthly" : "extra",
          amountCents: cents(r.chargeValue), dueDate, description: r.kind || "Honorários", externalId,
        } });
      }
    } else if (section === "receipts") {
      if (!values.accountId || !C.accounts().some((x) => x.id === values.accountId)) throw new Error("Selecione uma conta válida para importar os recebimentos.");
      for (const r of all) {
        const value = cents(r.receivedValue);
        if (!r.chargeExternalId || !value) continue;
        const ch = charges().find((x) => x.externalId === r.chargeExternalId);
        if (!ch) throw new Error(`Cobrança ${r.chargeExternalId} não encontrada. Importe Honorários primeiro.`);
        if (r.externalId && (receipts().some((x) => x.externalId === r.externalId) || seenReceiptIds.has(r.externalId))) continue;
        const date = safeDate(r.receiptDate);
        if (!date) throw new Error(`Data inválida para recebimento ${r.externalId}.`);
        const remaining = balance(ch) - (receiptBatchTotals.get(ch.id) || 0);
        if (value <= 0 || value > remaining) throw new Error(`Recebimento excede o saldo da cobrança ${r.chargeExternalId}.`);
        receiptBatchTotals.set(ch.id, (receiptBatchTotals.get(ch.id) || 0) + value);
        if (r.externalId) seenReceiptIds.add(r.externalId);
        const receiptId = C.uid(), transactionId = C.uid();
        const pm = norm(r.paymentMethod);
        const paymentMethod = pm.includes("pix") ? "pix" : pm.includes("boleto") ? "boleto" : pm.includes("dinheiro") ? "cash" : pm.includes("debito") ? "debit_card" : pm.includes("transfer") ? "transfer" : "other";
        const receipt = { chargeId: ch.id, clientId: ch.clientId, date, amountCents: value, paymentMethod, accountId: values.accountId, transactionId, externalId: r.externalId };
        inputs.push({ type: TYPES.receipts, id: receiptId, data: receipt }, { type: "transactions", id: transactionId, data: cashTx(receipt, ch, receiptId) });
      }
    }
    if (inputs.length > 1800) throw new Error("Importação muito grande. Divida o arquivo em partes.");
    if (!inputs.length) return 0;
    await C.bulkSave(inputs);
    return section === "receipts" ? inputs.length / 2 : inputs.length;
  }
  function cashTx(receipt, charge, receiptId) {
    return { kind: "income", description: `Honorários contábeis • ${charge.competence}`, counterparty: client(charge.clientId)?.name || "",
      category: "Honorários contábeis", accountId: receipt.accountId, amountCents: receipt.amountCents,
      date: receipt.date, paidAt: receipt.date, dueDate: receipt.date, status: "paid", paymentMethod: receipt.paymentMethod,
      source: "accounting_fees", feeReceiptId: receiptId, feeChargeId: charge.id, notes: receipt.notes || "" };
  }
  async function saveClient(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const code = String(v.code || "").trim().toUpperCase(), value = cents(v.monthlyFee);
    if (!code || !v.name?.trim() || value <= 0 || Number(v.dueDay) < 1 || Number(v.dueDay) > 31) throw new Error("Informe cliente, código único, valor positivo e vencimento entre 1 e 31.");
    if (clients().some((x) => x.code === code && x.id !== state.editClientId)) throw new Error("Código de cliente já cadastrado.");
    const data = { ...v, code, name: v.name.trim(), monthlyFeeCents: value, dueDay: Number(v.dueDay), active: v.active !== "false" };
    delete data.monthlyFee;
    await C.save(TYPES.clients, data, state.editClientId || null); state.editClientId = "";
  }
  async function saveCharge(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const value = cents(v.amount);
    const existing = charges().find((x) => x.id === state.editChargeId);
    if (!v.clientId || !client(v.clientId) || !/^\d{4}-\d{2}$/.test(v.competence) || !safeDate(v.dueDate) || value <= 0) throw new Error("Preencha cliente, competência, vencimento e valor positivo.");
    if (value < (existing ? paid(existing.id) : 0)) throw new Error("A cobrança não pode ficar abaixo do total já recebido.");
    if (v.kind === "monthly" && charges().some((x) => x.id !== state.editChargeId && x.kind === "monthly" && x.clientId === v.clientId && x.competence === v.competence)) throw new Error("Mensalidade já cadastrada nesta competência.");
    await C.save(TYPES.charges, { clientId: v.clientId, competence: v.competence, kind: v.kind, amountCents: value, dueDate: v.dueDate, description: v.description || "Honorários contábeis", externalId: existing?.externalId || "" }, state.editChargeId || null);
    state.editChargeId = "";
  }
  async function generate() {
    const month = state.month, inputs = [];
    for (const cl of clients()) {
      if (cl.active === false || Number(cl.monthlyFeeCents) <= 0 || cl.startDate?.slice(0, 7) > month) continue;
      if (charges().some((x) => x.clientId === cl.id && x.competence === month && x.kind === "monthly")) continue;
      inputs.push({ type: TYPES.charges, id: C.uid(), data: { clientId: cl.id, competence: month, kind: "monthly", amountCents: Number(cl.monthlyFeeCents),
        dueDate: C.buildDate(Number(month.slice(0, 4)), Number(month.slice(5)), Number(cl.dueDay || 10)), description: "Mensalidade de assessoria contábil" } });
    }
    if (inputs.length) await C.bulkSave(inputs);
    return inputs.length;
  }
  async function saveReceipt(form) {
    const v = Object.fromEntries(new FormData(form).entries());
    const ch = charges().find((x) => x.id === v.chargeId);
    if (!ch) throw new Error("Selecione uma cobrança válida.");
    const value = cents(v.amount);
    if (!value || value <= 0 || value > balance(ch)) throw new Error(`Informe um valor entre R$ 0,01 e ${amount(balance(ch))}.`);
    if (!safeDate(v.date) || !C.accounts().some((x) => x.id === v.accountId)) throw new Error("Informe data e conta de recebimento válidas.");
    const receiptId = C.uid(), transactionId = C.uid();
    const receipt = { chargeId: ch.id, clientId: ch.clientId, amountCents: value, date: v.date, paymentMethod: v.paymentMethod, accountId: v.accountId, notes: v.notes || "", transactionId };
    await C.bulkSave([{ type: TYPES.receipts, id: receiptId, data: receipt }, { type: "transactions", id: transactionId, data: cashTx(receipt, ch, receiptId) }]);
  }
  function toCsvCell(x) { return `"${String(x ?? "").replaceAll('"', '""')}"`; }
  function exportCsv(section) {
    const table = section === "clients"
      ? [["Código","Cliente","CNPJ","Regime","Honorário mensal","Dia vencimento"], ...clients().map((x) => [x.code,x.name,x.taxId,x.taxRegime,input(x.monthlyFeeCents),x.dueDay])]
      : section === "charges"
        ? [["ID","Cliente","Competência","Tipo","Valor","Vencimento","Recebido","Saldo","Status"], ...charges().map((x) => [x.externalId || x.id,client(x.clientId)?.name,x.competence,x.kind,input(x.amountCents),x.dueDate,input(paid(x.id)),input(balance(x)),status(x)])]
        : [["ID","Data","Cliente","ID cobrança","Valor","Conta","Meio"], ...receipts().map((x) => [x.externalId || x.id,x.date,client(x.clientId)?.name,x.chargeId,input(x.amountCents),C.accountName(x.accountId),x.paymentMethod])];
    const blob = new Blob(["\uFEFF" + table.map((r) => r.map(toCsvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `financa-simples-${section}-${isoToday()}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const refresh = async () => { await C.load(); if (C.S.page === "fees") $("view").innerHTML = page(); };
  document.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-fee-tab]");
    if (tab) { event.preventDefault(); state.tab = tab.dataset.feeTab; memo(""); if (C.S.page === "fees") $("view").innerHTML = page(); return; }
    const button = event.target.closest("[data-fee-action]");
    if (!button || C.S.page !== "fees") return;
    event.preventDefault();
    if (state.busy) return;
    const a = button.dataset.feeAction;
    try {
      if (a === "cancel") { state.editChargeId = ""; state.editClientId = ""; memo(""); }
      if (a === "edit-client") { state.editClientId = button.dataset.id; state.tab = "clients"; memo(""); }
      if (a === "edit-charge") { state.editChargeId = button.dataset.id; state.tab = "charges"; memo(""); }
      if (a === "export") { exportCsv(button.dataset.section); return; }
      if (a === "generate") {
        if (!can("create")) throw new Error("Sem permissão para criar cobranças.");
        state.busy = true; const n = await generate(); await C.load(); memo(`${n} mensalidade(s) gerada(s); cobranças existentes foram preservadas.`);
      }
    } catch (e) { memo(e.message || String(e), true); }
    finally { state.busy = false; if (C.S.page === "fees") $("view").innerHTML = page(); }
  });
  document.addEventListener("change", (event) => {
    if (event.target?.id === "feeMonth") { state.month = event.target.value; C.S.month = state.month; if (C.S.page === "fees") $("view").innerHTML = page(); }
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!["feeClientForm","feeChargeForm","feeReceiptForm","feeImportForm"].includes(form?.id)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (state.busy) return;
    const updating = (form.id === "feeClientForm" && state.editClientId) || (form.id === "feeChargeForm" && state.editChargeId) ? "edit" : "create";
    if (!can(updating)) { memo("Sem permissão para esta operação.", true); $("view").innerHTML = page(); return; }
    state.busy = true;
    const release = window.FSAuth?.lockWorkspace?.();
    try {
      if (form.id === "feeClientForm") await saveClient(form);
      else if (form.id === "feeChargeForm") await saveCharge(form);
      else if (form.id === "feeReceiptForm") await saveReceipt(form);
      else {
        const n = await importSheet(form);
        memo(`${n} registro(s) importado(s).`);
      }
      await refresh();
      if (form.id !== "feeImportForm") memo("Registro salvo com sucesso.");
    } catch (e) { memo(e.message || String(e), true); }
    finally { release?.(); state.busy = false; if (C.S.page === "fees") $("view").innerHTML = page(); }
  }, true);
  window.FSFees = { page, summary, status, balance, parseCsv: rowsFromCsv };
})();
