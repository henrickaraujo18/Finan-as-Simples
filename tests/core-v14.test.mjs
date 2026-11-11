import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

function engine() {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "upsert_entities") {
      return args.inputs.map((item, index) => ({
        id: item.id || `generated-${index + 1}`,
        data: item.data,
        updatedAt: "2026-09-11T00:00:00Z",
      }));
    }
    if (command === "upsert_entity") {
      return { id: args.input.id || "generated", data: args.input.data, updatedAt: "2026-09-11T00:00:00Z" };
    }
    if (command === "list_entities") return [];
    return null;
  };
  const context = {
    window: { __TAURI__: { core: { invoke } } },
    crypto: webcrypto,
    Intl,
    Date,
    Math,
    Number,
    String,
    Map,
    Set,
    console,
  };
  vm.createContext(context);
  const source = readFileSync(new URL("../desktop-dist/core-v14.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "core-v14.js" });
  return { C: context.window.FSCore, calls, window: context.window };
}

test("parcelamento conserva centavos sem perder o total", () => {
  const { C } = engine();
  const values = Array.from(C.splitAmount(10_000, 3));
  assert.deepEqual(values, [3334, 3333, 3333]);
  assert.equal(values.reduce((sum, value) => sum + value, 0), 10_000);
});

test("datas mensais respeitam o último dia de fevereiro", () => {
  const { C } = engine();
  assert.equal(C.addMonths("2025-01-31", 1), "2025-02-28");
  assert.equal(C.addMonths("2024-01-31", 1), "2024-02-29");
});

test("ciclo do cartão usa fechamento e vencimento corretamente", () => {
  const { C } = engine();
  const card = { closingDay: 5, dueDay: 12 };
  assert.equal(C.firstCardDueDate(card, "2026-09-04"), "2026-09-12");
  assert.equal(C.firstCardDueDate(card, "2026-09-06"), "2026-10-12");
  assert.equal(C.firstCardDueDate({ closingDay: 20, dueDay: 10 }, "2026-09-05"), "2026-10-10");
});

test("fatura paga não duplica compra no resultado nem no saldo", () => {
  const { C } = engine();
  C.S.data.accounts = [{ id: "bank", name: "Banco", openingBalanceCents: 0 }];
  C.S.data.categories = [{ id: "salary", kind: "income", name: "Trabalho fixo 💼" }];
  C.S.data.cards = [{ id: "card", name: "Cartão", closingDay: 5, dueDay: 10, accountId: "bank" }];
  C.S.settings = { ...C.DEFAULT_SETTINGS };
  C.S.data.transactions = [
    { id: "income", kind: "income", amountCents: 100_000, date: "2026-09-01", status: "paid", accountId: "bank", categoryId: "salary" },
    { id: "purchase", kind: "expense", paymentMethod: "credit_card", amountCents: 30_000, date: "2026-08-20", purchaseDate: "2026-08-20", dueDate: "2026-09-10", invoiceMonth: "2026-09", status: "paid", cardId: "card" },
    { id: "payment", kind: "card_payment", amountCents: 30_000, date: "2026-09-10", status: "paid", accountId: "bank", cardId: "card", invoiceMonth: "2026-09" },
  ];
  const result = C.monthMetrics("2026-09");
  assert.equal(result.incomePaid, 100_000);
  assert.equal(result.expensePaid, 30_000);
  assert.equal(result.resultPaid, 70_000);
  assert.equal(result.finalBalance, 70_000);
});

test("fatura pendente entra uma única vez na projeção", () => {
  const { C } = engine();
  C.S.data.accounts = [{ id: "bank", name: "Banco", openingBalanceCents: 0 }];
  C.S.data.categories = [];
  C.S.data.cards = [{ id: "card", name: "Cartão" }];
  C.S.settings = { ...C.DEFAULT_SETTINGS };
  C.S.data.transactions = [
    { id: "income", kind: "income", amountCents: 100_000, date: "2026-09-01", status: "paid", accountId: "bank" },
    { id: "purchase", kind: "expense", paymentMethod: "credit_card", amountCents: 30_000, date: "2026-08-20", purchaseDate: "2026-08-20", dueDate: "2026-09-10", invoiceMonth: "2026-09", status: "pending", cardId: "card" },
  ];
  const result = C.monthMetrics("2026-09");
  assert.equal(result.expensePending, 30_000);
  assert.equal(result.finalBalance, 100_000);
  assert.equal(result.forecastBalance, 70_000);
});

test("compra parcelada gera parcelas e ciclos de fatura mensais", async () => {
  const { C, calls } = engine();
  C.S.data.cards = [{ id: "card", name: "Cartão", closingDay: 5, dueDay: 12 }];
  await C.saveCardLaunch({ cardId: "card", categoryId: "market", amount: "100,00", installmentCount: "3", date: "2026-09-06", description: "Compra" });
  const call = calls.find((item) => item.command === "upsert_entities");
  assert.ok(call);
  assert.deepEqual(Array.from(call.args.inputs, (item) => item.data.amountCents), [3334, 3333, 3333]);
  assert.deepEqual(Array.from(call.args.inputs, (item) => item.data.dueDate), ["2026-10-12", "2026-11-12", "2026-12-12"]);
  assert.deepEqual(Array.from(call.args.inputs, (item) => item.data.invoiceMonth), ["2026-10", "2026-11", "2026-12"]);
});

test("saldo histórico não inclui movimentos futuros e carrega o mês anterior", () => {
  const { C } = engine();
  C.S.settings.openingBalanceCents = 10_000;
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 20_000 }];
  C.S.data.transactions = [
    { kind: "income", amountCents: 100_000, date: "2026-01-10", status: "paid", accountId: "bank" },
    { kind: "expense", amountCents: 30_000, date: "2026-02-10", status: "paid", accountId: "bank" },
    { kind: "income", amountCents: 50_000, date: "2026-03-10", status: "paid" },
  ];
  assert.equal(C.monthMetrics("2026-01").openingBalance, 30_000);
  assert.equal(C.monthMetrics("2026-01").finalBalance, 130_000);
  assert.equal(C.monthMetrics("2026-02").openingBalance, 130_000);
  assert.equal(C.monthMetrics("2026-02").finalBalance, 100_000);
  assert.equal(C.monthMetrics("2026-03").finalBalance, 150_000);
});

