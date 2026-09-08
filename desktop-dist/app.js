const invoke = window.__TAURI__?.core?.invoke;

const state = {
  dashboard: null,
  runtime: null,
  online: navigator.onLine,
};

const el = (id) => document.getElementById(id);

function formatMoney(cents = 0) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(cents) / 100);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseCurrencyToCents(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function localDateInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function renderConnectivity() {
  state.online = navigator.onLine;
  const text = state.online ? "Online" : "Offline";
  el("connectionLabel").textContent = text;
  el("connectionBadge").textContent = state.online ? "Online" : "Modo offline";
  el("connectionBadge").classList.toggle("online", state.online);
  el("connectionDot").classList.toggle("online", state.online);
  el("offlineBanner").classList.toggle("visible", !state.online);

  document.querySelectorAll("[data-online-service]").forEach((tag) => {
    tag.textContent = state.online ? "requer backend" : "offline";
    tag.classList.toggle("available", state.online);
  });
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return;

  el("balance").textContent = formatMoney(data.balanceCents);
  el("incomeMonth").textContent = formatMoney(data.incomeMonthCents);
  el("expenseMonth").textContent = formatMoney(data.expenseMonthCents);
  el("pendingSync").textContent = String(data.pendingSync ?? 0);
  el("pendingSyncHint").textContent = state.online
    ? "aguardando envio ao servidor"
    : "salvos com segurança no computador";

  const list = el("transactionList");
  if (!data.recentTransactions?.length) {
    list.innerHTML = '<div class="empty">Nenhum lançamento local ainda.</div>';
    return;
  }

  list.innerHTML = data.recentTransactions
    .map((item) => {
      const sign = item.kind === "income" ? "+" : "−";
      const kindClass = item.kind === "income" ? "income" : "expense";
      return `
        <div class="transaction">
          <div>
            <strong>${escapeHtml(item.description)}</strong>
            <small>${escapeHtml(item.categoryName)} · ${formatDate(item.occurredAt)}</small>
          </div>
          <div>
            <div class="amount ${kindClass}">${sign}${formatMoney(item.amountCents)}</div>
            ${item.syncState === "pending" ? '<div class="sync">sincronização pendente</div>' : ""}
          </div>
        </div>`;
    })
    .join("");
}

async function refreshDashboard() {
  state.dashboard = await invoke("dashboard");
  renderDashboard();
}

function showFormMessage(message, type = "") {
  const node = el("formMessage");
  node.textContent = message;
  node.className = `form-message ${type}`.trim();
}

async function saveTransaction(event) {
  event.preventDefault();
  const submit = el("saveTransaction");
  submit.disabled = true;
  showFormMessage("Salvando no banco local...");

  try {
    const amountCents = parseCurrencyToCents(el("amount").value);
    if (!amountCents) throw new Error("Informe um valor válido maior que zero.");

    const selectedDate = el("occurredAt").value;
    const occurredAt = selectedDate
      ? new Date(`${selectedDate}T12:00:00`).toISOString()
      : null;

    await invoke("create_transaction", {
      input: {
        kind: el("kind").value,
        description: el("description").value,
        amountCents,
        occurredAt,
        accountId: null,
        categoryId: null,
      },
    });

    el("transactionForm").reset();
    el("occurredAt").value = localDateInputValue();
    showFormMessage(
      state.online
        ? "Lançamento salvo localmente e colocado na fila de sincronização."
        : "Lançamento salvo. Ele será sincronizado quando houver conexão.",
      "success",
    );
    await refreshDashboard();
  } catch (error) {
    showFormMessage(String(error?.message ?? error), "error");
  } finally {
    submit.disabled = false;
  }
}

function focusQuickEntry() {
  el("description").focus();
  el("entryPanel").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function boot() {
  renderConnectivity();
  el("occurredAt").value = localDateInputValue();

  if (!invoke) {
    el("fatalError").hidden = false;
    el("fatalError").textContent =
      "O núcleo Tauri não foi carregado. Reinstale o aplicativo usando uma versão oficial.";
    return;
  }

  try {
    state.runtime = await invoke("runtime_status");
    el("storageLabel").textContent = state.runtime.storage;
    await refreshDashboard();
  } catch (error) {
    el("fatalError").hidden = false;
    el("fatalError").textContent = `Falha ao abrir o banco local: ${String(error)}`;
  }
}

window.addEventListener("online", async () => {
  renderConnectivity();
  await refreshDashboard().catch(() => {});
});
window.addEventListener("offline", renderConnectivity);

el("transactionForm").addEventListener("submit", saveTransaction);
el("newEntry").addEventListener("click", focusQuickEntry);
el("refreshDashboard").addEventListener("click", () => refreshDashboard().catch((error) => {
  el("fatalError").hidden = false;
  el("fatalError").textContent = String(error);
}));

boot();
