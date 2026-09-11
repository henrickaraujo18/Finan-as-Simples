(() => {
  const invoke = window.__TAURI__?.core?.invoke;

  const TYPES = [
    "transactions", "accounts", "cards", "categories", "investments", "investment_goals",
    "market_data", "open_finance_connections", "open_finance_accounts", "open_finance_bills", "settings",
  ];
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
    cash: "Dinheiro",
    payment: "Conta de pagamento",
    other: "Outra",
  };
  const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard", "Outro"];
  const INVESTMENT_TYPES = ["Tesouro Direto", "CDB", "LCI/LCA", "Fundo", "Ação", "ETF", "FII", "Cripto", "Previdência", "Outro"];

  // Categorias originais da planilha Finança Simples - Essencial 2025.
  const ESSENTIAL_CATEGORIES = [
    ["expense", "Moradia 🏠"],
    ["expense", "Mercado 🛒"],
    ["expense", "Luz 💡"],
    ["expense", "Água 💧"],
    ["expense", "Internet 📶"],
    ["expense", "Transporte 🚗"],
    ["expense", "Gás 🔥"],
    ["expense", "Saúde 🏥"],
    ["expense", "Educação 📚"],
    ["expense", "Faturas 💳"],
    ["expense", "Dízimo e doações ✝️"],
    ["expense", "Assinaturas 🔁"],
    ["income", "Trabalho fixo 💼"],
    ["income", "Renda extra💸"],
    ["income", "Bônus 💰"],
    ["income", "Pensão 👵"],
    ["income", "Vendas 🛍️"],
    ["income", "Pro Labore 💵"],
  ];

  const DEFAULT_SETTINGS = {
    profileName: "Meu financeiro",
    openingBalanceCents: 0,
    averageMonthlyIncomeCents: 0,
    emergencyReserveGoalCents: 0,
    defaultAccountId: "",
    currency: "BRL",
    referenceModel: "Finança Simples - Essencial 2025",
  };

  const S = {
    page: "dashboard",
    month: new Date().toISOString().slice(0, 7),
    year: new Date().getFullYear(),
    runtime: null,
    data: Object.fromEntries(TYPES.map((type) => [type, []])),
    settings: { ...DEFAULT_SETTINGS },
    edit: { transactions: null, accounts: null, cards: null, investments: null, categories: null },
  };

  const row = (entity) => ({ id: entity.id, ...(entity.data || {}), _updatedAt: entity.updatedAt });
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const monthOf = (date) => String(date || "").slice(0, 7);
  const today = () => {
    const date = new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const parseMoney = (value) => {
    let text = String(value ?? "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
    if (!text) return 0;
    text = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    const number = Number(text);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  };
  const inputMoney = (cents) => (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
  const money = (cents) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
  const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

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

  const tx = () => S.data.transactions || [];
  const accounts = () => S.data.accounts || [];
  const cards = () => S.data.cards || [];
  const categories = () => S.data.categories || [];
  const investments = () => S.data.investments || [];
  const investmentGoals = () => S.data.investment_goals || [];
  const marketData = () => S.data.market_data || [];
  const openFinanceConnections = () => S.data.open_finance_connections || [];
  const openFinanceAccounts = () => S.data.open_finance_accounts || [];
  const openFinanceBills = () => S.data.open_finance_bills || [];
  const accountById = (id) => accounts().find((item) => item.id === id);
  const cardById = (id) => cards().find((item) => item.id === id);
  const categoryById = (id) => categories().find((item) => item.id === id);
  const categoryName = (item) => categoryById(item.categoryId)?.name || item.category || "Sem categoria";
  const categoryByName = (name, kind = null) => categories().find((item) => item.name === name && (!kind || item.kind === kind));
  const accountName = (id) => accountById(id)?.name || "—";
  const cardName = (id) => cardById(id)?.name || "—";

  async function ensureEssentialSeeds() {
    const existingKeys = new Set(categories().map((item) => `${item.kind}|${item.name}`));
    const missingCategories = ESSENTIAL_CATEGORIES
      .filter(([kind, name]) => !existingKeys.has(`${kind}|${name}`))
      .map(([kind, name]) => ({ type: "categories", data: { kind, name, active: true, source: "essential-2025" } }));
    if (missingCategories.length) {
      await bulkSave(missingCategories);
      S.data.categories = await list("categories");
    }

    if (!accounts().length) {
      await bulkSave([
        { type: "accounts", data: { name: "Banco 1", institution: "", type: "checking", openingBalanceCents: 0, active: true, source: "essential-2025" } },
        { type: "accounts", data: { name: "Banco 2", institution: "", type: "checking", openingBalanceCents: 0, active: true, source: "essential-2025" } },
        { type: "accounts", data: { name: "Dinheiro", institution: "", type: "cash", openingBalanceCents: 0, active: true, source: "essential-2025" } },
      ]);
      S.data.accounts = await list("accounts");
    }
  }

  async function load() {
    if (!invoke) throw new Error("API local do Tauri não disponível.");
    for (const type of TYPES) S.data[type] = await list(type);
    S.settings = { ...DEFAULT_SETTINGS, ...(S.data.settings[0] || {}) };
    await ensureEssentialSeeds();
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
  function nextMonth(monthString) {
    return addMonths(`${monthString}-01`, 1).slice(0, 7);
  }
  function splitAmount(totalCents, count) {
    count = Math.max(1, Number(count || 1));
    const base = Math.floor(Number(totalCents || 0) / count);
    let remainder = Number(totalCents || 0) - base * count;
    return Array.from({ length: count }, () => base + (remainder-- > 0 ? 1 : 0));
  }
  function firstCardDueDate(card, purchaseDate) {
    const { year, month, day } = dateParts(purchaseDate);
    const closingDay = Math.max(1, Math.min(31, Number(card.closingDay || 31)));
    const dueDay = Math.max(1, Math.min(31, Number(card.dueDay || 10)));
    let monthOffset = dueDay <= closingDay ? 1 : 0;
    if (day > closingDay) monthOffset += 1;
    const base = new Date(year, month - 1 + monthOffset, 1, 12, 0, 0);
    return buildDate(base.getFullYear(), base.getMonth() + 1, dueDay);
  }

  function isExpense(item) { return item.kind === "expense"; }
  function isIncome(item) { return item.kind === "income"; }
  function isTransfer(item) { return item.kind === "transfer"; }
  function isCardPayment(item) { return item.kind === "card_payment"; }
  function isCardPurchase(item) { return isExpense(item) && item.paymentMethod === "credit_card"; }
  function txAccountId(item) { return item.accountId || ""; }

  // Para parcelas, a competência é a data programada da parcela. Compras no cartão usam o vencimento da fatura.
  function effectiveDate(item) {
    if (isCardPurchase(item)) return item.dueDate || item.date;
    if (Number(item.installmentCount || 1) > 1 && item.dueDate) return item.dueDate;
    if (item.status === "pending" && item.dueDate) return item.dueDate;
    return item.date;
  }
  function effectiveMonth(item) { return monthOf(effectiveDate(item)); }

  function accountBalance(accountId) {
    const account = accountById(accountId);
    let balance = Number(account?.openingBalanceCents ?? 0);
    for (const item of tx()) {
      if (item.status !== "paid") continue;
      const amount = Number(item.amountCents || 0);
      if (isIncome(item) && txAccountId(item) === accountId) balance += amount;
      if (isExpense(item) && !isCardPurchase(item) && txAccountId(item) === accountId) balance -= amount;
      if (isCardPayment(item) && txAccountId(item) === accountId) balance -= amount;
      if (isTransfer(item)) {
        if (txAccountId(item) === accountId) balance -= amount;
        if (item.targetAccountId === accountId) balance += amount;
      }
    }
    return balance;
  }
  function totalCashBalance() {
    const linkedBalances = accounts().reduce((sum, account) => sum + accountBalance(account.id), 0);
    const unlinkedMovement = tx().reduce((sum, item) => {
      if (item.status !== "paid" || item.accountId) return sum;
      if (isIncome(item)) return sum + Number(item.amountCents || 0);
      if (isExpense(item) && !isCardPurchase(item)) return sum - Number(item.amountCents || 0);
      if (isCardPayment(item)) return sum - Number(item.amountCents || 0);
      return sum;
    }, 0);
    return Number(S.settings.openingBalanceCents || 0) + linkedBalances + unlinkedMovement;
  }

  function cardUsed(cardId) {
    return tx().filter((item) => isCardPurchase(item) && item.cardId === cardId && item.status !== "paid")
      .reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  }
  function cardAvailable(card) {
    if (!Number(card.limitCents || 0)) return null;
    return Math.max(0, Number(card.limitCents) - cardUsed(card.id));
  }
  function invoiceGroups() {
    const groups = new Map();
    for (const item of tx().filter((x) => isCardPurchase(x) && x.cardId)) {
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

  function cardPaymentsForMonth(month) {
    return tx().filter((item) => isCardPayment(item) && monthOf(item.date) === month);
  }
  function regularExpenseRows(month) {
    return tx().filter((item) => isExpense(item) && !isCardPurchase(item) && effectiveMonth(item) === month);
  }
  function incomeRows(month) {
    return tx().filter((item) => isIncome(item) && effectiveMonth(item) === month);
  }
  function cardPurchaseRowsByPurchaseMonth(month) {
    return tx().filter((item) => isCardPurchase(item) && monthOf(item.purchaseDate || item.date) === month);
  }

  // Replica a lógica principal da planilha: compras no cartão são analisadas à parte; a saída de caixa é a fatura.
  function monthMetrics(month = S.month) {
    const expenses = regularExpenseRows(month);
    const incomes = incomeRows(month);
    const invoiceGroupsMonth = invoiceGroups().filter((group) => group.invoiceMonth === month);
    const paidInvoiceTransactions = cardPaymentsForMonth(month);

    const expensePaid = expenses.filter((item) => item.status === "paid").reduce((s, item) => s + Number(item.amountCents || 0), 0)
      + paidInvoiceTransactions.reduce((s, item) => s + Number(item.amountCents || 0), 0);
    const regularExpensePending = expenses.filter((item) => item.status !== "paid").reduce((s, item) => s + Number(item.amountCents || 0), 0);
    const invoicePending = invoiceGroupsMonth.reduce((s, group) => s + Number(group.pendingCents || 0), 0);
    const expensePending = regularExpensePending + invoicePending;
    const incomePaid = incomes.filter((item) => item.status === "paid").reduce((s, item) => s + Number(item.amountCents || 0), 0);
    const incomePending = incomes.filter((item) => item.status !== "paid").reduce((s, item) => s + Number(item.amountCents || 0), 0);
    const resultPaid = incomePaid - expensePaid;
    const toProfit = incomePending - expensePending;
    const resultForecast = resultPaid + toProfit;
    const cardPurchases = cardPurchaseRowsByPurchaseMonth(month);
    const cardSpent = cardPurchases.reduce((s, item) => s + Number(item.amountCents || 0), 0);
    const averageIncome = Number(S.settings.averageMonthlyIncomeCents || 0);
    return {
      expenses,
      incomes,
      invoiceGroupsMonth,
      expensePaid,
      expensePending,
      incomePaid,
      incomePending,
      resultPaid,
      toProfit,
      resultForecast,
      cardSpent,
      cardCommitmentPct: averageIncome ? (cardSpent / averageIncome) * 100 : 0,
      finalBalance: totalCashBalance(),
      forecastBalance: totalCashBalance() + incomePending - regularExpensePending - invoicePending,
    };
  }

  function groupByCategory(rows) {
    const map = new Map();
    for (const item of rows) {
      const name = categoryName(item);
      map.set(name, (map.get(name) || 0) + Number(item.amountCents || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }
  function expenseRanking(month = S.month) {
    const regular = regularExpenseRows(month).filter((item) => item.status === "paid");
    const faturaCategory = categoryByName("Faturas 💳", "expense");
    const invoiceRows = cardPaymentsForMonth(month).map((item) => ({ ...item, kind: "expense", categoryId: item.categoryId || faturaCategory?.id || "", category: "Faturas 💳" }));
    return groupByCategory([...regular, ...invoiceRows]);
  }
  function incomeRanking(month = S.month) {
    return groupByCategory(incomeRows(month).filter((item) => item.status === "paid"));
  }
  function cardCategoryRanking(month = S.month, cardId = null) {
    const rows = cardPurchaseRowsByPurchaseMonth(month).filter((item) => !cardId || item.cardId === cardId);
    return groupByCategory(rows);
  }
  function cardRanking(month = S.month) {
    const map = new Map();
    for (const item of cardPurchaseRowsByPurchaseMonth(month)) {
      const name = cardName(item.cardId);
      map.set(name, (map.get(name) || 0) + Number(item.amountCents || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function monthlySeries(year = S.year) {
    return Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      return { month, ...monthMetrics(month) };
    });
  }
  function annualMetrics(year = S.year) {
    const months = monthlySeries(year);
    return {
      months,
      expensePaid: months.reduce((s, m) => s + m.expensePaid, 0),
      incomePaid: months.reduce((s, m) => s + m.incomePaid, 0),
      resultPaid: months.reduce((s, m) => s + m.resultPaid, 0),
      cardSpent: months.reduce((s, m) => s + m.cardSpent, 0),
    };
  }

  function investmentMetrics() {
    let cost = 0, current = 0;
    for (const item of investments()) {
      cost += Math.round(Number(item.quantity || 0) * Number(item.averagePriceCents || 0));
      current += Math.round(Number(item.quantity || 0) * Number(item.currentPriceCents || 0));
    }
    return { cost, current, gain: current - cost };
  }

  function baseTransaction(values, kind) {
    return {
      kind,
      description: String(values.description || "").trim(),
      counterparty: String(values.counterparty || "").trim(),
      categoryId: values.categoryId || "",
      accountId: values.accountId || "",
      amountCents: parseMoney(values.amount),
      date: values.date || today(),
      dueDate: values.dueDate || "",
      status: values.status || "paid",
      paymentMethod: values.paymentMethod || (kind === "income" ? "transfer" : "pix"),
      flowClass: values.flowClass || "variable",
      notes: values.notes || "",
      source: "manual",
    };
  }

  async function saveRegularLaunch(values, kind) {
    const totalCents = parseMoney(values.amount);
    if (totalCents <= 0) throw new Error("Informe um valor maior que zero.");
    if (!values.categoryId) throw new Error("Selecione a categoria.");
    if (!String(values.description || "").trim()) throw new Error("Informe a descrição.");
    const installmentCount = Math.max(1, Math.min(60, Number(values.installmentCount || 1)));
    const amounts = splitAmount(totalCents, installmentCount);
    const groupId = installmentCount > 1 ? uid() : "";
    const firstDate = values.dueDate || values.date || today();
    const base = baseTransaction(values, kind);
    const items = amounts.map((part, index) => {
      const competenceDate = addMonths(firstDate, index);
      return {
        type: "transactions",
        data: {
          ...base,
          amountCents: part,
          totalSeriesCents: totalCents,
          originalDate: values.date || today(),
          date: competenceDate,
          dueDate: competenceDate,
          status: index === 0 ? base.status : "pending",
          installmentGroupId: groupId,
          installmentNumber: index + 1,
          installmentCount,
        },
      };
    });
    return bulkSave(items);
  }

  async function saveCardLaunch(values) {
    const card = cardById(values.cardId);
    if (!card) throw new Error("Selecione um cartão cadastrado.");
    if (!values.categoryId) throw new Error("Selecione a categoria.");
    const totalCents = parseMoney(values.amount);
    if (totalCents <= 0) throw new Error("Informe um valor maior que zero.");
    const installmentCount = Math.max(1, Math.min(60, Number(values.installmentCount || 1)));
    const amounts = splitAmount(totalCents, installmentCount);
    const groupId = installmentCount > 1 ? uid() : "";
    const firstDue = firstCardDueDate(card, values.date || today());
    return bulkSave(amounts.map((part, index) => {
      const dueDate = addMonths(firstDue, index, Number(card.dueDay || 10));
      return {
        type: "transactions",
        data: {
          kind: "expense",
          description: String(values.description || "").trim() || String(values.counterparty || "Compra no cartão").trim(),
          counterparty: String(values.counterparty || "").trim(),
          categoryId: values.categoryId,
          paymentMethod: "credit_card",
          accountId: "",
          cardId: card.id,
          amountCents: part,
          totalPurchaseCents: totalCents,
          date: values.date || today(),
          purchaseDate: values.date || today(),
          dueDate,
          invoiceMonth: monthOf(dueDate),
          status: "pending",
          flowClass: "variable",
          installmentGroupId: groupId,
          installmentNumber: index + 1,
          installmentCount,
          source: "manual",
          notes: values.notes || "",
        },
      };
    }));
  }

  async function saveTransfer(values) {
    const amountCents = parseMoney(values.amount);
    if (amountCents <= 0) throw new Error("Informe o valor da transferência.");
    if (!values.accountId || !values.targetAccountId || values.accountId === values.targetAccountId) throw new Error("Selecione contas de origem e destino diferentes.");
    return save("transactions", {
      kind: "transfer",
      description: String(values.description || "Transferência").trim(),
      accountId: values.accountId,
      targetAccountId: values.targetAccountId,
      amountCents,
      date: values.date || today(),
      status: "paid",
      paymentMethod: "transfer",
      source: "manual",
    });
  }

  async function settleTransaction(id) {
    const item = tx().find((x) => x.id === id);
    if (!item) return;
    const data = { ...item, status: "paid", paidAt: today() };
    delete data.id; delete data._updatedAt;
    await save("transactions", data, id);
  }

  async function settleInvoice(cardId, invoiceMonth, accountIdOverride = "") {
    const card = cardById(cardId);
    if (!card) throw new Error("Cartão não encontrado.");
    const items = tx().filter((item) => item.cardId === cardId && item.invoiceMonth === invoiceMonth && isCardPurchase(item) && item.status !== "paid");
    if (!items.length) return;
    const amountCents = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    const accountId = accountIdOverride || card.accountId || "";
    const updates = items.map((item) => {
      const data = { ...item, status: "paid", paidAt: today() };
      delete data.id; delete data._updatedAt;
      return { type: "transactions", id: item.id, data };
    });
    const faturaCategory = card.areaCategoryId || categoryByName("Faturas 💳", "expense")?.id || "";
    updates.push({
      type: "transactions",
      data: {
        kind: "card_payment",
        description: `Fatura ${card.name} ${invoiceMonth}`,
        counterparty: card.name,
        categoryId: faturaCategory,
        accountId,
        cardId,
        invoiceMonth,
        amountCents,
        date: today(),
        dueDate: buildDate(Number(invoiceMonth.slice(0, 4)), Number(invoiceMonth.slice(5, 7)), Number(card.dueDay || 10)),
        status: "paid",
        paymentMethod: "transfer",
        flowClass: "fixed",
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
  async function importInvoice(cardId, dueDate, file) {
    const card = cardById(cardId);
    if (!card) throw new Error("Selecione o cartão da fatura.");
    if (!file) throw new Error("Selecione um arquivo CSV.");
    const items = parseCsv(await file.text());
    if (!items.length) throw new Error("Nenhum lançamento válido encontrado.");
    await bulkSave(items.map((item) => ({ type: "transactions", data: {
      kind: "expense",
      description: item.description,
      counterparty: item.description,
      categoryId: card.areaCategoryId || "",
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

  window.FSCore = {
    invoke, S, TYPES, PAYMENT_METHODS, ACCOUNT_TYPES, CARD_BRANDS, INVESTMENT_TYPES,
    ESSENTIAL_CATEGORIES, DEFAULT_SETTINGS,
    today, monthOf, nextMonth, money, pct, parseMoney, inputMoney, uid,
    list, save, bulkSave, remove, load,
    tx, accounts, cards, categories, investments, investmentGoals, marketData,
    openFinanceConnections, openFinanceAccounts, openFinanceBills,
    accountById, cardById, categoryById,
    categoryByName, categoryName, accountName, cardName,
    buildDate, addMonths, splitAmount, firstCardDueDate, effectiveDate, effectiveMonth,
    isExpense, isIncome, isTransfer, isCardPayment, isCardPurchase,
    accountBalance, totalCashBalance, cardUsed, cardAvailable, invoiceGroups,
    monthMetrics, expenseRanking, incomeRanking, cardCategoryRanking, cardRanking,
    annualMetrics, monthlySeries, investmentMetrics,
    saveRegularLaunch, saveCardLaunch, saveTransfer, settleTransaction, settleInvoice,
    importInvoice,
  };
})();