test("baixa em atraso entra no mês do pagamento, mantendo o vencimento original", () => {
  const { C } = engine();
  C.S.data.transactions = [{ kind: "expense", amountCents: 25_000, date: "2026-01-10", dueDate: "2026-01-10", paidAt: "2026-02-05", status: "paid", installmentCount: 3 }];
  assert.equal(C.monthMetrics("2026-01").expensePaid, 0);
  assert.equal(C.monthMetrics("2026-01").finalBalance, 0);
  assert.equal(C.monthMetrics("2026-02").expensePaid, 25_000);
  assert.equal(C.monthMetrics("2026-02").finalBalance, -25_000);
  assert.equal(C.S.data.transactions[0].dueDate, "2026-01-10");
});

test("parcelamento rejeita quantidade fracionária e valor fora do limite seguro", () => {
  const { C } = engine();
  assert.throws(() => C.splitAmount(10000, 2.5));
  assert.throws(() => C.splitAmount(Number.MAX_SAFE_INTEGER + 1, 2));
});

test("compra de cartão não pode ser baixada sem pagamento da fatura", async () => {
  const { C, calls } = engine();
  C.S.data.transactions = [{ id: "purchase", kind: "expense", paymentMethod: "credit_card", status: "pending", amountCents: 5000 }];
  await assert.rejects(() => C.settleTransaction("purchase"), /fatura/);
  assert.equal(calls.length, 0);
});

test("core utiliza o wrapper de sincronização instalado depois de sua carga", async () => {
  const { C, window } = engine();
  let called = false;
  window.__TAURI__.core.invoke = async () => { called = true; return { id: "id", data: {} }; };
  await C.save("investments", {});
  assert.equal(called, true);
});

test("usuário de consulta não tenta criar cadastros padrão ao carregar", async () => {
  const { C, calls, window } = engine();
  window.FSAuth = { can: () => false };
  await C.load();
  assert.equal(calls.some((call) => call.command === "upsert_entities"), false);
});

