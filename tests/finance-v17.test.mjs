import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(readFileSync(new URL("../desktop-dist/finance-v17.js", import.meta.url), "utf8"), context);
const { simulate } = context.window.FSFinance;
const base = { kind: "investment", principalCents: 1_000_000, contributionCents: 50_000, months: 24, annualRatePercent: 0 };

test("investimento sem juros conserva os aportes", () => {
  const result = simulate(base);
  assert.equal(result.valueCents, 2_200_000);
  assert.equal(result.interestCents, 0);
});

test("taxa efetiva anual é convertida para a taxa mensal equivalente", () => {
  const result = simulate({ ...base, contributionCents: 0, months: 12, annualRatePercent: 12 });
  assert.equal(result.valueCents, 1_120_000);
});

test("empréstimo sem juros e com entrada divide somente o saldo financiado", () => {
  const result = simulate({ ...base, kind: "loan", contributionCents: 200_000, months: 10 });
  assert.equal(result.valueCents, 80_000);
  assert.equal(result.totalCents, 1_000_000);
  assert.equal(result.interestCents, 0);
});

test("consórcio aplica a taxa total de administração sem juros compostos", () => {
  const result = simulate({ ...base, kind: "consortium", months: 20, feePercent: 18 });
  assert.equal(result.totalCents, 1_180_000);
  assert.equal(result.valueCents, 59_000);
});

test("simulador rejeita NaN, prazo fracionário, entrada excessiva e estouro", () => {
  for (const patch of [{ months: NaN }, { months: 2.5 }, { months: 1201 }, { annualRatePercent: Infinity }, { principalCents: -1 }, { kind: "loan", contributionCents: 2_000_000 }, { months: 1200, annualRatePercent: 1000 }]) {
    assert.throws(() => simulate({ ...base, ...patch }));
  }
});
