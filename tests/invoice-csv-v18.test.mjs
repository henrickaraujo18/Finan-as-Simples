import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const csv = require('../desktop-dist/invoice-csv-v18.js');

test('CSV Bradesco Windows-1252 lê cabeçalho acentuado e preserva centavos', () => {
  const bytes = Uint8Array.from(Buffer.from('Data;Descrição;Valor\r\n18/09/2026;AGRICOLA ANDRAD 1/2;50,5\r\n', 'latin1'));
  const { text, encoding } = csv.decode(bytes);
  assert.match(encoding, /1252/);
  assert.deepEqual(csv.parse(text), [{ line: 2, date: '2026-09-18', description: 'AGRICOLA ANDRAD 1/2', amountCents: 5050, number: 1, count: 2 }]);
});
test('UTF-8, aspas, vírgula e quebras de linha', () => {
  const rows = csv.parse('Data,Descrição,Valor\n"01/10/2026","Mercado, Loja","1.234,56"\n"02/10/2026","Texto\ncom linha",-12.50');
  assert.equal(rows[0].amountCents, 123456);
  assert.equal(rows[0].description, 'Mercado, Loja');
  assert.equal(rows[1].description, 'Texto\ncom linha');
  assert.equal(rows[1].amountCents, -1250);
});
test('duplicatas descontam ocorrências existentes, mas não eliminam compras idênticas válidas', () => {
  const source = csv.parse('Data;Descrição;Valor\n01/10/2026;Mercado;25,00\n01/10/2026;Mercado;25,00\n02/10/2026;Estorno;-5,00');
  const existing = [{ cardId: 'a', invoiceMonth: '2026-11', paymentMethod: 'credit_card', date: '2026-10-01', purchaseDate: '2026-10-01', description: 'Mercado', amountCents: 2500 }];
  const result = csv.prepare(source, existing, 'a', '2026-11', [], '', '2026-10-10');
  assert.equal(result.duplicates, 1);
  assert.equal(result.eligible, 2);
  assert.equal(result.totalCents, 2000);
  assert.deepEqual(result.entries.map(item=>item.duplicate), [true, false, false]);
});
test('parcelas existentes em uma fatura não criam pagamentos futuros', () => {
  const rows = csv.parse('Data;Descrição;Valor\n16/09/2026;LOJA 4/12;120,15');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].number, 4);
  assert.equal(rows[0].count, 12);
  assert.equal(rows[0].amountCents, 12015);
});
test('recusa datas e valores incorretos sem ignorar linhas', () => {
  assert.throws(()=>csv.parse('Data;Descrição;Valor\n31/02/2026;Teste;22,00'), /data inexistente/);
  assert.throws(()=>csv.parse('Data;Descrição;Valor\n02/10/2026;Teste;0'), /valor zero/);
  assert.throws(()=>csv.parse('Data;Descrição;Valor\n02/10/2026;Teste;25,xx'), /inválido/);
});
test('importador antigo e compras manuais parceladas são detectados como duplicatas', () => {
  const parsed = csv.parse('Data;Descrição;Valor\n01/10/2026;LOJA 1/4;25,00');
  const old = [{ cardId: 'a', invoiceMonth: '2026-11', paymentMethod: 'credit_card', date: '2026-10-01', description: 'LOJA 1/4', amountCents: 2500, installmentNumber: 1, installmentCount: 1 }];
  const manual = [{ ...old[0], description: 'LOJA', installmentCount: 4 }];
  assert.equal(csv.prepare(parsed,old,'a','2026-11',[]).duplicates,1);
  assert.equal(csv.prepare(parsed,manual,'a','2026-11',[]).duplicates,1);
});