test("pagamento de fatura debita apenas a conta vinculada na data de pagamento, sem mover a competência", async () => {
  const { C, calls } = engine();
  C.S.data.accounts = [{ id: "bank", name: "Conta", openingBalanceCents: 100_000 }];
  C.S.data.cards = [{ id: "card", name: "Cartão", accountId: "bank", dueDay: 10 }];
  C.S.data.transactions = [
    { id: "purchase", kind: "expense", paymentMethod: "credit_card", cardId: "card", amountCents: 25_000, date: "2026-08-20", dueDate: "2026-09-10", invoiceMonth: "2026-11", status: "pending" },
  ];
  assert.equal(C.invoiceGroups()[0].invoiceMonth, "2026-09");
  assert.equal(C.monthMetrics("2026-11").invoiceGroupsMonth.length, 0);
  await C.settleInvoice("card", "2026-09", "", "2026-11-07");
  const batch = calls.find((call) => call.command === "upsert_entities").args.inputs;
  const payment = batch.find((item) => item.data.kind === "card_payment");
  assert.equal(payment.data.accountId, "bank");
  assert.equal(payment.data.date, "2026-11-07");
  assert.equal(payment.data.invoiceMonth, "2026-09");
  // A persistência grava as duas operações de maneira conjunta no backend.
  C.S.data.transactions = batch.map((item, i) => ({ id: item.id || "payment-" + i, ...item.data }));
  assert.equal(C.accountBalance("bank"), 75_000);
  assert.equal(C.monthMetrics("2026-11").expensePaid, 25_000);
  assert.equal(C.monthMetrics("2026-11").invoiceGroupsMonth.length, 0);
});

test("baixa sem conta válida é bloqueada antes de marcar parcelas pagas", async () => {
  const { C, calls } = engine();
  C.S.data.cards = [{ id: "card", name: "Cartão", dueDay: 10, accountId: "" }];
  C.S.data.transactions = [{ id: "purchase", kind: "expense", paymentMethod: "credit_card", cardId: "card", amountCents: 8000, dueDate: "2026-09-10", status: "pending" }];
  await assert.rejects(() => C.settleInvoice("card", "2026-09"), /conta bancária válida/);
  assert.equal(calls.some((call) => call.command === "upsert_entities"), false);
});

test("baixa duplicada é impedida mesmo quando a fatura possui compra pendente inconsistente", async () => {
  const { C, calls } = engine();
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 100_000 }];
  C.S.data.cards = [{ id: "card", name: "Cartão", accountId: "bank", dueDay: 10 }];
  C.S.data.transactions = [
    { id: "purchase", kind: "expense", paymentMethod: "credit_card", cardId: "card", amountCents: 8000, dueDate: "2026-09-10", status: "pending" },
    { id: "payment", kind: "card_payment", cardId: "card", invoiceMonth: "2026-09", amountCents: 8000, status: "paid", accountId: "bank" },
  ];
  await assert.rejects(() => C.settleInvoice("card", "2026-09"), /Já existe pagamento/);
  assert.equal(calls.some((call) => call.command === "upsert_entities"), false);
});

test("pagamento legado sem conta explícita reflete na conta vinculada sem duplicar no saldo geral", () => {
  const { C } = engine();
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 100_000 }];
  C.S.data.cards = [{ id: "card", accountId: "bank" }];
  C.S.data.transactions = [{ id: "old", kind: "card_payment", cardId: "card", amountCents: 15_000, status: "paid", date: "2026-09-10" }];
  assert.equal(C.accountBalance("bank"), 85_000);
  assert.equal(C.totalCashBalance(), 85_000);
});

