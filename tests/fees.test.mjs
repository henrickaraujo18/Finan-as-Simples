import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function harness(data) {
  const events = new Map();
  const window = {
    FSCore: {
      S: { month: "2026-10", page: "fees", data },
      today: () => "2026-10-13",
      money: (cents) => "R$ " + Number(cents || 0) / 100,
      inputMoney: (cents) => String(Number(cents || 0) / 100).replace(".", ","),
      parseMoney: (v) => Math.round(Number(String(v).replace(",", ".")) * 100),
      accounts: () => [],
      accountName: () => "—",
      buildDate: () => "2026-10-10",
      uid: () => "uuid",
    },
  };
  const document = { addEventListener: (name, cb) => events.set(name, cb), getElementById: () => null };
  const source = readFileSync(new URL("../desktop-dist/fees-v1.js", import.meta.url), "utf8");
  runInNewContext(source, { window, document, console, Date, Blob, URL, setTimeout });
  return window.FSFees;
}

test("dashboard separa competência, caixa e inadimplência", () => {
  const fees = harness({
    fee_clients: [{ id: "c1", name: "Cliente 1" }],
    fee_charges: [
      { id: "h1", clientId: "c1", competence: "2026-10", amountCents: 10000, dueDate: "2026-10-01" },
      { id: "h2", clientId: "c1", competence: "2026-10", amountCents: 5000, dueDate: "2026-10-25" },
    ],
    fee_receipts: [
      { id: "r1", chargeId: "h1", amountCents: 3000, date: "2026-10-12" },
      { id: "r2", chargeId: "h2", amountCents: 5000, date: "2026-11-02" },
    ],
  });
  const metrics = fees.summary("2026-10");
  assert.equal(metrics.expected, 15000);
  assert.equal(metrics.attributed, 8000);
  assert.equal(metrics.collected, 3000);
  assert.equal(metrics.open, 7000);
  assert.equal(metrics.overdue, 7000);
  assert.equal(metrics.overdueCount, 1);
});

test("pagamento parcial mantém cobrança vencida; total quitado", () => {
  const charge = { id: "one", competence: "2026-09", amountCents: 24000, dueDate: "2026-09-10" };
  const data = { fee_clients: [], fee_charges: [charge], fee_receipts: [{ chargeId: "one", amountCents: 8000, date: "2026-09-11" }] };
  const fees = harness(data);
  assert.equal(fees.balance(charge), 16000);
  assert.equal(fees.status(charge), "Vencido");
  data.fee_receipts.push({ chargeId: "one", amountCents: 16000, date: "2026-10-13" });
  assert.equal(fees.balance(charge), 0);
  assert.equal(fees.status(charge), "Quitado");
});

test("CSV respeita aspas e ponto e vírgula dentro de campos", () => {
  const fees = harness({ fee_clients: [], fee_charges: [], fee_receipts: [] });
  const parsed = fees.parseCsv('Código;Razão Social\n"CLI-001";"Empresa; Ltda."');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1][1], "Empresa; Ltda.");
});
