(() => {
  const C = window.FSCore;
  if (!C) throw new Error("Engine financeira não carregada.");
  const {
    invoke, S, PAYMENT_METHODS, ACCOUNT_TYPES, CARD_BRANDS, INVESTMENT_TYPES,
    today, nextMonth, money, pct, parseMoney, inputMoney,
    save, remove, load, tx, accounts, cards, categories, investments,
    accountById, cardById, categoryById, categoryName, accountName, cardName,
    effectiveDate, effectiveMonth, isExpense, isIncome, isTransfer, isCardPayment, isCardPurchase,
    accountBalance, totalCashBalance, cardUsed, cardAvailable, invoiceGroups,
    monthMetrics, expenseRanking, incomeRanking, cardCategoryRanking, cardRanking,
    annualMetrics, investmentMetrics,
    saveRegularLaunch, saveCardLaunch, saveTransfer, settleTransaction, settleInvoice,
    importInvoice,
  } = C;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const tag = (text, tone = "") => `<span class="tag ${tone}">${esc(text)}</span>`;
  const k = (label, value, hint = "") => `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
  const monthLabel = (month) => {
    const [year, number] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, number - 1, 1));
  };
  const statusLabel = (item) => {
    if (isIncome(item)) return item.status === "paid" ? tag("Recebido", "ok") : tag("A receber", "warn");
    if (isCardPurchase(item)) return item.status === "paid" ? tag("Fatura paga", "ok") : tag("Na fatura", "warn");
    return item.status === "paid" ? tag("Pago", "ok") : tag("A pagar", "warn");
  };
  const formObject = (form) => Object.fromEntries(new FormData(form).entries());
  const setMessage = (id, text, error = false) => {
    const el = $(id); if (!el) return;
    el.textContent = text;
    el.classList.toggle("error", error);
  };
  const download = (name, content, mime = "text/plain;charset=utf-8") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  function pageTitle() {
    return {
      dashboard: "Dashboard",
      transactions: "Lançamentos",
      accounts: "Contas & Cartões",
      annual: "Resumo Anual",
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

  function accountOptions(selected = "", includeBlank = true) {
    const items = accounts().filter((item) => item.active !== false);
    return `${includeBlank ? `<option value="">Sem vínculo / não informar</option>` : ""}${items.map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${esc(item.name)}${item.institution ? ` — ${esc(item.institution)}` : ""}</option>`).join("")}`;
  }
  function cardOptions(selected = "") {
    return `<option value="">Selecione...</option>${cards().filter((item) => item.active !== false).map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${esc(item.name)}${item.last4 ? ` •••• ${esc(item.last4)}` : ""}</option>`).join("")}`;
  }
  function categoryOptions(kind, selected = "") {
    const essentialFirst = categories().filter((item) => item.active !== false && item.kind === kind)
      .sort((a, b) => Number(b.source === "essential-2025") - Number(a.source === "essential-2025") || a.name.localeCompare(b.name));
    return `<option value="">Selecione...</option>${essentialFirst.map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}`;
  }
  function installmentsOptions(selected = 1) {
    return Array.from({ length: 60 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(selected) === n ? "selected" : ""}>${n}x</option>`).join("");
  }
  function flowClassOptions(selected = "variable") {
    return `<option value="variable" ${selected === "variable" ? "selected" : ""}>Variável</option><option value="fixed" ${selected === "fixed" ? "selected" : ""}>Fixo</option>`;
  }

  function rankingTable(title, entries, empty = "Sem dados no período.") {
    const total = entries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
    return `<section class="panel"><div class="panel-head"><h3>${esc(title)}</h3></div><div class="table-wrap"><table><thead><tr><th>Categoria</th><th class="right">Valor</th><th class="right">%</th></tr></thead><tbody>${entries.length ? entries.slice(0, 12).map(([name, value]) => `<tr><td>${esc(name)}</td><td class="right">${money(value)}</td><td class="right">${pct(total ? value / total * 100 : 0)}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div></section>`;
  }

  function invoiceTable(title, month) {
    const groups = invoiceGroups().filter((group) => group.invoiceMonth === month);
    return `<section class="panel"><div class="panel-head"><div><h3>${esc(title)}</h3><small>${esc(monthLabel(month))}</small></div><button class="ghost" data-page="accounts">Gerenciar</button></div><div class="table-wrap"><table><thead><tr><th>Cartão</th><th class="right">Fatura</th><th>Status</th></tr></thead><tbody>${groups.length ? groups.map((group) => `<tr><td>${esc(cardName(group.cardId))}</td><td class="right">${money(group.amountCents)}</td><td>${group.pendingCents ? tag("A pagar", "warn") : tag("Paga", "ok")}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">Nenhuma fatura.</td></tr>`}</tbody></table></div></section>`;
  }

  function dashboard() {
    const m = monthMetrics(S.month);
    const currentInvoices = invoiceGroups().filter((g) => g.invoiceMonth === S.month);
    const next = nextMonth(S.month);
    const nextInvoices = invoiceGroups().filter((g) => g.invoiceMonth === next);
    const recent = tx().filter((item) => !isCardPayment(item)).sort((a, b) => String(b._updatedAt || effectiveDate(b)).localeCompare(String(a._updatedAt || effectiveDate(a)))).slice(0, 8);
    const cardRanks = cardRanking(S.month);
    const cardCats = cardCategoryRanking(S.month);
    const growth = Number(S.settings.openingBalanceCents || 0) ? ((m.finalBalance - Number(S.settings.openingBalanceCents || 0)) / Math.abs(Number(S.settings.openingBalanceCents || 0))) * 100 : 0;
    return `<section class="hero"><div><h2>${esc(S.settings.profileName)}</h2><p>Visão de ${esc(monthLabel(S.month))} baseada no modelo Finança Simples - Essencial 2025.</p></div><div class="button-row"><button class="ghost" data-page="accounts">Contas & Cartões</button><button class="primary" data-page="transactions">Novo lançamento</button></div></section>
      <section class="report-toolbar panel"><label>Mês de análise<input id="month" type="month" value="${S.month}"></label><span class="muted">Cartão é acompanhado por ciclo de fatura; a compra não duplica a saída mensal.</span></section>
      <section class="kpi-grid">
        ${k("Saída", money(m.expensePaid), `${money(m.expensePending)} a pagar`)}
        ${k("Entrada", money(m.incomePaid), `${money(m.incomePending)} a receber`)}
        ${k("Lucro do mês", money(m.resultPaid), `${money(m.toProfit)} a lucrar`)}
        ${k("Saldo atual/final", money(m.finalBalance), `previsão ${money(m.forecastBalance)}`)}
        ${k("Saldo inicial", money(S.settings.openingBalanceCents), `${growth >= 0 ? "+" : ""}${pct(growth)} crescimento`)}
        ${k("Faturas do mês", money(currentInvoices.reduce((s, g) => s + g.amountCents, 0)), `${currentInvoices.length} cartão(ões)`)}
        ${k("Faturas próximo mês", money(nextInvoices.reduce((s, g) => s + g.amountCents, 0)), esc(monthLabel(next)))}
        ${k("Gasto em cartão", money(m.cardSpent), S.settings.averageMonthlyIncomeCents ? `${pct(m.cardCommitmentPct)} da renda média` : "renda média não definida")}
      </section>
      <div class="two-col">${invoiceTable("Faturas deste mês", S.month)}${invoiceTable("Faturas do próximo mês", next)}</div>
      <div class="two-col">${rankingTable("Ranking de gastos", expenseRanking(S.month))}${rankingTable("Ranking de rendas", incomeRanking(S.month))}</div>
      <div class="two-col">${rankingTable("Ranking de gastos em cartões", cardRanks)}${rankingTable("Cartão por categoria", cardCats)}</div>
      <section class="panel"><div class="panel-head"><h3>Últimos lançamentos</h3><button class="ghost" data-page="transactions">Ver todos</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Parcela</th><th>Status</th><th class="right">Valor</th></tr></thead><tbody>${recent.length ? recent.map((item) => `<tr><td>${esc(effectiveDate(item))}</td><td>${esc(item.description)}</td><td>${esc(categoryName(item))}</td><td>${Number(item.installmentCount || 1) > 1 ? `${item.installmentNumber}/${item.installmentCount}` : "—"}</td><td>${statusLabel(item)}</td><td class="right ${isIncome(item) ? "income" : "expense"}">${isIncome(item) ? "+" : "−"}${money(item.amountCents)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">Nenhum lançamento.</td></tr>`}</tbody></table></div></section>`;
  }

  function expenseLauncher() {
    return `<section class="panel"><div class="panel-head"><div><h3>Nova saída</h3><small>Equivale ao lançador de saídas da planilha.</small></div></div><form id="expenseForm" class="form panel-body"><div class="form-grid">
      <label>Data<input name="date" type="date" required value="${today()}"></label>
      <label>Categoria*<select name="categoryId" required>${categoryOptions("expense")}</select></label>
      <label>Beneficiário<input name="counterparty" placeholder="Quem recebeu"></label>
      <label class="wide">Descrição*<input name="description" required placeholder="Ex.: aluguel, mercado"></label>
      <label>Valor*<input name="amount" required placeholder="0,00"></label>
      <label>Parcelas<select name="installmentCount">${installmentsOptions()}</select></label>
      <label>Status<select name="status"><option value="paid">Pago</option><option value="pending">A pagar</option></select></label>
      <label>Natureza<select name="flowClass">${flowClassOptions()}</select></label>
      <label>Primeiro vencimento<input name="dueDate" type="date"></label>
      <label>Forma<select name="paymentMethod">${Object.entries(PAYMENT_METHODS).filter(([value]) => value !== "credit_card").map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("")}</select></label>
      <label class="wide">Conta / banco <small>(opcional)</small><select name="accountId">${accountOptions()}</select></label>
      <label class="wide">Observação<input name="notes" placeholder="Opcional"></label>
    </div><div class="button-row"><button class="primary">Lançar saída</button><span id="expenseMsg" class="form-msg"></span></div></form></section>`;
  }

  function incomeLauncher() {
    return `<section class="panel"><div class="panel-head"><div><h3>Nova entrada</h3><small>Equivale ao lançador de entradas da planilha.</small></div></div><form id="incomeForm" class="form panel-body"><div class="form-grid">
      <label>Data<input name="date" type="date" required value="${today()}"></label>
      <label>Categoria*<select name="categoryId" required>${categoryOptions("income")}</select></label>
      <label>Pagador<input name="counterparty" placeholder="Quem pagou"></label>
      <label class="wide">Descrição*<input name="description" required placeholder="Ex.: salário, venda"></label>
      <label>Valor*<input name="amount" required placeholder="0,00"></label>
      <label>Parcelas<select name="installmentCount">${installmentsOptions()}</select></label>
      <label>Status<select name="status"><option value="paid">Recebido</option><option value="pending">A receber</option></select></label>
      <label>Natureza<select name="flowClass">${flowClassOptions()}</select></label>
      <label>Primeiro recebimento<input name="dueDate" type="date"></label>
      <label>Forma<select name="paymentMethod">${Object.entries(PAYMENT_METHODS).filter(([value]) => value !== "credit_card").map(([value, label]) => `<option value="${value}" ${value === "transfer" ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label class="wide">Conta / banco <small>(opcional)</small><select name="accountId">${accountOptions()}</select></label>
      <label class="wide">Observação<input name="notes" placeholder="Opcional"></label>
    </div><div class="button-row"><button class="primary">Lançar entrada</button><span id="incomeMsg" class="form-msg"></span></div></form></section>`;
  }

  function cardLauncher() {
    return `<section class="panel"><div class="panel-head"><div><h3>Compra no cartão</h3><small>Lançador próprio, como na planilha Essencial 2025.</small></div></div><form id="cardTxForm" class="form panel-body"><div class="form-grid">
      <label>Data*<input name="date" type="date" required value="${today()}"></label>
      <label>Cartão*<select name="cardId" required>${cardOptions()}</select></label>
      <label>Beneficiário<input name="counterparty" placeholder="Estabelecimento"></label>
      <label>Categoria*<select name="categoryId" required>${categoryOptions("expense")}</select></label>
      <label class="wide">Descrição<input name="description" placeholder="Descrição da compra"></label>
      <label>Valor*<input name="amount" required placeholder="0,00"></label>
      <label>Parcelas<select name="installmentCount">${installmentsOptions()}</select></label>
      <label class="wide">Observação<input name="notes" placeholder="Opcional"></label>
    </div>${cards().length ? "" : `<div class="notice warn"><strong>Nenhum cartão configurado.</strong><span>Cadastre o cartão com fechamento e vencimento em Contas & Cartões.</span><button type="button" class="ghost" data-page="accounts">Cadastrar cartão</button></div>`}<div class="button-row"><button class="primary" ${cards().length ? "" : "disabled"}>Lançar compra</button><span id="cardTxMsg" class="form-msg"></span></div></form></section>`;
  }

  function transferLauncher() {
    return `<section class="panel"><div class="panel-head"><h3>Transferência entre contas</h3></div><form id="transferForm" class="form panel-body"><div class="form-grid"><label>Data<input name="date" type="date" value="${today()}"></label><label>Valor<input name="amount" required placeholder="0,00"></label><label>Origem<select name="accountId" required>${accountOptions("", false)}</select></label><label>Destino<select name="targetAccountId" required>${accountOptions("", false)}</select></label><label class="wide">Descrição<input name="description" value="Transferência"></label></div><div class="button-row"><button class="ghost" ${accounts().length >= 2 ? "" : "disabled"}>Transferir</button><span id="transferMsg" class="form-msg"></span></div></form></section>`;
  }

  function editTransactionPanel() {
    const item = S.edit.transactions ? tx().find((row) => row.id === S.edit.transactions) : null;
    if (!item) return "";
    if (isTransfer(item) || isCardPayment(item)) return `<section class="panel"><div class="panel-head"><h3>Registro protegido</h3><button class="ghost" data-action="cancel" data-type="transactions">Fechar</button></div><div class="panel-body"><p class="muted">Transferências e pagamentos de fatura devem ser estornados/excluídos pelo fluxo correspondente para manter a consistência.</p></div></section>`;
    return `<section class="panel"><div class="panel-head"><div><h3>Editar lançamento</h3><small>${Number(item.installmentCount || 1) > 1 ? `Parcela ${item.installmentNumber}/${item.installmentCount}; altera somente esta parcela.` : "Altera este registro."}</small></div><button class="ghost" data-action="cancel" data-type="transactions">Cancelar</button></div><form id="editTxForm" class="form panel-body"><div class="form-grid"><label class="wide">Descrição<input name="description" required value="${esc(item.description)}"></label><label>Valor<input name="amount" required value="${inputMoney(item.amountCents)}"></label><label>Data<input name="date" type="date" value="${esc(item.date || today())}"></label><label>Vencimento<input name="dueDate" type="date" value="${esc(item.dueDate || "")}"></label><label>Categoria<select name="categoryId">${categoryOptions(isIncome(item) ? "income" : "expense", item.categoryId || "")}</select></label><label>Status<select name="status"><option value="paid" ${item.status === "paid" ? "selected" : ""}>${isIncome(item) ? "Recebido" : "Pago"}</option><option value="pending" ${item.status !== "paid" ? "selected" : ""}>${isIncome(item) ? "A receber" : "A pagar"}</option></select></label><label class="wide">Beneficiário / Pagador<input name="counterparty" value="${esc(item.counterparty || "")}"></label><label class="wide">Conta / banco (opcional)<select name="accountId">${accountOptions(item.accountId || "")}</select></label><label class="wide">Observação<input name="notes" value="${esc(item.notes || "")}"></label></div><button class="primary">Salvar alteração</button><span id="editTxMsg" class="form-msg"></span></form></section>`;
  }

  function transactionRows() {
    return tx().filter((item) => !isCardPayment(item) && effectiveMonth(item) === S.month).sort((a, b) => String(effectiveDate(b)).localeCompare(String(effectiveDate(a))));
  }
  function originLabel(item) {
    if (isCardPurchase(item)) return cardName(item.cardId);
    if (isTransfer(item)) return `${accountName(item.accountId)} → ${accountName(item.targetAccountId)}`;
    return item.accountId ? accountName(item.accountId) : "Sem vínculo bancário";
  }
  function transactionsPage() {
    const rows = transactionRows();
    return `<section class="hero"><div><h2>Lançamentos</h2><p>Três lançadores principais reproduzem o fluxo da planilha: saída, entrada e cartão. Parcelas estão disponíveis nos três.</p></div>${tag(monthLabel(S.month), "ok")}</section>
      <section class="report-toolbar panel"><label>Mês<input id="month" type="month" value="${S.month}"></label><div><button class="ghost" data-action="exportTx">Exportar CSV</button></div></section>
      ${editTransactionPanel()}
      <div class="cards-grid">${expenseLauncher()}${incomeLauncher()}${cardLauncher()}</div>
      <div class="two-col">${transferLauncher()}<section class="panel"><div class="panel-head"><div><h3>Importar fatura CSV</h3><small>Importe uma fatura já fechada para um cartão cadastrado.</small></div></div><form id="importForm" class="form panel-body"><label>Cartão<select name="cardId" required>${cardOptions()}</select></label><label>Vencimento da fatura<input name="dueDate" type="date" required></label><label>Arquivo CSV<input name="file" type="file" accept=".csv,text/csv" required></label><button class="ghost" ${cards().length ? "" : "disabled"}>Importar fatura</button><span id="importMsg" class="form-msg"></span></form></section></div>
      <section class="panel"><div class="panel-head"><h3>Movimentos de ${esc(monthLabel(S.month))}</h3></div><div class="table-wrap"><table><thead><tr><th>Data/competência</th><th>Descrição</th><th>Beneficiário/Pagador</th><th>Categoria</th><th>Origem</th><th>Parcela</th><th>Status</th><th class="right">Valor</th><th></th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td>${esc(effectiveDate(item))}</td><td>${esc(item.description)}</td><td>${esc(item.counterparty || "—")}</td><td>${esc(categoryName(item))}</td><td>${esc(originLabel(item))}</td><td>${Number(item.installmentCount || 1) > 1 ? `${item.installmentNumber}/${item.installmentCount}` : "—"}</td><td>${statusLabel(item)}</td><td class="right ${isIncome(item) ? "income" : "expense"}">${isIncome(item) ? "+" : "−"}${money(item.amountCents)}</td><td class="right actions-cell">${item.status !== "paid" && !isCardPurchase(item) ? `<button class="ghost" data-action="settle" data-id="${item.id}">Baixar</button>` : ""}${!isTransfer(item) ? `<button class="ghost" data-action="edit" data-type="transactions" data-id="${item.id}">Editar</button>` : ""}<button class="danger ghost" data-action="delete" data-type="transactions" data-id="${item.id}">Excluir</button></td></tr>`).join("") : `<tr><td colspan="9" class="empty">Nenhum lançamento neste mês.</td></tr>`}</tbody></table></div></section>`;
  }

  function accountForm() {
    const edit = S.edit.accounts ? accounts().find((item) => item.id === S.edit.accounts) : null;
    return `<section class="panel"><div class="panel-head"><h3>${edit ? "Editar" : "Novo"} banco/conta</h3>${edit ? `<button class="ghost" data-action="cancel" data-type="accounts">Cancelar</button>` : ""}</div><form id="accountForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome<input name="name" required value="${esc(edit?.name || "")}" placeholder="Ex.: Banco 1, Dinheiro"></label><label>Instituição<input name="institution" value="${esc(edit?.institution || "")}"></label><label>Tipo<select name="type">${Object.entries(ACCOUNT_TYPES).map(([value, label]) => `<option value="${value}" ${edit?.type === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label><label>Saldo inicial da conta<input name="openingBalance" value="${edit ? inputMoney(edit.openingBalanceCents) : ""}" placeholder="0,00"></label><label>Ativa<select name="active"><option value="true" ${edit?.active !== false ? "selected" : ""}>Sim</option><option value="false" ${edit?.active === false ? "selected" : ""}>Não</option></select></label></div><button class="primary">Salvar conta</button></form></section>`;
  }
  function cardForm() {
    const edit = S.edit.cards ? cards().find((item) => item.id === S.edit.cards) : null;
    return `<section class="panel"><div class="panel-head"><h3>${edit ? "Editar" : "Novo"} cartão</h3>${edit ? `<button class="ghost" data-action="cancel" data-type="cards">Cancelar</button>` : ""}</div><form id="cardForm" class="form panel-body"><div class="form-grid"><label class="wide">Cartão<input name="name" required value="${esc(edit?.name || "")}" placeholder="Ex.: Cartão 1"></label><label>Instituição<input name="institution" value="${esc(edit?.institution || "")}"></label><label>Bandeira<select name="brand">${CARD_BRANDS.map((brand) => `<option ${edit?.brand === brand ? "selected" : ""}>${esc(brand)}</option>`).join("")}</select></label><label>Final<input name="last4" maxlength="4" value="${esc(edit?.last4 || "")}"></label><label>Fechamento<input name="closingDay" type="number" min="1" max="31" required value="${edit?.closingDay || ""}" placeholder="Ex.: 5"></label><label>Vencimento<input name="dueDay" type="number" min="1" max="31" required value="${edit?.dueDay || ""}" placeholder="Ex.: 12"></label><label>Área / categoria<select name="areaCategoryId">${categoryOptions("expense", edit?.areaCategoryId || "")}</select></label><label>Conta que paga <small>(opcional)</small><select name="accountId">${accountOptions(edit?.accountId || "")}</select></label><label>Limite <small>(opcional)</small><input name="limit" value="${edit ? inputMoney(edit.limitCents) : ""}" placeholder="0,00"></label><label>Ativo<select name="active"><option value="true" ${edit?.active !== false ? "selected" : ""}>Sim</option><option value="false" ${edit?.active === false ? "selected" : ""}>Não</option></select></label></div><button class="primary">Salvar cartão</button></form></section>`;
  }
  function accountsPage() {
    const invoices = invoiceGroups();
    return `<section class="hero"><div><h2>Contas & Cartões</h2><p>Os bancos são cadastros auxiliares como no MENU da planilha; não são obrigatórios nos lançamentos. Cartões usam fechamento, vencimento e Área.</p></div><div>${tag(`${accounts().length} conta(s)`)} ${tag(`${cards().length} cartão(ões)`)}</div></section><div class="two-col">${accountForm()}${cardForm()}</div>
      <section class="panel"><div class="panel-head"><h3>Bancos e dinheiro</h3><strong>${money(totalCashBalance())}</strong></div><div class="table-wrap"><table><thead><tr><th>Conta</th><th>Instituição</th><th>Tipo</th><th class="right">Saldo</th><th></th></tr></thead><tbody>${accounts().map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.institution || "—")}</td><td>${esc(ACCOUNT_TYPES[item.type] || "Outra")}</td><td class="right">${money(accountBalance(item.id))}</td><td class="right"><button class="ghost" data-action="edit" data-type="accounts" data-id="${item.id}">Editar</button></td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h3>Cartões</h3></div><div class="cards-grid">${cards().length ? cards().map((card) => `<article class="credit-card"><div class="credit-card-top"><div><strong>${esc(card.name)}</strong><small>${esc(card.institution || "")}${card.last4 ? ` •••• ${esc(card.last4)}` : ""}</small></div>${tag(card.active === false ? "Inativo" : card.brand || "Cartão", card.active === false ? "" : "ok")}</div><div class="credit-card-values"><div><span>Fechamento</span><strong>dia ${esc(card.closingDay)}</strong></div><div><span>Vencimento</span><strong>dia ${esc(card.dueDay)}</strong></div><div><span>Em aberto</span><strong>${money(cardUsed(card.id))}</strong></div></div><div class="credit-card-foot"><span>Área: ${esc(categoryById(card.areaCategoryId)?.name || "não definida")}</span><span>${Number(card.limitCents || 0) ? `Disponível: ${money(cardAvailable(card))}` : "Limite não informado"}</span></div><div class="button-row"><button class="ghost" data-action="edit" data-type="cards" data-id="${card.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="cards" data-id="${card.id}">Excluir</button></div></article>`).join("") : `<div class="empty-card">Cadastre os cartões usados na planilha.</div>`}</div></section>
      <section class="panel"><div class="panel-head"><h3>Faturas e parcelas</h3><span class="muted">É possível marcar a fatura como paga mesmo sem vincular banco.</span></div><div class="table-wrap"><table><thead><tr><th>Mês</th><th>Cartão</th><th>Itens</th><th class="right">Total</th><th class="right">A pagar</th><th>Status</th><th></th></tr></thead><tbody>${invoices.length ? invoices.map((group) => `<tr><td>${esc(group.invoiceMonth)}</td><td>${esc(cardName(group.cardId))}</td><td>${group.items.length}</td><td class="right">${money(group.amountCents)}</td><td class="right">${money(group.pendingCents)}</td><td>${group.pendingCents ? tag("A pagar", "warn") : tag("Paga", "ok")}</td><td class="right">${group.pendingCents ? `<button class="primary compact" data-action="payInvoice" data-card-id="${group.cardId}" data-month="${group.invoiceMonth}">Pagar fatura</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">Nenhuma fatura gerada.</td></tr>`}</tbody></table></div></section>`;
  }

  function annualPage() {
    const a = annualMetrics(S.year);
    const expenseMap = new Map(), incomeMap = new Map(), cardMap = new Map();
    for (const m of a.months) {
      for (const [name, value] of expenseRanking(m.month)) expenseMap.set(name, (expenseMap.get(name) || 0) + value);
      for (const [name, value] of incomeRanking(m.month)) incomeMap.set(name, (incomeMap.get(name) || 0) + value);
      for (const [name, value] of cardRanking(m.month)) cardMap.set(name, (cardMap.get(name) || 0) + value);
    }
    const sortMap = (map) => [...map.entries()].sort((x, y) => y[1] - x[1]);
    return `<section class="hero"><div><h2>Resumo Anual</h2><p>Visão equivalente à aba ANUAL da planilha.</p></div><label>Ano<input id="year" type="number" min="2000" max="2100" value="${S.year}"></label></section><section class="kpi-grid">${k("Saída anual", money(a.expensePaid))}${k("Entrada anual", money(a.incomePaid))}${k("Lucro anual", money(a.resultPaid))}${k("Gasto anual em cartão", money(a.cardSpent))}</section><section class="panel"><div class="panel-head"><h3>Evolução mensal</h3></div><div class="table-wrap"><table><thead><tr><th>Mês</th><th class="right">Saída</th><th class="right">Entrada</th><th class="right">Resultado</th><th class="right">Cartão</th><th class="right">Previsão</th></tr></thead><tbody>${a.months.map((m) => `<tr><td>${esc(monthLabel(m.month))}</td><td class="right expense">${money(m.expensePaid)}</td><td class="right income">${money(m.incomePaid)}</td><td class="right ${m.resultPaid >= 0 ? "income" : "expense"}">${money(m.resultPaid)}</td><td class="right">${money(m.cardSpent)}</td><td class="right">${money(m.resultForecast)}</td></tr>`).join("")}</tbody></table></div></section><div class="two-col">${rankingTable("Ranking anual de gastos", sortMap(expenseMap))}${rankingTable("Ranking anual de rendas", sortMap(incomeMap))}</div>${rankingTable("Ranking anual por cartão", sortMap(cardMap))}`;
  }

  function openFinancePage() {
    return `<section class="hero"><div><h2>Open Finance</h2><p>O aplicativo funciona localmente sem depender do Open Finance. A integração bancária automática só será ativada por backend seguro.</p></div><span class="status-badge ${navigator.onLine ? "online" : ""}">${navigator.onLine ? "Internet disponível" : "Offline"}</span></section><section class="kpi-grid">${k("Bancos cadastrados", String(accounts().length))}${k("Saldo local", money(totalCashBalance()))}${k("Banco SQLite", S.runtime?.databaseHealthy ? "Íntegro" : "Verificar")}${k("Sincronização", "Não conectada", "sem expor credenciais no app")}</section><section class="panel"><div class="panel-head"><h3>Contas locais</h3><button class="ghost" data-page="accounts">Gerenciar</button></div><div class="table-wrap"><table><tbody>${accounts().map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.institution || "—")}</td><td class="right">${money(accountBalance(item.id))}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function investmentForm() {
    const edit = S.edit.investments ? investments().find((item) => item.id === S.edit.investments) : null;
    return `<section class="panel"><div class="panel-head"><h3>${edit ? "Editar" : "Novo"} investimento</h3>${edit ? `<button class="ghost" data-action="cancel" data-type="investments">Cancelar</button>` : ""}</div><form id="investmentForm" class="form panel-body"><div class="form-grid"><label>Tipo<select name="type">${INVESTMENT_TYPES.map((type) => `<option ${edit?.type === type ? "selected" : ""}>${esc(type)}</option>`).join("")}</select></label><label>Ativo / nome<input name="name" required value="${esc(edit?.name || "")}"></label><label>Instituição<input name="institution" value="${esc(edit?.institution || "")}"></label><label>Código / ticker<input name="ticker" value="${esc(edit?.ticker || "")}"></label><label>Quantidade<input name="quantity" type="number" step="0.00000001" value="${edit?.quantity ?? 0}"></label><label>Preço médio<input name="averagePrice" value="${edit ? inputMoney(edit.averagePriceCents) : ""}"></label><label>Preço atual<input name="currentPrice" value="${edit ? inputMoney(edit.currentPriceCents) : ""}"></label><label>Data<input name="date" type="date" value="${edit?.date || today()}"></label></div><button class="primary">Salvar investimento</button></form></section>`;
  }
  function investmentsPage() {
    const m = investmentMetrics();
    return `<section class="kpi-grid">${k("Total aplicado", money(m.cost))}${k("Valor atual", money(m.current))}${k("Resultado", money(m.gain))}${k("Ativos", String(investments().length))}</section><div class="two-col">${investmentForm()}<section class="panel"><div class="panel-head"><h3>Posição</h3></div><div class="panel-body"><p class="muted">Investimentos são um módulo do Finança Simples, mas ficam separados dos indicadores centrais da planilha Essencial.</p></div></section></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Ativo</th><th>Instituição</th><th class="right">Quantidade</th><th class="right">Custo</th><th class="right">Atual</th><th></th></tr></thead><tbody>${investments().length ? investments().map((item) => { const cost = Math.round(Number(item.quantity || 0) * Number(item.averagePriceCents || 0)); const current = Math.round(Number(item.quantity || 0) * Number(item.currentPriceCents || 0)); return `<tr><td>${esc(item.type)}</td><td>${esc(item.name)}</td><td>${esc(item.institution || "—")}</td><td class="right">${esc(item.quantity)}</td><td class="right">${money(cost)}</td><td class="right">${money(current)}</td><td class="right"><button class="ghost" data-action="edit" data-type="investments" data-id="${item.id}">Editar</button></td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">Nenhum investimento.</td></tr>`}</tbody></table></div></section>`;
  }

  function settingsPage() {
    return `<section class="hero"><div><h2>Parametrização</h2><p>Organizada conforme o MENU da planilha: saldo inicial, renda média, categorias, cartões e bancos.</p></div>${tag("Essencial 2025", "ok")}</section><div class="two-col"><section class="panel"><div class="panel-head"><h3>Parâmetros principais</h3></div><form id="settingsForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome do perfil<input name="profileName" value="${esc(S.settings.profileName)}"></label><label>Saldo inicial global<input name="openingBalance" value="${inputMoney(S.settings.openingBalanceCents)}"></label><label>Renda média mensal<input name="averageMonthlyIncome" value="${inputMoney(S.settings.averageMonthlyIncomeCents)}"></label><label>Meta de reserva <small>(opcional)</small><input name="emergencyReserveGoal" value="${inputMoney(S.settings.emergencyReserveGoalCents)}"></label><label>Conta padrão <small>(opcional)</small><select name="defaultAccountId">${accountOptions(S.settings.defaultAccountId || "")}</select></label></div><button class="primary">Salvar parâmetros</button><span id="settingsMsg" class="form-msg"></span></form></section><section class="panel"><div class="panel-head"><h3>Banco local</h3></div><div class="panel-body"><div class="report-lines"><div><span>Armazenamento</span><strong>${esc(S.runtime?.storage || "SQLite")}</strong></div><div><span>Integridade</span><strong>${S.runtime?.databaseHealthy ? "OK" : esc(S.runtime?.databaseCheck || "Verificar")}</strong></div><div><span>Modelo de referência</span><strong>Finança Simples - Essencial 2025</strong></div></div><div class="button-row"><button class="ghost" data-action="backup">Criar backup</button><button class="ghost" data-action="snapshot">Exportar JSON</button><button class="ghost" data-action="print">Imprimir / PDF</button></div><span id="backupMsg" class="form-msg"></span></div></section></div><section class="panel"><div class="panel-head"><div><h3>Categorias</h3><small>As categorias originais da planilha são preservadas; você também pode adicionar outras.</small></div></div><form id="categoryForm" class="form panel-body"><div class="form-grid"><label>Tipo<select name="kind"><option value="expense">Saída</option><option value="income">Entrada</option></select></label><label>Nome<input name="name" required></label></div><button class="ghost">Adicionar categoria</button></form><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Categoria</th><th>Origem</th><th></th></tr></thead><tbody>${categories().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map((item) => `<tr><td>${item.kind === "income" ? "Entrada" : "Saída"}</td><td>${esc(item.name)}</td><td>${item.source === "essential-2025" ? tag("Essencial 2025", "ok") : "Personalizada"}</td><td class="right">${item.source !== "essential-2025" ? `<button class="danger ghost" data-action="delete" data-type="categories" data-id="${item.id}">Excluir</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function render() {
    shell();
    const pages = { dashboard, transactions: transactionsPage, accounts: accountsPage, annual: annualPage, openfinance: openFinancePage, investments: investmentsPage, settings: settingsPage };
    $("view").innerHTML = (pages[S.page] || dashboard)();
    bindPage();
  }

  async function handleLaunch(form, kind, msgId) {
    setMessage(msgId, "Salvando...");
    try {
      await saveRegularLaunch(formObject(form), kind);
      await load();
      setMessage(msgId, "Lançamento salvo.");
      render();
    } catch (error) { setMessage(msgId, error.message || String(error), true); }
  }

  function bindPage() {
    $("month")?.addEventListener("change", (event) => { S.month = event.target.value; S.year = Number(S.month.slice(0, 4)); render(); });
    $("year")?.addEventListener("change", (event) => { S.year = Number(event.target.value || new Date().getFullYear()); render(); });
    $("expenseForm")?.addEventListener("submit", (event) => { event.preventDefault(); handleLaunch(event.currentTarget, "expense", "expenseMsg"); });
    $("incomeForm")?.addEventListener("submit", (event) => { event.preventDefault(); handleLaunch(event.currentTarget, "income", "incomeMsg"); });
    $("cardTxForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); setMessage("cardTxMsg", "Salvando...");
      try { await saveCardLaunch(formObject(event.currentTarget)); await load(); setMessage("cardTxMsg", "Compra lançada."); render(); }
      catch (error) { setMessage("cardTxMsg", error.message || String(error), true); }
    });
    $("transferForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); setMessage("transferMsg", "Salvando...");
      try { await saveTransfer(formObject(event.currentTarget)); await load(); render(); }
      catch (error) { setMessage("transferMsg", error.message || String(error), true); }
    });
    $("editTxForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const item = tx().find((row) => row.id === S.edit.transactions); if (!item) return;
      const values = formObject(event.currentTarget); const data = { ...item, description: values.description.trim(), amountCents: parseMoney(values.amount), date: values.date, dueDate: values.dueDate, categoryId: values.categoryId, status: values.status, counterparty: values.counterparty, accountId: values.accountId || "", notes: values.notes || "" };
      delete data.id; delete data._updatedAt;
      try { await save("transactions", data, item.id); S.edit.transactions = null; await load(); render(); }
      catch (error) { setMessage("editTxMsg", error.message || String(error), true); }
    });
    $("importForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget, values = formObject(form); setMessage("importMsg", "Importando...");
      try { const count = await importInvoice(values.cardId, values.dueDate, form.elements.file.files[0]); await load(); setMessage("importMsg", `${count} item(ns) importado(s).`); render(); }
      catch (error) { setMessage("importMsg", error.message || String(error), true); }
    });
    $("accountForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const values = formObject(event.currentTarget);
      await save("accounts", { name: values.name.trim(), institution: values.institution.trim(), type: values.type, openingBalanceCents: parseMoney(values.openingBalance), active: values.active !== "false" }, S.edit.accounts); S.edit.accounts = null; await load(); render();
    });
    $("cardForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const values = formObject(event.currentTarget); const closingDay = Number(values.closingDay), dueDay = Number(values.dueDay);
      if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) return alert("Informe fechamento e vencimento válidos.");
      await save("cards", { name: values.name.trim(), institution: values.institution.trim(), brand: values.brand, last4: String(values.last4 || "").replace(/\D/g, "").slice(-4), accountId: values.accountId || "", limitCents: parseMoney(values.limit), closingDay, dueDay, areaCategoryId: values.areaCategoryId || "", active: values.active !== "false" }, S.edit.cards); S.edit.cards = null; await load(); render();
    });
    $("investmentForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const values = formObject(event.currentTarget); await save("investments", { type: values.type, name: values.name.trim(), institution: values.institution.trim(), ticker: values.ticker.trim(), quantity: Number(values.quantity || 0), averagePriceCents: parseMoney(values.averagePrice), currentPriceCents: parseMoney(values.currentPrice), date: values.date }, S.edit.investments); S.edit.investments = null; await load(); render();
    });
    $("settingsForm")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const values = formObject(event.currentTarget); const data = { ...S.settings, profileName: values.profileName.trim() || "Meu financeiro", openingBalanceCents: parseMoney(values.openingBalance), averageMonthlyIncomeCents: parseMoney(values.averageMonthlyIncome), emergencyReserveGoalCents: parseMoney(values.emergencyReserveGoal), defaultAccountId: values.defaultAccountId || "", referenceModel: "Finança Simples - Essencial 2025" }; await save("settings", data, S.data.settings[0]?.id || null); await load(); setMessage("settingsMsg", "Parâmetros salvos."); render();
    });
    $("categoryForm")?.addEventListener("submit", async (event) => { event.preventDefault(); const values = formObject(event.currentTarget); await save("categories", { kind: values.kind, name: values.name.trim(), active: true, source: "custom" }); await load(); render(); });
  }

  function exportTransactions() {
    const rows = transactionRows();
    const header = ["Data", "Tipo", "Descrição", "Beneficiário/Pagador", "Categoria", "Conta/Cartão", "Parcela", "Status", "Valor"];
    const csv = [header, ...rows.map((item) => [effectiveDate(item), item.kind, item.description || "", item.counterparty || "", categoryName(item), originLabel(item), Number(item.installmentCount || 1) > 1 ? `${item.installmentNumber}/${item.installmentCount}` : "", item.status, (Number(item.amountCents || 0) / 100).toFixed(2).replace(".", ",")])].map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
    download(`financa-simples-${S.month}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  }

  async function actionClick(target) {
    const button = target.closest("button"); if (!button) return;
    if (button.dataset.page) { S.page = button.dataset.page; render(); return; }
    const action = button.dataset.action, type = button.dataset.type, id = button.dataset.id;
    if (!action) return;
    try {
      if (action === "cancel") { S.edit[type] = null; render(); }
      else if (action === "edit") { S.edit[type] = id; render(); }
      else if (action === "delete") {
        if (!confirm("Excluir este registro?")) return;
        if (type === "cards" && tx().some((item) => item.cardId === id)) return alert("Este cartão possui lançamentos. Edite/desative o cartão em vez de excluí-lo.");
        if (type === "categories" && tx().some((item) => item.categoryId === id)) return alert("Categoria em uso por lançamentos.");
        await remove(type, id); await load(); render();
      } else if (action === "settle") { await settleTransaction(id); await load(); render(); }
      else if (action === "payInvoice") {
        if (!confirm(`Marcar a fatura ${button.dataset.month} de ${cardName(button.dataset.cardId)} como paga?`)) return;
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
      S.runtime = await invoke("runtime_status");
      await load();
      render();
    } catch (error) {
      $("view").innerHTML = `<section class="fatal"><h2>Não foi possível iniciar o Finança Simples</h2><p>${esc(error.message || error)}</p></section>`;
    }
  }
  boot();
})();