test("estorno de fatura restaura saldo, limite e parcelas sem excluir pagamento histórico", async () => {
  const { C, calls } = engine();
  C.S.settings = { ...C.DEFAULT_SETTINGS };
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 100_000 }];
  C.S.data.cards = [{ id: "card", name: "Cartão", accountId: "bank", limitCents: 60_000 }];
  C.S.data.transactions = [
    { id: "part-1", kind: "expense", paymentMethod: "credit_card", cardId: "card", amountCents: 12_000, date: "2026-08-20", dueDate: "2026-09-10", status: "paid", paidAt: "2026-11-07" },
    { id: "part-2", kind: "expense", paymentMethod: "credit_card", cardId: "card", amountCents: 8_000, date: "2026-08-25", dueDate: "2026-09-10", status: "paid", paidAt: "2026-11-07" },
    { id: "payment", kind: "card_payment", invoiceMonth: "2026-09", cardId: "card", accountId: "bank", amountCents: 20_000, date: "2026-11-07", status: "paid" },
  ];
  assert.equal(C.accountBalance("bank"), 80_000);
  assert.equal(C.monthMetrics("2026-11").expensePaid, 20_000);
  await C.reverseInvoice("card", "2026-09", "Pagamento lançado por engano");
  const batch = calls.find((x) => x.command === "upsert_entities").args.inputs;
  assert.equal(batch.length, 3);
  assert.equal(batch.find((x) => x.id === "payment").data.status, "reversed");
  assert.equal(batch.filter((x) => x.data.status === "pending").length, 2);
  assert.equal(batch.find((x) => x.id === "part-1").data.paidAt, undefined);
  C.S.data.transactions = batch.map((x) => ({ id: x.id, ...x.data }));
  assert.equal(C.accountBalance("bank"), 100_000);
  assert.equal(C.totalCashBalance(), 100_000);
  assert.equal(C.monthMetrics("2026-11").expensePaid, 0);
  assert.equal(C.monthMetrics("2026-09").expensePending, 20_000);
  assert.equal(C.cardUsed("card"), 20_000);
  assert.equal(C.cardAvailable(C.S.data.cards[0]), 40_000);
  assert.equal(C.S.data.transactions.find((x) => x.id === "payment").reversalReason, "Pagamento lançado por engano");
  await assert.rejects(() => C.reverseInvoice("card", "2026-09"), /exatamente um pagamento ativo/);
  C.S.data.transactions.push({ id: "new-payment", kind: "card_payment", invoiceMonth: "2026-09", cardId: "card", accountId: "bank", amountCents: 20_000, date: "2026-11-09", status: "paid" });
  C.S.data.transactions[0].status = "paid"; C.S.data.transactions[1].status = "paid";
  await C.reverseInvoice("card", "2026-09");
  assert.equal(calls.filter((x) => x.command === "upsert_entities").length, 2);
});

test("estorno bloqueia faturas com pagamento parcial ou valores incompatíveis sem gravar dados", async () => {
  const { C, calls } = engine();
  C.S.data.cards = [{ id: "card", name: "Cartão" }];
  C.S.data.transactions = [
    { id: "p1", kind: "expense", paymentMethod: "credit_card", cardId: "card", dueDate: "2026-09-10", status: "paid", amountCents: 9000 },
    { id: "p2", kind: "expense", paymentMethod: "credit_card", cardId: "card", dueDate: "2026-09-10", status: "pending", amountCents: 1000 },
    { id: "payment", kind: "card_payment", invoiceMonth: "2026-09", cardId: "card", status: "paid", amountCents: 9000 },
  ];
  await assert.rejects(() => C.reverseInvoice("card", "2026-09"), /parcelas pendentes/);
  C.S.data.transactions[1].status = "paid";
  await assert.rejects(() => C.reverseInvoice("card", "2026-09"), /valor pago difere/);
  assert.equal(calls.some((x) => x.command === "upsert_entities"), false);
});


test("fatura reaproveita saída existente explicitamente sem duplicar o saldo", async () => {
  const { C, calls } = engine();
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 100_000 }];
  C.S.data.categories = [{ id: "faturas", name: "Faturas 💳", kind: "expense" }];
  C.S.data.cards = [{ id: "card", name: "Cartão", accountId: "bank", dueDay: 10 }];
  C.S.data.transactions = [
    { id: "purchase", kind: "expense", paymentMethod: "credit_card", cardId: "card", amountCents: 20_000, dueDate: "2026-09-10", date: "2026-08-21", status: "pending" },
    { id: "manual", kind: "expense", accountId: "bank", amountCents: 20_000, date: "2026-11-07", status: "paid", categoryId: "faturas", description: "Pagamento fatura cartão" },
  ];
  assert.equal(C.accountBalance("bank"), 80_000);
  await assert.rejects(() => C.settleInvoice("card", "2026-09", "bank", "2026-11-07"), /Vincule/);
  await C.settleInvoice("card", "2026-09", "bank", "2026-11-07", "manual");
  const data = calls.filter((x) => x.command === "upsert_entities").at(-1).args.inputs;
  assert.equal(data.length, 2);
  assert.equal(data.find((x) => x.data.kind === "card_payment").id, "manual");
  C.S.data.transactions = data.map((x) => ({ id: x.id, ...x.data }));
  assert.equal(C.accountBalance("bank"), 80_000);
  assert.equal(C.monthMetrics("2026-11").expensePaid, 20_000);
  await C.reverseInvoice("card", "2026-09", "Desfazer associação com lançamento");
  const undo = calls.filter((x) => x.command === "upsert_entities").at(-1).args.inputs;
  assert.equal(undo.find((x) => x.id === "manual").data.kind, "expense");
  C.S.data.transactions = undo.map((x) => ({ id: x.id, ...x.data }));
  assert.equal(C.accountBalance("bank"), 80_000);
  assert.equal(C.monthMetrics("2026-09").expensePending, 20_000);
});

