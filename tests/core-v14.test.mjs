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
  return { C: context.window.FSCore, calls };
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
