(() => {
  function simulate({ kind, principalCents, contributionCents, months, annualRatePercent = 0, feePercent = 0 }) {
    if (!["investment", "loan", "financing", "consortium"].includes(kind)) throw new Error("Selecione uma simulação válida.");
    if (!Number.isInteger(months) || months < 1 || months > 1200) throw new Error("Informe um prazo inteiro entre 1 e 1200 meses.");
    for (const amount of [principalCents, contributionCents]) {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e14) throw new Error("Informe valores monetários válidos e não negativos.");
    }
    for (const rate of [annualRatePercent, feePercent]) {
      if (!Number.isFinite(rate) || rate < 0 || rate > 1000) throw new Error("Informe taxas entre 0% e 1000%.");
    }
    if (["loan", "financing"].includes(kind) && contributionCents > principalCents) throw new Error("A entrada não pode superar o valor do crédito.");
    const monthlyRate = Math.expm1(Math.log1p(annualRatePercent / 100) / 12);
    let result;
    if (kind === "investment") {
      const growth = Math.pow(1 + monthlyRate, months);
      const contributedCents = principalCents + contributionCents * months;
      // Aportes no fim de cada mês; valores brutos, sem impostos ou tarifas.
      const valueCents = Math.round(principalCents * growth + contributionCents * (monthlyRate ? Math.expm1(months * Math.log1p(monthlyRate)) / monthlyRate : months));
      result = { valueCents, contributedCents, interestCents: valueCents - contributedCents };
    } else if (kind === "consortium") {
      const totalCents = Math.round(principalCents * (1 + feePercent / 100));
      result = { valueCents: Math.round(totalCents / months), totalCents };
    } else {
      const financedCents = principalCents - contributionCents;
      const valueCents = Math.round(monthlyRate ? financedCents * monthlyRate / -Math.expm1(-months * Math.log1p(monthlyRate)) : financedCents / months);
      const totalCents = valueCents * months + contributionCents;
      result = { valueCents, totalCents, interestCents: totalCents - principalCents };
    }
    if (Object.values(result).some((value) => !Number.isSafeInteger(value))) throw new Error("O resultado ultrapassa o limite do simulador. Reduza os valores, a taxa ou o prazo.");
    return result;
  }
  window.FSFinance = Object.freeze({ simulate });
})();
