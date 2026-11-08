const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function scenario({ paymentDate, orphanAccount = false }) {
  const entities = [];
  const ctx = {
    window: {
      __TAURI__: { core: { invoke: async (command, args) => {
        if (command !== "upsert_entities") throw new Error(`Unexpected backend command: ${command}`);
        return args.inputs.map((input, index) => {
          const id = input.id || `new-payment-${index}`;
          const entity = { id, data: input.data, updatedAt: "2026-11-07T10:00:00Z" };
          const existing = ctx.window.FSCore.S.data.transactions.findIndex((item) => item.id === id);
          const item = { id, ...input.data, _updatedAt: entity.updatedAt };
          if (existing >= 0) ctx.window.FSCore.S.data.transactions[existing] = item;
          else ctx.window.FSCore.S.data.transactions.push(item);
          entities.push(entity);
          return entity;
        });
      } } },
    },
    crypto: { randomUUID: () => "id-for-test" },
    console, Intl, Date, Number, String, Array, Map, Set, Math,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("desktop-dist/core-v14.js", "utf8"), ctx, { filename: "core-v14.js" });
  const C = ctx.window.FSCore;
  C.S.settings.openingBalanceCents = 100000;
  C.S.data.accounts = [{ id: "bank", name: "Banco", openingBalanceCents: 0 }];
  C.S.data.cards = [{ id: "card", name: "Cartão", dueDay: 10, accountId: orphanAccount ? "deleted-bank" : "bank" }];
  C.S.data.categories = [{ id: "invoice-category", kind: "expense", name: "Faturas 💳" }];
  C.S.data.transactions = [{
    id: "purchase", kind: "expense", paymentMethod: "credit_card", cardId: "card",
    invoiceMonth: "2026-11", // registro legado incorreto: vencimento de setembro
    date: "2026-08-15", purchaseDate: "2026-08-15", dueDate: "2026-09-10",
    status: "pending", amountCents: 20000,
  }];
  assert.equal(C.invoiceGroups().length, 1);
  assert.equal(C.invoiceGroups()[0].invoiceMonth, "2026-09", "deve usar vencimento, nunca invoiceMonth divergente");
  assert.equal(C.invoiceGroups().filter((g) => g.invoiceMonth === "2026-11").length, 0);
  assert.equal(C.totalCashBalance("2026-09-30"), 100000, "compra não reduz caixa antes da fatura");
  return C.settleInvoice("card", "2026-09", "", paymentDate).then(() => {
    assert.equal(C.invoiceGroups()[0].pendingCents, 0);
    assert.equal(C.S.data.transactions.filter((t) => t.kind === "card_payment").length, 1);
    assert.equal(C.totalCashBalance("2026-11-30"), 80000, "pagamento descontado do saldo global");
    if (paymentDate.startsWith("2026-09")) {
      assert.equal(C.totalCashBalance("2026-09-30"), 80000, "pagamento em setembro desconta setembro");
      assert.equal(C.monthMetrics("2026-09").expensePaid, 20000);
      assert.equal(C.monthMetrics("2026-11").expensePaid, 0);
    } else {
      assert.equal(C.totalCashBalance("2026-09-30"), 100000, "pagamento em novembro não altera setembro");
      assert.equal(C.monthMetrics("2026-11").expensePaid, 20000, "despesa efetiva segue data do pagamento");
      assert.equal(C.monthMetrics("2026-09").invoiceGroupsMonth.length, 1, "fatura continua na competência setembro");
    }
    return C;
  });
}
(async () => {
  await scenario({ paymentDate: "2026-09-15" });
  await scenario({ paymentDate: "2026-11-07" });
  await scenario({ paymentDate: "2026-11-07", orphanAccount: true });
  console.log("OK: 3 cenários: fatura setembro, baixa setembro/novembro, conta vinculada/desvinculada.");
})().catch((err) => { console.error(err); process.exitCode = 1; });
