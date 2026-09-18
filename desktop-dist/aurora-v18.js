(() => {
  const C = window.FSCore;
  if (!C) return;
  const esc = s => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  let report = null, reportWorkspace = "", busy = false;
  const workspace = () => window.FSAuth?.workspaceId?.() || "";
  const allowed = () => window.FSAuth?.can("transactions", "view") && window.FSAuth?.can("investments", "view");
  const online = () => navigator.onLine && window.FSCloudRuntime?.isAuthenticated();
  const amount = n => Number.isFinite(Number(n)) ? Number(n) : 0;

  function snapshot() {
    const month = C.S.month;
    const months = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(`${month}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() - 5 + i);
      const key = date.toISOString().slice(0, 7), m = C.monthMetrics(key);
      return { month: key, incomePaidCents: m.incomePaid, expensePaidCents: m.expensePaid, incomePendingCents: m.incomePending, expensePendingCents: m.expensePending, resultPaidCents: m.resultPaid,
        records: (m.expenses?.length || 0) + (m.incomes?.length || 0) + (m.invoiceGroupsMonth?.length || 0) };
    });
    const groups = rows => rows.slice(0, 20).map(([category, amountCents]) => ({ category, amountCents }));
    return { month, capturedAt: new Date().toISOString(), riskProfile: C.S.settings.riskProfile || "não informado",
      reserveGoalCents: amount(C.S.settings.emergencyReserveGoalCents), cashBalanceCents: C.totalCashBalance(C.today()), months,
      expenses: groups(C.expenseRanking(month)), incomes: groups(C.incomeRanking(month)),
      portfolio: C.investments().map(p => ({ type: p.type, ticker: p.ticker, maturityDate: p.maturityDate, priceSource: p.priceSource || "manual", priceDate: p.priceDate || "não informada", costCents: Math.round(p.quantity * p.averagePriceCents), valueCents: Math.round(p.quantity * p.currentPriceCents), liquidityDays: p.liquidityDays == null || p.liquidityDays === "" ? null : Number(p.liquidityDays) })),
      goals: C.investmentGoals().map(g => ({ name: g.name, targetDate: g.targetDate, targetCents: g.targetCents, currentCents: g.currentCents })),
      indicators: C.marketData().filter(x => ["dollar", "selic", "ipca"].includes(x.key)).map(x => ({ key: x.key, value: x.value, source: x.source || "BCB", referenceDate: x.referenceDate })),
    };
  }

  function panel() {
    if (reportWorkspace !== workspace()) { report = null; reportWorkspace = workspace(); }
    const m = C.monthMetrics(C.S.month);
    return `<section class="panel aurora-panel"><div class="panel-head"><div><span class="eyebrow">Aurora · IA</span><h3>Orçamento, renda e investimentos</h3><small>Análise dos seis meses até ${esc(C.S.month)}, da carteira e das metas cadastradas.</small></div></div><div class="panel-body"><p>Resultado realizado do mês: <strong>${esc(C.money(m.resultPaid))}</strong>. Compromissos pendentes: <strong>${esc(C.money(m.expensePending))}</strong>. Esse resultado, sozinho, não representa dinheiro livre para investir.</p><form id="auroraForm" class="form"><label>O que deseja avaliar?<textarea name="question" maxlength="600" rows="3" placeholder="Como reduzir meus gastos e aumentar os aportes com segurança?"></textarea></label><p class="legal-note">Ao analisar, serão enviados à OpenAI resumos por categoria, valores da carteira, nomes das metas e sua pergunta. Senhas, números de conta e descrições dos lançamentos não são enviados. A análise é um retrato do momento; revise as sugestões antes de agir.</p><button class="primary" ${busy || !online() || !allowed() ? "disabled" : ""}>${busy ? "Aurora está analisando..." : "Analisar com Aurora"}</button>${!online() ? '<small>Entre online para consultar a IA.</small>' : !allowed() ? '<small>É necessário acesso a lançamentos e investimentos.</small>' : ""}</form><div id="auroraAnswer" aria-live="polite">${report ? `<small>${esc(report.provider)} · ${esc(report.model)} · ${esc(new Date(report.generatedAt).toLocaleString("pt-BR"))} · período ${esc(report.month)}</small><p style="white-space:pre-wrap">${esc(report.answer)}</p>` : '<p>Nenhuma análise de IA solicitada nesta sessão.</p>'}</div></div></section>`;
  }

  function bind(render) {
    document.getElementById("auroraForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !online() || !allowed()) return;
      const question = new FormData(event.currentTarget).get("question");
      const id = workspace(), release = window.FSAuth.lockWorkspace();
      busy = true;
      try {
        const data = snapshot();
        render();
        const result = await window.FSCloudRuntime.edge("aurora", { workspaceId: id, snapshot: data, question });
        if (id !== workspace()) return;
        report = result; reportWorkspace = id;
      } catch (error) {
        const code = String(error.code || error.message);
        const message = code.includes("not_configured") ? "A IA aguarda configuração segura da chave e do modelo no servidor." : code.includes("rate_limited") ? "Limite do provedor atingido. Tente mais tarde." : "A análise não foi concluída. Confira a conexão e os dados; tente novamente.";
        report = { answer: message, provider: "Aurora", model: "indisponível", generatedAt: new Date().toISOString(), month: C.S.month };
        reportWorkspace = id;
      } finally { busy = false; release(); render(); }
    });
  }
  window.FSAurora = Object.freeze({ panel, bind, snapshot });
})();