test("importar CSV duas vezes não duplica fatura nem descarta compras idênticas legítimas", async () => {
  const { C, calls } = engine();
  C.S.data.cards = [{ id: "card", name: "Cartão" }];
  const file = { text: async () => "data;descricao;valor\n08/08/2026;Mercado;25,00\n08/08/2026;Mercado;25,00\n09/08/2026;Farmácia;10,00" };
  assert.equal(await C.importInvoice("card", "2026-09-10", file), 3);
  const batch = calls.find((x) => x.command === "upsert_entities").args.inputs;
  assert.equal(new Set(batch.map((x) => x.id)).size, 3);
  C.S.data.transactions = batch.map((x) => ({ id: x.id, ...x.data }));
  assert.equal(C.invoiceGroups()[0].amountCents, 6000);
  assert.equal(await C.importInvoice("card", "2026-09-10", file), 0);
  assert.equal(calls.filter((x) => x.command === "upsert_entities").length, 1);
  C.S.data.transactions.push({ id: "p", kind: "card_payment", status: "paid", cardId: "card", invoiceMonth: "2026-09", amountCents: 6000 });
  await assert.rejects(() => C.importInvoice("card", "2026-09-10", file), /Fatura já paga/);
});

test("dois pagamentos ativos antigos exigem conciliação explícita, sem apagar linhas", async () => {
  const { C, calls } = engine();
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 100_000 }];
  C.S.data.cards = [{ id: "card", name: "Cartão", accountId: "bank" }];
  C.S.data.transactions = [
    { id: "p", kind: "expense", paymentMethod: "credit_card", cardId: "card", dueDate: "2026-09-10", amountCents: 10_000, status: "paid" },
    { id: "first", kind: "card_payment", cardId: "card", invoiceMonth: "2026-09", accountId: "bank", date: "2026-09-10", amountCents: 10_000, status: "paid" },
    { id: "second", kind: "card_payment", cardId: "card", invoiceMonth: "2026-09", accountId: "bank", date: "2026-09-11", amountCents: 10_000, status: "paid" },
  ];
  assert.equal(C.invoicePaymentConflicts().length, 1);
  assert.equal(C.accountBalance("bank"), 80_000);
  await C.reverseDuplicateInvoicePayment("second", "Duplicado verificado no extrato");
  const updated = calls.find((x) => x.command === "upsert_entity").args.input;
  assert.equal(updated.id, "second");
  C.S.data.transactions[2] = { id: "second", ...updated.data };
  assert.equal(C.invoicePaymentConflicts().length, 0);
  assert.equal(C.accountBalance("bank"), 90_000);
  assert.equal(C.S.data.transactions[2].reversalType, "duplicate_invoice_payment");
  await assert.rejects(() => C.reverseDuplicateInvoicePayment("first"), /não possui pagamentos ativos duplicados/);
});

test("pagamento iniciado duas vezes em paralelo é bloqueado antes de gravar em duplicidade", async () => {
  const { C, calls, window } = engine();
  C.S.data.accounts = [{ id: "bank", openingBalanceCents: 100_000 }];
  C.S.data.cards = [{ id: "card", name: "Cartão", accountId: "bank" }];
  C.S.data.transactions = [{ id: "p", kind: "expense", paymentMethod: "credit_card", cardId: "card", dueDate: "2026-09-10", amountCents: 5000, status: "pending" }];
  let finish;
  window.__TAURI__.core.invoke = async (command, args) => {
    calls.push({ command, args });
    return new Promise((resolve) => { finish = () => resolve(args.inputs.map((x, i) => ({ id: x.id || `generated-${i}`, data: x.data }))); });
  };
  const first = C.settleInvoice("card", "2026-09");
  await assert.rejects(() => C.settleInvoice("card", "2026-09"), /já está sendo processada/);
  finish(); await first;
  assert.equal(calls.filter((x) => x.command === "upsert_entities").length, 1);
});
