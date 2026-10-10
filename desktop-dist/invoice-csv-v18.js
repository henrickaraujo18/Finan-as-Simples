(() => {
  "use strict";
  const norm = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const digits = (value) => String(value || "").replace(/\D/g, "");

  function decode(bytes) {
    const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (array[0] === 0xff && array[1] === 0xfe) return { text: new TextDecoder("utf-16le", { fatal: true }).decode(array), encoding: "UTF-16 LE" };
    if (array[0] === 0xfe && array[1] === 0xff) return { text: new TextDecoder("utf-16be", { fatal: true }).decode(array), encoding: "UTF-16 BE" };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(array), encoding: "UTF-8" }; }
    catch { return { text: new TextDecoder("windows-1252").decode(array), encoding: "Windows-1252 / ISO-8859-1" }; }
  }

  // Parse quoted fields, delimiters and line breaks without discarding empty fields.
  function records(text, delimiter) {
    const result = []; let cells = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) { cells.push(field.trim()); field = ""; }
      else if ((char === "\r" || char === "\n") && !quoted) {
        cells.push(field.trim());
        if (cells.some(Boolean)) result.push(cells);
        cells = []; field = "";
        if (char === "\r" && text[i + 1] === "\n") i++;
      } else { field += char; }
    }
    if (quoted) throw new Error("CSV inválido: há aspas sem fechamento.");
    cells.push(field.trim());
    if (cells.some(Boolean)) result.push(cells);
    return result;
  }
  function delimiterOf(header) {
    const count = (delimiter) => records(`${header}\n`, delimiter)[0]?.length || 0;
    return count(";") >= count(",") ? ";" : ",";
  }
  function validDate(value, line) {
    const v = String(value || "").trim();
    const br = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!br && !iso) throw new Error(`Linha ${line}: data inválida (${v || "vazia"}).`);
    const y = Number(iso ? iso[1] : br[3].length === 2 ? `20${br[3]}` : br[3]);
    const m = Number(iso ? iso[2] : br[2]); const d = Number(iso ? iso[3] : br[1]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) throw new Error(`Linha ${line}: data inexistente (${v}).`);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function cents(value, line) {
    let v = String(value ?? "").replace(/R\$/gi, "").replace(/[\s\u00a0]/g, "").trim();
    if (!v) throw new Error(`Linha ${line}: valor vazio.`);
    const negative = v.startsWith("-") || /^\(.*\)$/.test(v) || v.endsWith("-");
    v = v.replace(/[()+-]/g, "");
    if (!/^[\d.,]+$/.test(v)) throw new Error(`Linha ${line}: valor monetário inválido.`);
    const lastComma = v.lastIndexOf(","), lastDot = v.lastIndexOf(".");
    const separator = Math.max(lastComma, lastDot);
    let amount;
    if (separator >= 0 && v.length - separator - 1 <= 2) {
      const major = digits(v.slice(0, separator)); const minor = digits(v.slice(separator + 1));
      amount = Number(major) * 100 + Number(minor.padEnd(2, "0"));
    } else if (separator >= 0 && v.length - separator - 1 === 3) amount = Number(digits(v)) * 100;
    else if (separator === -1) amount = Number(v) * 100;
    else throw new Error(`Linha ${line}: formato de valor ambíguo (${v}).`);
    if (!Number.isSafeInteger(amount)) throw new Error(`Linha ${line}: valor fora do limite.`);
    if (!amount) throw new Error(`Linha ${line}: lançamento de valor zero.`);
    return negative ? -amount : amount;
  }
  function installments(description) {
    const match = String(description).match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
    if (!match) return { number: 1, count: 1 };
    const number = Number(match[1]), count = Number(match[2]);
    return number >= 1 && count >= number && count <= 60 ? { number, count } : { number: 1, count: 1 };
  }
  function parse(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "");
    const headerLine = raw.split(/\r?\n/, 1)[0];
    const rows = records(raw, delimiterOf(headerLine));
    if (rows.length < 2) throw new Error("O arquivo CSV não contém lançamentos.");
    const headers = rows[0].map(norm);
    const index = (names) => headers.findIndex((header) => names.some((name) => header.includes(name)));
    const date = index(["data", "date"]), description = index(["descricao", "historico", "estabelecimento", "description"]), amount = index(["valor", "amount"]);
    if (date < 0 || description < 0 || amount < 0) throw new Error("CSV precisa das colunas Data, Descrição/Histórico e Valor.");
    return rows.slice(1).map((r, idx) => {
      const line = idx + 2, desc = String(r[description] || "").trim();
      if (!desc) throw new Error(`Linha ${line}: descrição vazia.`);
      const value = cents(r[amount], line);
      return { line, date: validDate(r[date], line), description: desc, amountCents: value, ...installments(desc) };
    });
  }
  function fingerprint(row) {
    const part = row.installmentNumber || row.number || 1, count = row.installmentCount || row.count || 1;
    return [row.purchaseDate || row.date, norm(row.description).replace(/\s+/g, " "), Number(row.amountCents), part, count].join("|");
  }
  function categorize(row, categories, fallback = "") {
    const desc = norm(row.description);
    const rules = [
      [/supermerc|mercad|atacad|carnes|acougu|feira/, ["mercado", "alimentacao"]],
      [/posto|combust|gasolina|etanol|uber|99pop|estacion/, ["transporte"]],
      [/farmac|drogari|clinica|medic|suplement/, ["saude"]],
      [/netflix|spotify|prime video|disney|assinatura/, ["assinatura"]],
      [/escola|faculd|livraria|curso/, ["educacao"]],
      [/restaur|lanch|pizza|ifood/, ["alimentacao", "lazer"]],
      [/agricol|ferragen|loja|magazine|shop/, ["compras"]],
    ];
    const names = rules.find(([pattern]) => pattern.test(desc))?.[1] || [];
    const candidate = categories.find((item) => item.kind === "expense" && item.active !== false && names.some((name) => norm(item.name).includes(name)));
    return candidate?.id || fallback || "";
  }
  function prepare(parsed, existing, cardId, invoiceMonth, categories, fallback = "", now = "") {
    const duplicates = new Map();
    for (const row of existing) {
      if (row.cardId !== cardId || row.invoiceMonth !== invoiceMonth || row.paymentMethod !== "credit_card") continue;
      const key = fingerprint(row);
      duplicates.set(key, (duplicates.get(key) || 0) + 1);
    }
    const entries = parsed.map((r) => {
      const key = fingerprint(r);
      const count = duplicates.get(key) || 0;
      if (count) duplicates.set(key, count - 1);
      return { ...r, duplicate: count > 0, categoryId: categorize(r, categories, fallback), future: !!now && r.date > now };
    });
    return { entries, duplicates: entries.filter((r) => r.duplicate).length,
      eligible: entries.filter((r) => !r.duplicate).length,
      totalCents: entries.filter((r) => !r.duplicate).reduce((sum, r) => sum + r.amountCents, 0),
      allTotalCents: entries.reduce((sum, r) => sum + r.amountCents, 0) };
  }
  const api = Object.freeze({ decode, parse, prepare, fingerprint, categorize, cents });
  if (typeof window !== "undefined") window.FSInvoiceCSV = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
