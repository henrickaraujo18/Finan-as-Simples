(() => {
  const C = window.FSCore;
  if (!C) return;

  const {
    S, INVESTMENT_TYPES, money, pct, parseMoney, inputMoney, today,
    save, bulkSave, remove, load, investments, investmentGoals, marketData,
    openFinanceConnections, openFinanceAccounts, openFinanceBills,
    monthMetrics, investmentMetrics, totalCashBalance,
  } = C;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const formObject = (form) => Object.fromEntries(new FormData(form).entries());
  const state = {
    workspaceKey: null,
    investmentTab: "portfolio",
    investmentEdit: "",
    goalEdit: "",
    marketBusy: false,
    marketAttemptedWorkspace: "",
    openFinanceBusy: "",
    openFinanceConfigured: null,
    openFinanceStatusWorkspace: "",
    message: "",
    messageError: false,
    messagePage: "",
  };

  const cloud = () => window.FSCloudRuntime;
  const workspaceId = () => window.FSAuth?.workspaceId?.() || $("workspaceSelector")?.value || "";
  const can = (module, action) => !window.FSAuth || window.FSAuth.can(module, action);
  function workspaceOperation() {
    const id = workspaceId();
    const release = window.FSAuth?.lockWorkspace?.() || (() => {});
    return { id, release, assertCurrent() { if (workspaceId() !== id) throw new Error("O ambiente foi alterado. Refaça a operação no ambiente correto."); } };
  }
  const canUseCloud = () => Boolean(navigator.onLine && cloud()?.isAuthenticated?.() && workspaceId());
  const latest = (rows) => rows.reduce((max, item) => String(item._updatedAt || item.syncedAt || "") > max ? String(item._updatedAt || item.syncedAt || "") : max, "");
  const dateLabel = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
  const timeLabel = (value) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não sincronizado";
  const setMessage = (text, error = false) => { state.message = text; state.messageError = error; state.messagePage = S.page; };
  const messageBox = () => state.message && state.messagePage === S.page ? `<div class="advanced-message ${state.messageError ? "error" : ""}">${esc(state.message)}</div>` : "";

  function friendlyCloudError(error) {
    const code = String(error?.code || error?.message || error || "");
    if (code.includes("provider_not_configured")) return "A integração está pronta, mas as credenciais da Pluggy ainda não foram cadastradas no servidor.";
    if (code.includes("forbidden")) return "Seu usuário não possui permissão para esta operação neste ambiente.";
    if (code.includes("no_session") || code.includes("Sessão online")) return "Entre com a conta online para usar este recurso.";
    if (code.includes("Failed to fetch") || code.includes("NetworkError")) return "Não foi possível acessar o serviço. Verifique a internet e tente novamente.";
    return error?.message || code || "Não foi possível concluir a operação.";
  }

  function investmentSummary() {
    const base = investmentMetrics();
    const liquid = investments().filter((item) => item.liquidityDays != null && item.liquidityDays !== "" && Number(item.liquidityDays) <= 1)
      .reduce((sum, item) => sum + Math.round(Number(item.quantity || 0) * Number(item.currentPriceCents || 0)), 0);
    return { ...base, liquidShare: base.current ? liquid / base.current * 100 : 0 };
  }

  function marketCards() {
    const order = ["dollar", "selic", "ipca"];
    const byKey = new Map(marketData().map((item) => [item.key, item]));
    const fallback = {
      dollar: { label: "Dólar comercial (venda)", suffix: "R$" },
      selic: { label: "Meta Selic", suffix: "% a.a." },
      ipca: { label: "IPCA mensal", suffix: "% a.m." },
    };
    return `<section class="panel market-panel"><div class="panel-head"><div><h3>Indicadores oficiais</h3><small>Atualizados no servidor a partir do Banco Central do Brasil; a última leitura fica disponível offline.</small></div><button class="ghost" data-v17-action="refresh-market" ${state.marketBusy || !canUseCloud() || !can("investments", "create") || !can("investments", "edit") ? "disabled" : ""}>${state.marketBusy ? "Atualizando..." : "Atualizar"}</button></div><div class="market-grid">${order.map((key) => {
      const item = byKey.get(key);
      const meta = item || fallback[key];
      const value = item ? (key === "dollar" ? `R$ ${Number(item.value || 0).toFixed(4).replace(".", ",")}` : `${Number(item.value || 0).toFixed(2).replace(".", ",")}%`) : "—";
      return `<article class="market-card"><span>${esc(meta.label)}</span><strong>${esc(value)}</strong><small>${item ? `${esc(item.referenceDate || "")} · ${item.stale || !navigator.onLine ? "último valor salvo" : "BCB"}` : "Aguardando primeira atualização"}</small></article>`;
    }).join("")}</div></section>`;
  }

  function investmentForm() {
    const item = state.investmentEdit ? investments().find((row) => row.id === state.investmentEdit) : null;
    return `<section class="panel"><div class="panel-head"><div><h3>${item ? "Editar posição" : "Nova posição"}</h3><small>Valores manuais da sua carteira; nenhum ativo é comprado pelo aplicativo.</small></div>${item ? `<button class="ghost" data-v17-action="cancel-investment">Cancelar</button>` : ""}</div><form id="investmentV17Form" data-editing="${Boolean(item)}" class="form panel-body"><div class="form-grid">
      <label>Tipo<select name="type">${INVESTMENT_TYPES.map((type) => `<option ${item?.type === type ? "selected" : ""}>${esc(type)}</option>`).join("")}</select></label>
      <label>Ativo / nome*<input name="name" required maxlength="120" value="${esc(item?.name || "")}"></label>
      <label>Instituição<input name="institution" maxlength="120" value="${esc(item?.institution || "")}"></label>
      <label>Código / ticker<input name="ticker" maxlength="24" value="${esc(item?.ticker || "")}"></label>
      <label>Quantidade<input name="quantity" type="number" min="0" step="0.00000001" value="${item?.quantity ?? 1}"></label>
      <label>Preço médio<input name="averagePrice" inputmode="decimal" value="${item ? inputMoney(item.averagePriceCents) : ""}" placeholder="0,00"></label>
      <label>Preço atual<input name="currentPrice" inputmode="decimal" value="${item ? inputMoney(item.currentPriceCents) : ""}" placeholder="0,00"></label>
      <label>Liquidez (dias)<input name="liquidityDays" type="number" min="0" max="36500" value="${item?.liquidityDays ?? ""}" placeholder="Não informada"></label>
      <label>Taxa anual estimada (%)<input name="annualRate" inputmode="decimal" value="${item?.annualRateBps ? (Number(item.annualRateBps) / 100).toFixed(2).replace(".", ",") : ""}" placeholder="0,00"></label>
      <label>Vencimento<input name="maturityDate" type="date" value="${esc(item?.maturityDate || "")}"></label>
    </div><div class="button-row"><button class="primary">Salvar posição</button></div></form></section>`;
  }

  function investmentTable() {
    const rows = [...investments()].sort((a, b) => Number(b.currentPriceCents || 0) * Number(b.quantity || 0) - Number(a.currentPriceCents || 0) * Number(a.quantity || 0));
    return `<section class="panel"><div class="panel-head"><div><h3>Carteira</h3><small>Posição consolidada por ativo.</small></div></div><div class="table-wrap"><table><thead><tr><th>Ativo</th><th>Tipo</th><th>Instituição</th><th>Liquidez</th><th class="right">Custo</th><th class="right">Atual</th><th class="right">Resultado</th><th></th></tr></thead><tbody>${rows.length ? rows.map((item) => {
      const cost = Math.round(Number(item.quantity || 0) * Number(item.averagePriceCents || 0));
      const current = Math.round(Number(item.quantity || 0) * Number(item.currentPriceCents || 0));
      const gain = current - cost;
      return `<tr><td><strong>${esc(item.name)}</strong>${item.ticker ? `<small class="table-sub">${esc(item.ticker)}</small>` : ""}</td><td>${esc(item.type || "Outro")}</td><td>${esc(item.institution || "—")}</td><td>${item.liquidityDays == null || item.liquidityDays === "" ? "Não informada" : Number(item.liquidityDays) <= 1 ? "Diária" : `${Number(item.liquidityDays)} dias`}</td><td class="right">${esc(money(cost))}</td><td class="right">${esc(money(current))}</td><td class="right ${gain >= 0 ? "income" : "expense"}">${gain >= 0 ? "+" : "−"}${esc(money(Math.abs(gain)))}</td><td class="actions-cell"><button class="ghost compact" data-v17-action="edit-investment" data-id="${esc(item.id)}">Editar</button><button class="ghost compact danger" data-v17-action="delete-investment" data-id="${esc(item.id)}">Excluir</button></td></tr>`;
    }).join("") : `<tr><td colspan="8" class="empty">Nenhuma posição cadastrada.</td></tr>`}</tbody></table></div></section>`;
  }

  function goalsPanel() {
    const editing = state.goalEdit ? investmentGoals().find((row) => row.id === state.goalEdit) : null;
    const rows = [...investmentGoals()].sort((a, b) => String(a.targetDate || "9999").localeCompare(String(b.targetDate || "9999")));
    return `<div class="two-col goal-layout"><section class="panel"><div class="panel-head"><div><h3>${editing ? "Editar meta" : "Nova meta financeira"}</h3><small>Acompanhe reserva, entrada, viagem ou outro objetivo.</small></div>${editing ? `<button class="ghost" data-v17-action="cancel-goal">Cancelar</button>` : ""}</div><form id="goalV17Form" data-editing="${Boolean(editing)}" class="form panel-body"><div class="form-grid"><label class="wide">Nome da meta*<input name="name" required maxlength="120" value="${esc(editing?.name || "")}"></label><label>Valor-alvo<input name="target" required inputmode="decimal" value="${editing ? inputMoney(editing.targetCents) : ""}" placeholder="0,00"></label><label>Valor acumulado<input name="current" inputmode="decimal" value="${editing ? inputMoney(editing.currentCents) : ""}" placeholder="0,00"></label><label class="wide">Prazo<input name="targetDate" type="date" required value="${esc(editing?.targetDate || "")}"></label></div><button class="primary">Salvar meta</button></form></section><section class="panel"><div class="panel-head"><div><h3>Metas</h3><small>Progresso dos objetivos cadastrados.</small></div></div><div class="goals-list">${rows.length ? rows.map((goal) => {
      const progress = Number(goal.targetCents || 0) ? Math.min(100, Number(goal.currentCents || 0) / Number(goal.targetCents) * 100) : 0;
      return `<article class="goal-card"><div><strong>${esc(goal.name)}</strong><span>${esc(money(goal.currentCents))} de ${esc(money(goal.targetCents))}</span></div><div class="goal-progress"><i style="width:${progress}%"></i></div><div><small>${esc(pct(progress))} · prazo ${esc(dateLabel(goal.targetDate))}</small><span><button class="ghost compact" data-v17-action="edit-goal" data-id="${esc(goal.id)}">Editar</button><button class="ghost compact danger" data-v17-action="delete-goal" data-id="${esc(goal.id)}">Excluir</button></span></div></article>`;
    }).join("") : `<div class="empty">Nenhuma meta cadastrada.</div>`}</div></section></div>`;
  }

  const plans = {
    conservative: [["Reserva em Tesouro Selic/CDB diário", 60], ["CDB, LCI e LCA com prazos escalonados", 30], ["Fundos/ETFs amplos de baixa exposição", 10]],
    balanced: [["Reserva em Tesouro Selic/CDB diário", 40], ["CDB, LCI e LCA com prazos escalonados", 30], ["ETFs e ações diversificadas", 20], ["Proteção cambial/internacional", 10]],
    growth: [["Reserva em Tesouro Selic/CDB diário", 25], ["Renda fixa de médio prazo", 20], ["ETFs e ações diversificadas", 40], ["Proteção cambial/internacional", 15]],
  };

  function advisorInsights() {
    const summary = investmentSummary();
    const monthly = monthMetrics(S.month);
    const rows = [];
    if (!investments().length) rows.push(["attention", "Carteira ainda vazia", "Cadastre seus investimentos para que a análise use valores, liquidez e vencimentos reais."]);
    else if (summary.liquidShare < 25) rows.push(["critical", "Liquidez baixa", `Apenas ${pct(summary.liquidShare)} da carteira possui liquidez em até um dia. Fortaleça a reserva antes de aumentar posições longas.`]);
    else rows.push(["good", "Liquidez acompanhada", `${pct(summary.liquidShare)} da carteira pode ser resgatada em até um dia.`]);
    const averageIncome = Number(S.settings.averageMonthlyIncomeCents || 0);
    if (averageIncome && monthly.expensePaid > averageIncome) rows.push(["critical", "Saídas acima da renda média", `As saídas realizadas superaram a renda média cadastrada em ${pct((monthly.expensePaid / averageIncome - 1) * 100)}.`]);
    else if (averageIncome && monthly.expensePaid > averageIncome * .8) rows.push(["attention", "Renda quase comprometida", `${pct(monthly.expensePaid / averageIncome * 100)} da renda média já foi consumida pelas saídas realizadas.`]);
    const reserveGoal = Number(S.settings.emergencyReserveGoalCents || 0);
    if (reserveGoal && totalCashBalance() < reserveGoal) rows.push(["attention", "Reserva em construção", `Faltam ${money(Math.max(0, reserveGoal - totalCashBalance()))} para a meta de reserva configurada.`]);
    const selic = marketData().find((item) => item.key === "selic");
    if (Number(selic?.value || 0) >= 10) rows.push(["good", "Renda fixa em destaque", `Com a Selic em ${Number(selic.value).toFixed(2).replace(".", ",")}% a.a., compare liquidez, vencimento, risco e rendimento líquido.`]);
    for (const goal of investmentGoals()) {
      const progress = Number(goal.targetCents || 0) ? Number(goal.currentCents || 0) / Number(goal.targetCents) : 0;
      const days = Math.ceil((new Date(`${goal.targetDate}T12:00:00`).getTime() - Date.now()) / 86400000);
      if (days < 0 && progress < 1) rows.push(["critical", `Meta não atingida: ${goal.name}`, `O prazo terminou com ${pct(progress * 100)} do valor acumulado.`]);
      else if (days <= 90 && progress < .75) rows.push(["attention", `Meta exige atenção: ${goal.name}`, `Faltam ${Math.max(0, days)} dias e ${pct(progress * 100)} do objetivo foi acumulado.`]);
    }
    if (!rows.length) rows.push(["good", "Organização em dia", "Os dados cadastrados não indicam um alerta imediato. Continue atualizando lançamentos, carteira e metas."]);
    return rows;
  }

  function advisorPanel() {
    const profile = ["conservative", "balanced", "growth"].includes(S.settings.riskProfile) ? S.settings.riskProfile : "balanced";
    const profileLabel = { conservative: "conservador", balanced: "equilibrado", growth: "crescimento" }[profile];
    return `<div class="advisor-grid"><section class="panel aurora-panel"><div class="panel-head"><div><span class="eyebrow">Aurora</span><h3>Agente financeiro digital</h3><small>Análise automatizada do orçamento, da carteira e das metas.</small></div></div><div class="advisor-list">${advisorInsights().map(([level, title, text]) => `<article class="advisor-alert ${level}"><i></i><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></article>`).join("")}<p class="legal-note">Aurora usa regras financeiras e os dados cadastrados. Não executa operações, não possui certificação profissional e não substitui suitability ou orientação de assessor autorizado.</p></div></section><section class="panel"><div class="panel-head"><div><h3>Carteira de referência</h3><small>Distribuição educativa para o perfil ${esc(profileLabel)}.</small></div></div><div class="panel-body"><form id="riskProfileForm" class="form"><label>Perfil<select name="riskProfile"><option value="conservative" ${profile === "conservative" ? "selected" : ""}>Conservador</option><option value="balanced" ${profile === "balanced" ? "selected" : ""}>Equilibrado</option><option value="growth" ${profile === "growth" ? "selected" : ""}>Crescimento</option></select></label></form><div class="allocation-list">${plans[profile].map(([name, share]) => `<div><span><strong>${esc(name)}</strong><b>${share}%</b></span><i><em style="width:${share}%"></em></i></div>`).join("")}</div><p class="legal-note">Referência educativa, não recomendação individual de investimento.</p></div></section></div>`;
  }

  function simulatorsPanel() {
    const selic = Number(marketData().find((item) => item.key === "selic")?.value ?? 0);
    return `<section class="panel simulator-panel"><div class="panel-head"><div><h3>Simuladores financeiros</h3><small>Investimentos, empréstimos, financiamentos e consórcios. A taxa é uma hipótese editável, não uma previsão de retorno.</small></div></div><div class="simulator-grid panel-body"><form id="simulatorV17Form" class="form"><label>Simulação<select name="kind"><option value="investment">Investimento</option><option value="loan">Empréstimo</option><option value="financing">Financiamento</option><option value="consortium">Consórcio</option></select></label><label>Valor inicial / crédito<input name="principal" value="10.000,00" inputmode="decimal"></label><label>Aporte mensal / entrada<input name="monthly" value="500,00" inputmode="decimal"></label><label>Prazo (meses)<input name="months" type="number" min="1" max="1200" step="1" value="24"></label><label>Taxa efetiva anual (%)<input name="rate" value="${selic.toFixed(2).replace(".", ",")}" inputmode="decimal"></label><label class="sim-fee hidden">Taxa de administração total (%)<input name="fee" value="18,00" inputmode="decimal"></label></form><div id="simulatorV17Result" class="simulator-result"></div></div><p class="legal-note simulator-note">Estimativa matemática. Confirme CET, impostos, seguros, reajustes e condições contratuais antes de decidir.</p></section>`;
  }

  function renderInvestments(force = false) {
    if (S.page !== "investments") return;
    const view = $("view");
    if (!view) return;
    const signature = [workspaceId(), navigator.onLine, canUseCloud(), S.month, JSON.stringify(S.settings), state.investmentTab, state.investmentEdit, state.goalEdit, state.marketBusy, state.message, investments().length, investmentGoals().length, marketData().length, latest(investments()), latest(investmentGoals()), latest(marketData())].join("|");
    if (!force && view.dataset.advancedV17 === `investments:${signature}`) return;
    view.dataset.advancedV17 = `investments:${signature}`;
    const m = investmentSummary();
    view.innerHTML = `<section class="advanced-hero"><div><span class="eyebrow">Patrimônio</span><h2>Investimentos e planejamento</h2><p>Carteira, metas, indicadores oficiais, análises automatizadas e simuladores — separados do fluxo financeiro do dia a dia.</p></div><div class="hero-stat"><span>Patrimônio acompanhado</span><strong>${esc(money(m.current))}</strong></div></section>${messageBox()}<div class="advanced-tabs"><button class="${state.investmentTab === "portfolio" ? "active" : ""}" data-v17-tab="portfolio">Carteira</button><button class="${state.investmentTab === "advisor" ? "active" : ""}" data-v17-tab="advisor">Aurora · Agente</button><button class="${state.investmentTab === "simulators" ? "active" : ""}" data-v17-tab="simulators">Simuladores</button></div>${state.investmentTab === "portfolio" ? `${marketCards()}<section class="kpi-grid">${[["Total aplicado", m.cost], ["Valor atual", m.current], ["Resultado", m.gain]].map(([label, value]) => `<article class="kpi"><span>${label}</span><strong>${esc(money(value))}</strong></article>`).join("")}<article class="kpi"><span>Liquidez diária</span><strong>${esc(pct(m.liquidShare))}</strong><small>da carteira atual</small></article></section><div class="two-col investment-layout">${investmentForm()}<section class="panel"><div class="panel-head"><div><h3>Como preencher a posição</h3><small>Informações usadas pela carteira e pela Aurora.</small></div></div><div class="panel-body guidance-list"><p><strong>Quantidade × preço médio</strong><span>Forma o total aplicado.</span></p><p><strong>Quantidade × preço atual</strong><span>Forma o valor atual e o resultado.</span></p><p><strong>Liquidez</strong><span>Ajuda a avaliar a disponibilidade da reserva.</span></p><p><strong>Taxa e vencimento</strong><span>Servem como referência; o app não promete rentabilidade.</span></p></div></section></div>${investmentTable()}${goalsPanel()}` : state.investmentTab === "advisor" ? advisorPanel() : simulatorsPanel()}`;
    $("pageTitle").textContent = "Investimentos";
    bindInvestmentEvents();
    if (state.investmentTab === "simulators") updateSimulator();
    autoRefreshMarket();
  }

  async function reloadInvestments(message = "", error = false) {
    setMessage(message, error);
    await load();
    renderInvestments(true);
  }

  async function refreshMarket(manual = false) {
    if (!canUseCloud() || state.marketBusy || !can("investments", "create") || !can("investments", "edit")) {
      if (manual) { setMessage("Entre com a conta online para atualizar os indicadores.", true); renderInvestments(true); }
      return;
    }
    const operation = workspaceOperation();
    state.marketBusy = true; setMessage(manual ? "Consultando o Banco Central..." : "", false); renderInvestments(true);
    try {
      const result = await cloud().edge("market-data", { workspaceId: operation.id });
      operation.assertCurrent();
      const valid = (result.indicators || []).filter((item) => item.value != null && Number.isFinite(Number(item.value)));
      if (!valid.length) throw new Error("O Banco Central não retornou indicadores válidos. Os valores anteriores foram preservados.");
      for (const item of valid) {
        if (item.value == null) continue;
        const existing = marketData().find((row) => row.key === item.key);
        await save("market_data", { ...item, checkedAt: result.checkedAt, source: result.source }, existing?.id || null);
      }
      await reloadInvestments(valid.length === 3 ? "Indicadores oficiais atualizados." : `${valid.length} de 3 indicadores atualizados. Os demais mantêm a leitura anterior.`);
    } catch (error) {
      await reloadInvestments(friendlyCloudError(error), true);
    } finally {
      state.marketBusy = false;
      operation.release();
      renderInvestments(true);
    }
  }

  function autoRefreshMarket() {
    const id = workspaceId();
    if (!id || state.marketAttemptedWorkspace === id || !canUseCloud() || !can("investments", "create") || !can("investments", "edit")) return;
    const freshest = marketData().reduce((max, item) => Math.max(max, Date.parse(item.checkedAt || item._updatedAt || 0) || 0), 0);
    if (freshest && Date.now() - freshest < 20 * 60 * 60 * 1000) return;
    state.marketAttemptedWorkspace = id;
    queueMicrotask(() => refreshMarket(false));
  }

  async function saveSettingsPatch(patch) {
    const current = { ...S.settings, ...patch };
    const id = current.id || S.data.settings?.[0]?.id || null;
    delete current.id; delete current._updatedAt;
    await save("settings", current, id);
    await load();
  }

  function bindInvestmentEvents() {
    $("view")?.querySelectorAll("[data-v17-tab]").forEach((button) => button.addEventListener("click", () => { state.investmentTab = button.dataset.v17Tab; setMessage(""); renderInvestments(true); }));
    $("investmentV17Form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formObject(event.currentTarget);
      try {
        if (!can("investments", state.investmentEdit ? "edit" : "create")) throw new Error("Sem permissão para salvar posições.");
        if (!String(values.name || "").trim()) throw new Error("Informe o nome do ativo.");
        const quantity = Number(values.quantity);
        const currentPriceCents = String(values.currentPrice || "").trim() === "" ? parseMoney(values.averagePrice) : parseMoney(values.currentPrice);
        const liquidityDays = String(values.liquidityDays ?? "").trim() === "" ? null : Number(values.liquidityDays);
        const annualRateBps = Math.round(Number(String(values.annualRate || "0").replace(",", ".")) * 100);
        if (parseMoney(values.averagePrice) <= 0) throw new Error("Informe um preço médio maior que zero.");
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(Math.round(quantity * parseMoney(values.averagePrice)))) throw new Error("Informe uma quantidade válida maior que zero.");
        if (currentPriceCents < 0 || !Number.isSafeInteger(Math.round(quantity * currentPriceCents))) throw new Error("Informe um preço atual válido e não negativo.");
        if (liquidityDays !== null && (!Number.isInteger(liquidityDays) || liquidityDays < 0 || liquidityDays > 36500)) throw new Error("Informe a liquidez em dias inteiros ou deixe em branco.");
        if (!Number.isFinite(annualRateBps) || annualRateBps < 0 || annualRateBps > 100000) throw new Error("Informe uma taxa válida entre 0% e 1000%.");
        await save("investments", { type: values.type, name: String(values.name).trim(), institution: String(values.institution || "").trim(), ticker: String(values.ticker || "").trim().toUpperCase(), quantity, averagePriceCents: parseMoney(values.averagePrice), currentPriceCents, liquidityDays, annualRateBps, maturityDate: values.maturityDate || "", date: investments().find((row) => row.id === state.investmentEdit)?.date || today(), source: "manual" }, state.investmentEdit || null);
        state.investmentEdit = ""; await reloadInvestments("Posição salva com sucesso.");
      } catch (error) { setMessage(error.message || String(error), true); renderInvestments(true); }
    });
    $("goalV17Form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const values = formObject(event.currentTarget);
      try {
        if (!can("investments", state.goalEdit ? "edit" : "create")) throw new Error("Sem permissão para salvar metas.");
        if (!String(values.name || "").trim()) throw new Error("Informe o nome da meta.");
        const targetCents = parseMoney(values.target); if (targetCents <= 0) throw new Error("Informe um valor-alvo maior que zero.");
        await save("investment_goals", { name: String(values.name).trim(), targetCents, currentCents: Math.max(0, parseMoney(values.current)), targetDate: values.targetDate, createdAt: investmentGoals().find((row) => row.id === state.goalEdit)?.createdAt || new Date().toISOString() }, state.goalEdit || null);
        state.goalEdit = ""; await reloadInvestments("Meta salva com sucesso.");
      } catch (error) { setMessage(error.message || String(error), true); renderInvestments(true); }
    });
    $("riskProfileForm")?.addEventListener("change", async (event) => { try { await saveSettingsPatch({ riskProfile: event.target.value }); renderInvestments(true); } catch (error) { setMessage(error.message || String(error), true); renderInvestments(true); } });
    $("simulatorV17Form")?.addEventListener("input", updateSimulator);
    $("simulatorV17Form")?.addEventListener("change", updateSimulator);
    $("view")?.querySelectorAll("[data-v17-action]").forEach((button) => button.addEventListener("click", async () => {
      const action = button.dataset.v17Action; const id = button.dataset.id;
      if (action === "refresh-market") return refreshMarket(true);
      if (action === "cancel-investment") { state.investmentEdit = ""; return renderInvestments(true); }
      if (action === "cancel-goal") { state.goalEdit = ""; return renderInvestments(true); }
      if (action === "edit-investment") { state.investmentEdit = id; return renderInvestments(true); }
      if (action === "edit-goal") { state.goalEdit = id; return renderInvestments(true); }
      if (action === "delete-investment" && confirm("Excluir esta posição da carteira?")) { try { await remove("investments", id); state.investmentEdit = ""; await reloadInvestments("Posição excluída."); } catch (error) { setMessage(error.message || String(error), true); renderInvestments(true); } }
      if (action === "delete-goal" && confirm("Excluir esta meta financeira?")) { try { await remove("investment_goals", id); state.goalEdit = ""; await reloadInvestments("Meta excluída."); } catch (error) { setMessage(error.message || String(error), true); renderInvestments(true); } }
    }));
  }

  function updateSimulator() {
    const form = $("simulatorV17Form"), target = $("simulatorV17Result");
    if (!form || !target) return;
    const v = formObject(form), kind = v.kind;
    form.querySelector(".sim-fee")?.classList.toggle("hidden", kind !== "consortium");
    form.querySelector('label:has(input[name="rate"])')?.classList.toggle("hidden", kind === "consortium");
    try {
      const result = window.FSFinance.simulate({
        kind, principalCents: parseMoney(v.principal), contributionCents: parseMoney(v.monthly),
        months: Number(v.months), annualRatePercent: Number(String(v.rate || "0").replace(",", ".")),
        feePercent: Number(String(v.fee || "0").replace(",", ".")),
      });
      const label = kind === "investment" ? "Valor projetado" : "Parcela estimada";
      const detail = kind === "investment"
        ? `Total aportado: ${money(result.contributedCents)} · ganho bruto estimado: ${money(result.interestCents)}. Aportes ao final de cada mês.`
        : kind === "consortium" ? `Custo total estimado: ${money(result.totalCents)}. Lance, seguros e reajustes não incluídos.`
        : `Total pago estimado: ${money(result.totalCents)} · juros estimados: ${money(result.interestCents)}. Pode haver ajuste de centavos na última parcela.`;
      target.innerHTML = `<span>${esc(label)}</span><strong>${esc(money(result.valueCents))}</strong><p>${esc(detail)}</p>`;
    } catch (error) {
      target.innerHTML = `<p class="expense">${esc(error.message || String(error))}</p>`;
    }
  }

  function openFinanceSummary() {
    const accounts = openFinanceAccounts().filter((item) => !item.currency || item.currency === "BRL"), bills = openFinanceBills().filter((item) => !item.currency || item.currency === "BRL");
    return {
      bankBalance: accounts.filter((item) => item.type !== "CREDIT").reduce((sum, item) => sum + Number(item.balanceCents || 0), 0),
      creditUsed: accounts.filter((item) => item.type === "CREDIT").reduce((sum, item) => sum + Number(item.balanceCents || 0), 0),
      openBills: bills.filter((item) => String(item.status || "").toUpperCase() !== "PAID").reduce((sum, item) => sum + Number(item.totalAmountCents || 0), 0),
    };
  }

  function renderOpenFinance(force = false) {
    if (S.page !== "openfinance") return;
    const view = $("view"); if (!view) return;
    const connections = openFinanceConnections(), accounts = openFinanceAccounts(), bills = openFinanceBills(), summary = openFinanceSummary();
    const signature = [workspaceId(), navigator.onLine, canUseCloud(), state.openFinanceBusy, state.openFinanceConfigured, state.message, connections.length, accounts.length, bills.length, latest(connections), latest(accounts), latest(bills)].join("|");
    if (!force && view.dataset.advancedV17 === `openfinance:${signature}`) return;
    view.dataset.advancedV17 = `openfinance:${signature}`;
    const ready = state.openFinanceConfigured === true && canUseCloud();
    const status = ready ? "Conexão em homologação" : state.openFinanceConfigured === false ? "Aguardando credenciais" : canUseCloud() ? "Verificando servidor" : "Disponível ao entrar online";
    view.innerHTML = `<section class="advanced-hero open-finance-hero"><div><span class="eyebrow">Consentimento bancário</span><h2>Open Finance</h2><p>Você autoriza o compartilhamento no ambiente da instituição. O Finança Simples não pede nem armazena sua senha bancária.</p></div><div class="button-row"><span class="integration-status ${ready ? "ready" : ""}">${esc(status)}</span><button class="primary" data-of-action="connect" disabled title="Conexão bancária aguardando homologação de segurança">${state.openFinanceBusy === "connect" ? "Abrindo..." : "Conectar instituição"}</button></div></section>${messageBox()}<div class="notice warn advanced-notice"><strong>Nova conexão e renovação indisponíveis nesta prévia</strong><span>O consentimento bancário ainda precisa ser homologado em uma interface isolada do aplicativo. Saldos e faturas já salvos permanecem disponíveis; não há importação automática de lançamentos.</span></div>${state.openFinanceConfigured === false ? `<div class="notice warn advanced-notice"><strong>Integração preparada, aguardando ativação</strong><span>Cadastre PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET como segredos da função Supabase. Nunca coloque essas credenciais no aplicativo ou no GitHub.</span></div>` : ""}<section class="kpi-grid"><article class="kpi"><span>Saldo nas contas (BRL)</span><strong>${esc(money(summary.bankBalance))}</strong><small>última sincronização</small></article><article class="kpi"><span>Uso nos cartões (BRL)</span><strong>${esc(money(summary.creditUsed))}</strong><small>informado pelas instituições</small></article><article class="kpi"><span>Faturas não marcadas pagas (BRL)</span><strong>${esc(money(summary.openBills))}</strong><small>${bills.length} fatura(s) encontrada(s)</small></article><article class="kpi"><span>Instituições</span><strong>${connections.length}</strong><small>${accounts.length} conta(s) e cartão(ões)</small></article></section><div class="two-col open-finance-layout"><section class="panel"><div class="panel-head"><div><h3>Instituições conectadas</h3><small>Consentimentos e última sincronização.</small></div><button class="ghost" data-of-action="sync-all" ${!ready || !connections.length || state.openFinanceBusy ? "disabled" : ""}>${state.openFinanceBusy === "sync" ? "Sincronizando..." : "Sincronizar"}</button></div><div class="connection-list">${connections.length ? connections.map((item) => `<article class="connection-card"><div><strong>${esc(item.institutionName || "Instituição financeira")}</strong><span>${esc(timeLabel(item.lastSyncAt))}</span><small>${esc(item.executionStatus || item.status || "Conectada")}${item.consentExpiresAt ? ` · consentimento até ${esc(dateLabel(item.consentExpiresAt))}` : ""}</small></div><div class="button-row"><button class="ghost compact" data-of-action="renew" data-item-id="${esc(item.providerItemId)}" disabled title="Renovação aguardando homologação">Renovar</button><button class="ghost compact danger" data-of-action="disconnect" data-item-id="${esc(item.providerItemId)}" ${state.openFinanceBusy ? "disabled" : ""}>Revogar</button></div></article>`).join("") : `<div class="empty">Nenhuma instituição conectada.</div>`}</div></section><section class="panel"><div class="panel-head"><div><h3>Contas e cartões sincronizados</h3><small>Saldos informados no último acesso autorizado.</small></div></div><div class="synced-account-grid">${accounts.length ? accounts.map((item) => `<article><span>${item.type === "CREDIT" ? "Cartão de crédito" : "Conta bancária"}</span><strong>${esc(item.name || "Conta")}</strong><small>${esc(item.numberMask || item.subtype || "")}</small><b>${esc(money(item.balanceCents))}</b>${item.type === "CREDIT" && item.availableCreditLimitCents != null ? `<em>Limite disponível: ${esc(money(item.availableCreditLimitCents))}</em>` : ""}</article>`).join("") : `<div class="empty">Os saldos aparecerão após a primeira conexão.</div>`}</div></section></div><section class="panel"><div class="panel-head"><div><h3>Faturas encontradas</h3><small>Fechamento, vencimento e valores informados pelo emissor.</small></div></div><div class="table-wrap"><table><thead><tr><th>Cartão</th><th>Fechamento</th><th>Vencimento</th><th>Status</th><th class="right">Mínimo</th><th class="right">Total</th></tr></thead><tbody>${bills.length ? bills.map((bill) => `<tr><td>${esc(bill.accountName || "Cartão")}</td><td>${esc(dateLabel(bill.closeDate))}</td><td>${esc(dateLabel(bill.dueDate))}</td><td><span class="tag">${esc(bill.status || "OPEN")}</span></td><td class="right">${bill.minimumPaymentCents == null ? "—" : esc(money(bill.minimumPaymentCents))}</td><td class="right"><strong>${esc(money(bill.totalAmountCents))}</strong></td></tr>`).join("") : `<tr><td colspan="6" class="empty">Nenhuma fatura sincronizada.</td></tr>`}</tbody></table></div></section>`;
    $("pageTitle").textContent = "Open Finance";
    bindOpenFinanceEvents();
    ensureOpenFinanceStatus();
  }

  async function ensureOpenFinanceStatus(force = false) {
    const id = workspaceId();
    if (!canUseCloud() || (!force && state.openFinanceStatusWorkspace === id)) return;
    state.openFinanceStatusWorkspace = id;
    try {
      const result = await cloud().edge("open-finance", { action: "status", workspaceId: id });
      if (workspaceId() !== id) return;
      state.openFinanceConfigured = result.configured === true;
    } catch (error) {
      if (workspaceId() !== id) return;
      state.openFinanceConfigured = null;
      if (force) setMessage(friendlyCloudError(error), true);
    }
    renderOpenFinance(true);
  }

  async function persistOpenFinanceSnapshot(snapshot) {
    const connection = snapshot.connection;
    if (!connection?.providerItemId) throw new Error("A instituição não retornou uma conexão válida.");
    const itemId = connection.providerItemId;
    const inputs = [];
    const existingConnection = openFinanceConnections().find((row) => row.providerItemId === itemId);
    inputs.push({ type: "open_finance_connections", id: existingConnection?.id || null, data: connection });
    for (const account of snapshot.accounts || []) {
      const existing = openFinanceAccounts().find((row) => row.providerAccountId === account.providerAccountId);
      inputs.push({ type: "open_finance_accounts", id: existing?.id || null, data: account });
    }
    for (const bill of snapshot.bills || []) {
      const existing = openFinanceBills().find((row) => row.providerBillId === bill.providerBillId);
      inputs.push({ type: "open_finance_bills", id: existing?.id || null, data: bill });
    }
    await bulkSave(inputs);
    // Respostas parciais/paginadas nunca apagam o histórico local.
  }

  async function syncItem(itemId, operation) {
    const snapshot = await cloud().edge("open-finance", { action: "syncItem", workspaceId: operation.id, itemId });
    operation.assertCurrent();
    await persistOpenFinanceSnapshot(snapshot);
    return snapshot;
  }

  async function connectInstitution() {
    setMessage("Nova conexão e renovação aguardam homologação de segurança. Nenhum acesso bancário foi iniciado.", true);
    renderOpenFinance(true);
  }

  async function syncAllOpenFinance() {
    if (!canUseCloud() || state.openFinanceBusy || !can("openFinance", "edit")) return;
    const operation = workspaceOperation();
    state.openFinanceBusy = "sync"; setMessage("Sincronizando instituições..."); renderOpenFinance(true);
    try {
      let accountCount = 0, billCount = 0;
      for (const item of openFinanceConnections()) { const snapshot = await syncItem(item.providerItemId, operation); accountCount += (snapshot.accounts || []).length; billCount += (snapshot.bills || []).length; }
      await load(); setMessage(`${accountCount} conta(s) e ${billCount} fatura(s) atualizadas.`);
    } catch (error) { setMessage(friendlyCloudError(error), true); }
    state.openFinanceBusy = ""; operation.release(); renderOpenFinance(true);
  }

  async function disconnectInstitution(itemId) {
    if (!canUseCloud() || state.openFinanceBusy || !can("openFinance", "delete")) return;
    const connection = openFinanceConnections().find((item) => item.providerItemId === itemId);
    if (!confirm(`Revogar o acesso à instituição “${connection?.institutionName || "selecionada"}”?`)) return;
    const operation = workspaceOperation();
    state.openFinanceBusy = `delete:${itemId}`; setMessage(""); renderOpenFinance(true);
    try {
      await cloud().edge("open-finance", { action: "disconnect", workspaceId: operation.id, itemId });
      operation.assertCurrent();
      for (const row of openFinanceBills().filter((item) => item.providerItemId === itemId)) await remove("open_finance_bills", row.id);
      for (const row of openFinanceAccounts().filter((item) => item.providerItemId === itemId)) await remove("open_finance_accounts", row.id);
      if (connection) await remove("open_finance_connections", connection.id);
      await load(); setMessage("Consentimento revogado e conexão removida.");
    } catch (error) { setMessage(friendlyCloudError(error), true); }
    state.openFinanceBusy = ""; operation.release(); renderOpenFinance(true);
  }

  function bindOpenFinanceEvents() {
    $("view")?.querySelectorAll("[data-of-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.ofAction, itemId = button.dataset.itemId || "";
      if (action === "connect") connectInstitution();
      if (action === "renew") connectInstitution(itemId);
      if (action === "sync-all") syncAllOpenFinance();
      if (action === "disconnect") disconnectInstitution(itemId);
    }));
  }

  function enhance() {
    const id = workspaceId();
    if (state.workspaceKey !== id) {
      state.workspaceKey = id;
      state.investmentEdit = ""; state.goalEdit = "";
      state.message = ""; state.messagePage = "";
      state.openFinanceConfigured = null; state.openFinanceStatusWorkspace = "";
      state.marketAttemptedWorkspace = "";
    }
    if (S.page === "investments") renderInvestments();
    if (S.page === "openfinance") renderOpenFinance();
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; enhance(); });
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", () => setTimeout(schedule, 0));
  window.addEventListener("online", () => { state.openFinanceStatusWorkspace = ""; state.marketAttemptedWorkspace = ""; schedule(); });
  window.addEventListener("offline", schedule);
  schedule();
})();
