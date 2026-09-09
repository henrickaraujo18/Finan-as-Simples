(() => {
  const C = window.FSCore;
  if (!C) return;

  const {
    S, tx, cards, categories, invoiceGroups, categoryName, cardName,
    effectiveDate, isExpense, isIncome, isTransfer, isCardPayment, isCardPurchase,
    money, pct, nextMonth,
  } = C;

  const analyticsState = {
    start: `${new Date().getFullYear()}-01-01`,
    end: (() => {
      const d = new Date();
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 10);
    })(),
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const formatDate = (date) => {
    if (!date) return "—";
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR").format(new Date(y, m - 1, d));
  };

  const shortMonth = (month) => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" })
      .format(new Date(y, m - 1, 1)).replace(" de ", "/");
  };

  const inRange = (date, start, end) => Boolean(date && date >= start && date <= end);
  const sum = (rows) => rows.reduce((total, item) => total + Number(item.amountCents || 0), 0);

  function monthsBetween(startDate, endDate) {
    const [sy, sm] = startDate.slice(0, 7).split("-").map(Number);
    const [ey, em] = endDate.slice(0, 7).split("-").map(Number);
    const result = [];
    let y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
      result.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (result.length > 120) break;
    }
    return result;
  }

  function analyticsData(start, end) {
    const all = tx();
    const incomes = all.filter((item) => isIncome(item) && inRange(effectiveDate(item), start, end));
    const regularExpenses = all.filter((item) => isExpense(item) && !isCardPurchase(item) && inRange(effectiveDate(item), start, end));
    const cardPayments = all.filter((item) => isCardPayment(item) && inRange(item.date, start, end));
    const invoiceItems = all.filter((item) => isCardPurchase(item) && inRange(item.dueDate || effectiveDate(item), start, end));

    const incomePaid = sum(incomes.filter((item) => item.status === "paid"));
    const incomePending = sum(incomes.filter((item) => item.status !== "paid"));
    const expensePaid = sum(regularExpenses.filter((item) => item.status === "paid")) + sum(cardPayments);
    const regularPending = sum(regularExpenses.filter((item) => item.status !== "paid"));
    const invoicePending = sum(invoiceItems.filter((item) => item.status !== "paid"));
    const expensePending = regularPending + invoicePending;
    const invoiceTotal = sum(invoiceItems);

    const monthKeys = monthsBetween(start, end);
    const monthly = monthKeys.map((month) => {
      const inc = incomes.filter((item) => effectiveDate(item).slice(0, 7) === month && item.status === "paid");
      const exp = regularExpenses.filter((item) => effectiveDate(item).slice(0, 7) === month && item.status === "paid");
      const pay = cardPayments.filter((item) => String(item.date || "").slice(0, 7) === month);
      const inv = invoiceItems.filter((item) => String(item.dueDate || effectiveDate(item)).slice(0, 7) === month);
      return {
        month,
        income: sum(inc),
        expense: sum(exp) + sum(pay),
        invoices: sum(inv),
      };
    });

    const expenseMap = new Map();
    for (const item of regularExpenses.filter((item) => item.status === "paid")) {
      const name = categoryName(item);
      expenseMap.set(name, (expenseMap.get(name) || 0) + Number(item.amountCents || 0));
    }
    for (const item of cardPayments) {
      const name = item.category ? item.category : "Faturas 💳";
      expenseMap.set(name, (expenseMap.get(name) || 0) + Number(item.amountCents || 0));
    }

    const cardMap = new Map();
    for (const item of invoiceItems) {
      const name = cardName(item.cardId);
      cardMap.set(name, (cardMap.get(name) || 0) + Number(item.amountCents || 0));
    }

    const expenseComposition = [...expenseMap.entries()].sort((a, b) => b[1] - a[1]);
    const invoiceByCard = [...cardMap.entries()].sort((a, b) => b[1] - a[1]);

    const next = nextMonth(end.slice(0, 7));
    const nextRegularPending = all.filter((item) => isExpense(item) && !isCardPurchase(item) && item.status !== "paid" && effectiveDate(item).slice(0, 7) === next);
    const nextIncomePending = all.filter((item) => isIncome(item) && item.status !== "paid" && effectiveDate(item).slice(0, 7) === next);
    const nextInvoiceItems = all.filter((item) => isCardPurchase(item) && item.status !== "paid" && String(item.dueDate || effectiveDate(item)).slice(0, 7) === next);

    const nextRegular = sum(nextRegularPending);
    const nextInvoices = sum(nextInvoiceItems);
    const nextReceivables = sum(nextIncomePending);
    const nextCommitment = nextRegular + nextInvoices;
    const nextNet = nextReceivables - nextCommitment;

    const upcoming = [
      ...nextRegularPending.map((item) => ({
        date: effectiveDate(item),
        description: item.description,
        origin: "Conta a pagar",
        amountCents: Number(item.amountCents || 0),
      })),
      ...invoiceGroups().filter((group) => group.invoiceMonth === next && group.pendingCents > 0).map((group) => ({
        date: group.items.find((item) => item.dueDate)?.dueDate || `${next}-01`,
        description: `Fatura ${cardName(group.cardId)}`,
        origin: "Cartão",
        amountCents: Number(group.pendingCents || 0),
      })),
      ...nextIncomePending.map((item) => ({
        date: effectiveDate(item),
        description: item.description,
        origin: "A receber",
        amountCents: -Number(item.amountCents || 0),
      })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 12);

    return {
      incomes,
      regularExpenses,
      cardPayments,
      invoiceItems,
      incomePaid,
      incomePending,
      expensePaid,
      expensePending,
      invoiceTotal,
      resultPaid: incomePaid - expensePaid,
      forecastResult: incomePaid + incomePending - expensePaid - expensePending,
      monthly,
      expenseComposition,
      invoiceByCard,
      next,
      nextRegular,
      nextInvoices,
      nextReceivables,
      nextCommitment,
      nextNet,
      upcoming,
    };
  }

  function kpi(label, value, hint = "", tone = "") {
    return `<article class="kpi analytics-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
  }

  function groupedBars(series) {
    const max = Math.max(1, ...series.flatMap((item) => [item.income, item.expense, item.invoices]));
    const width = Math.max(760, series.length * 86);
    return `<div class="chart-scroll"><div class="volume-chart" style="min-width:${width}px">
      <div class="chart-legend"><span><i class="legend-dot income-dot"></i>Entradas realizadas</span><span><i class="legend-dot expense-dot"></i>Saídas realizadas</span><span><i class="legend-dot invoice-dot"></i>Faturas</span></div>
      <div class="volume-bars">${series.map((item) => {
        const hi = Math.max(2, item.income / max * 100);
        const he = Math.max(2, item.expense / max * 100);
        const hf = Math.max(2, item.invoices / max * 100);
        return `<div class="volume-group"><div class="volume-column"><span class="bar-value">${esc(money(item.income))}</span><div class="chart-bar income-bar" style="height:${hi}%"></div></div><div class="volume-column"><span class="bar-value">${esc(money(item.expense))}</span><div class="chart-bar expense-bar" style="height:${he}%"></div></div><div class="volume-column"><span class="bar-value">${esc(money(item.invoices))}</span><div class="chart-bar invoice-bar" style="height:${hf}%"></div></div><strong>${esc(shortMonth(item.month))}</strong></div>`;
      }).join("")}</div>
    </div></div>`;
  }

  function horizontalBars(entries, emptyText = "Sem dados no período.") {
    const total = entries.reduce((s, [, value]) => s + Number(value || 0), 0);
    if (!entries.length || total <= 0) return `<div class="empty analytics-empty">${esc(emptyText)}</div>`;
    const max = Math.max(...entries.map(([, value]) => Number(value || 0)), 1);
    return `<div class="hbar-list">${entries.slice(0, 10).map(([name, value]) => `<div class="hbar-row"><div class="hbar-meta"><strong>${esc(name)}</strong><span>${esc(money(value))} · ${esc(pct(value / total * 100))}</span></div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(3, value / max * 100)}%"></div></div></div>`).join("")}</div>`;
  }

  function nextMonthComposition(data) {
    const scale = Math.max(data.nextRegular, data.nextInvoices, data.nextReceivables, 1);
    const bar = (label, value, kind) => `<div class="commit-row"><div><strong>${esc(label)}</strong><span>${esc(money(value))}</span></div><div class="commit-track"><div class="commit-fill ${kind}" style="width:${Math.max(3, value / scale * 100)}%"></div></div></div>`;
    return `<div class="next-month-grid">
      <div class="next-month-summary">
        ${bar("Contas a pagar", data.nextRegular, "expense-fill")}
        ${bar("Faturas", data.nextInvoices, "invoice-fill")}
        ${bar("Entradas previstas", data.nextReceivables, "income-fill")}
      </div>
      <div class="next-month-result ${data.nextNet >= 0 ? "positive" : "negative"}">
        <span>Saldo projetado do mês</span>
        <strong>${esc(money(data.nextNet))}</strong>
        <small>${data.nextNet >= 0 ? "Entradas previstas cobrem os compromissos cadastrados." : "Há compromissos acima das entradas previstas; vale revisar o caixa."}</small>
      </div>
    </div>`;
  }

  function insightCards(data) {
    const savingsRate = data.incomePaid > 0 ? data.resultPaid / data.incomePaid * 100 : 0;
    const coverage = data.nextCommitment > 0 ? data.nextReceivables / data.nextCommitment * 100 : 0;
    const invoiceShare = data.expensePaid > 0 ? data.invoiceTotal / data.expensePaid * 100 : 0;
    return `<div class="insight-grid">
      <article class="insight-card"><span>Margem do período</span><strong>${esc(pct(savingsRate))}</strong><small>${savingsRate >= 20 ? "Boa capacidade de geração de caixa." : savingsRate >= 0 ? "Resultado positivo, com espaço para ampliar a reserva." : "Saídas realizadas superaram as entradas."}</small></article>
      <article class="insight-card"><span>Cobertura do próximo mês</span><strong>${esc(pct(coverage))}</strong><small>${coverage >= 100 ? "Entradas previstas cobrem os compromissos cadastrados." : "Parte dos compromissos ainda depende do saldo em caixa."}</small></article>
      <article class="insight-card"><span>Peso das faturas</span><strong>${esc(pct(invoiceShare))}</strong><small>${invoiceShare > 50 ? "Cartões representam parcela relevante do fluxo financeiro." : "Faturas estão sob participação moderada no período."}</small></article>
    </div>`;
  }

  function dashboardAnalytics(force = false) {
    const view = $("view");
    if (!view || S.page !== "annual") return;

    const start = analyticsState.start;
    const end = analyticsState.end;
    const latest = tx().reduce((max, item) => String(item._updatedAt || item.date || "") > max ? String(item._updatedAt || item.date || "") : max, "");
    const signature = `${start}|${end}|${tx().length}|${latest}`;
    if (!force && view.dataset.proDashboard === signature) return;

    const data = analyticsData(start, end);
    const transactionsCount = data.incomes.length + data.regularExpenses.length + data.cardPayments.length;
    const invoiceCount = data.invoiceItems.length;
    const avgIncome = data.incomes.filter((item) => item.status === "paid").length ? data.incomePaid / data.incomes.filter((item) => item.status === "paid").length : 0;
    const avgExpenseCount = data.regularExpenses.filter((item) => item.status === "paid").length + data.cardPayments.length;
    const avgExpense = avgExpenseCount ? data.expensePaid / avgExpenseCount : 0;

    view.dataset.proDashboard = signature;
    view.innerHTML = `<section class="analytics-hero">
      <div>
        <span class="eyebrow">Inteligência financeira</span>
        <h2>Dashboard Analítico</h2>
        <p>Consolide resultados, compromissos e tendências em um único painel para apoiar decisões financeiras com mais antecedência.</p>
      </div>
      <div class="analytics-period-label"><span>Período analisado</span><strong>${esc(formatDate(start))} — ${esc(formatDate(end))}</strong></div>
    </section>

    <section class="panel analytics-filter"><div class="filter-grid">
      <label>Data inicial<input id="analysisStart" type="date" value="${esc(start)}"></label>
      <label>Data final<input id="analysisEnd" type="date" value="${esc(end)}"></label>
      <button class="ghost quick-range" data-range="month">Mês atual</button>
      <button class="ghost quick-range" data-range="quarter">Últimos 3 meses</button>
      <button class="ghost quick-range" data-range="year">Ano atual</button>
    </div></section>

    <section class="kpi-grid analytics-kpis">
      ${kpi("Entradas realizadas", money(data.incomePaid), `${data.incomes.filter((item) => item.status === "paid").length} lançamento(s) · ticket médio ${money(avgIncome)}`, "positive")}
      ${kpi("Saídas realizadas", money(data.expensePaid), `${avgExpenseCount} lançamento(s) · ticket médio ${money(avgExpense)}`, "negative")}
      ${kpi("Faturas do período", money(data.invoiceTotal), `${invoiceCount} compra(s) alocada(s) em faturas`, "invoice")}
      ${kpi("Resultado realizado", money(data.resultPaid), `previsto ${money(data.forecastResult)}`, data.resultPaid >= 0 ? "positive" : "negative")}
      ${kpi("A receber", money(data.incomePending), "receitas ainda não realizadas")}
      ${kpi("A pagar", money(data.expensePending), "contas e faturas pendentes")}
      ${kpi("Movimentos", String(transactionsCount), "volume de registros financeiros")}
      ${kpi("Próximo mês", money(data.nextCommitment), `${money(data.nextReceivables)} previstos de entrada`, "invoice")}
    </section>

    ${insightCards(data)}

    <section class="panel analytics-panel"><div class="panel-head"><div><h3>Volumetria financeira</h3><small>Entradas, saídas realizadas e faturas distribuídas ao longo do período selecionado.</small></div></div><div class="panel-body">${groupedBars(data.monthly)}</div></section>

    <div class="two-col analytics-two-col">
      <section class="panel analytics-panel"><div class="panel-head"><div><h3>Composição das saídas</h3><small>Participação das categorias no caixa realizado.</small></div></div><div class="panel-body">${horizontalBars(data.expenseComposition, "Ainda não há saídas realizadas no período.")}</div></section>
      <section class="panel analytics-panel"><div class="panel-head"><div><h3>Faturas por cartão</h3><small>Distribuição do valor faturado entre os cartões cadastrados.</small></div></div><div class="panel-body">${horizontalBars(data.invoiceByCard, "Nenhuma fatura encontrada no período.")}</div></section>
    </div>

    <section class="panel analytics-panel"><div class="panel-head"><div><h3>Composição do próximo mês</h3><small>${esc(shortMonth(data.next))} · compromissos e entradas já conhecidos.</small></div></div><div class="panel-body">${nextMonthComposition(data)}</div></section>

    <section class="panel analytics-panel"><div class="panel-head"><div><h3>Agenda financeira do próximo mês</h3><small>Itens cadastrados que merecem acompanhamento antes do vencimento.</small></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th class="right">Impacto</th></tr></thead><tbody>${data.upcoming.length ? data.upcoming.map((item) => `<tr><td>${esc(formatDate(item.date))}</td><td>${esc(item.description || "—")}</td><td>${esc(item.origin)}</td><td class="right ${item.amountCents < 0 ? "income" : "expense"}">${item.amountCents < 0 ? "+" : "−"}${esc(money(Math.abs(item.amountCents)))}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">Nenhum compromisso cadastrado para o próximo mês.</td></tr>`}</tbody></table></div></section>`;

    const pageTitle = $("pageTitle");
    if (pageTitle) pageTitle.textContent = "Dashboard Analítico";

    $("analysisStart")?.addEventListener("change", (event) => {
      if (!event.target.value) return;
      analyticsState.start = event.target.value;
      if (analyticsState.start > analyticsState.end) analyticsState.end = analyticsState.start;
      dashboardAnalytics(true);
    });
    $("analysisEnd")?.addEventListener("change", (event) => {
      if (!event.target.value) return;
      analyticsState.end = event.target.value;
      if (analyticsState.end < analyticsState.start) analyticsState.start = analyticsState.end;
      dashboardAnalytics(true);
    });
    view.querySelectorAll(".quick-range").forEach((button) => button.addEventListener("click", () => {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      const endDate = local.toISOString().slice(0, 10);
      let startDate = endDate;
      if (button.dataset.range === "month") startDate = `${endDate.slice(0, 7)}-01`;
      if (button.dataset.range === "quarter") {
        const d = new Date(local.getFullYear(), local.getMonth() - 2, 1, 12, 0, 0);
        startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      }
      if (button.dataset.range === "year") startDate = `${local.getFullYear()}-01-01`;
      analyticsState.start = startDate;
      analyticsState.end = endDate;
      dashboardAnalytics(true);
    }));
  }

  function removeReferenceColumn() {
    document.querySelectorAll("section.panel").forEach((panel) => {
      const heading = panel.querySelector("h3");
      if (!heading || heading.textContent.trim() !== "Categorias") return;
      const table = panel.querySelector("table");
      if (!table) return;
      const headers = [...table.querySelectorAll("thead th")];
      const index = headers.findIndex((th) => th.textContent.trim() === "Origem");
      if (index < 0) return;
      table.querySelectorAll("tr").forEach((row) => {
        const cells = row.children;
        if (cells[index]) cells[index].remove();
      });
    });
  }

  function cleanProductCopy() {
    const replacements = [
      ["Visão de ", "Visão financeira de "],
      [" baseada no modelo Finança Simples - Essencial 2025.", "."],
      ["Equivale ao lançador de saídas da planilha.", "Registre despesas à vista, pendentes ou parceladas."],
      ["Equivale ao lançador de entradas da planilha.", "Registre receitas recebidas, previstas ou parceladas."],
      ["Lançador próprio, como na planilha Essencial 2025.", "Registre compras e parcelas vinculadas ao ciclo do cartão."],
      ["Três lançadores principais reproduzem o fluxo da planilha: saída, entrada e cartão. Parcelas estão disponíveis nos três.", "Centralize saídas, entradas e compras no cartão, com controle de parcelas e vencimentos."],
      ["Os bancos são cadastros auxiliares como no MENU da planilha; não são obrigatórios nos lançamentos. Cartões usam fechamento, vencimento e Área.", "Gerencie contas, dinheiro e cartões em um único lugar. O vínculo bancário nos lançamentos é opcional."],
      ["Cadastre os cartões usados na planilha.", "Cadastre seus cartões para acompanhar faturas, parcelas e limites."],
      ["Investimentos são um módulo do Finança Simples, mas ficam separados dos indicadores centrais da planilha Essencial.", "Acompanhe a posição dos seus investimentos separadamente do fluxo financeiro operacional."],
      ["Organizada conforme o MENU da planilha: saldo inicial, renda média, categorias, cartões e bancos.", "Centralize parâmetros financeiros, categorias, contas, cartões e preferências do sistema."],
      ["As categorias originais da planilha são preservadas; você também pode adicionar outras.", "Gerencie as categorias utilizadas nos lançamentos e crie novas classificações quando necessário."],
    ];

    const selectors = ".hero p,.panel-head small,.panel-body p,.muted,.notice span";
    document.querySelectorAll(selectors).forEach((node) => {
      let text = node.textContent;
      for (const [from, to] of replacements) text = text.replace(from, to);
      if (text !== node.textContent) node.textContent = text;
    });

    document.querySelectorAll(".tag").forEach((node) => {
      if (/Essencial 2025/i.test(node.textContent)) node.remove();
    });

    document.querySelectorAll(".report-lines > div").forEach((row) => {
      if (/Modelo de referência/i.test(row.textContent)) row.remove();
    });

    removeReferenceColumn();
  }

  function updateNavigationLabel() {
    const annualButton = document.querySelector('.nav button[data-page="annual"] span');
    if (annualButton) annualButton.textContent = "Dashboard Analítico";
  }

  function enhance() {
    updateNavigationLabel();
    cleanProductCopy();
    if (S.page === "annual") dashboardAnalytics();
  }

  function startSplash() {
    const splash = $("startupSplash");
    if (!splash) return;
    document.body.classList.add("splash-active");
    window.setTimeout(() => {
      splash.classList.add("splash-leaving");
      document.body.classList.remove("splash-active");
      window.setTimeout(() => splash.remove(), 450);
    }, 5000);
  }

  let scheduled = false;
  const scheduleEnhance = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  };

  document.addEventListener("click", () => setTimeout(scheduleEnhance, 0));
  window.addEventListener("online", () => setTimeout(scheduleEnhance, 0));
  window.addEventListener("offline", () => setTimeout(scheduleEnhance, 0));

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, { childList: true, subtree: true });

  startSplash();
  scheduleEnhance();
})();
