(() => {
  const C = window.FSCore;
  if (!C) throw new Error("Engine financeira não carregada.");
  const config = window.FS_CONFIG || {};
  const invoke = C.invoke;
  const financialTypes = ["transactions", "accounts", "cards", "categories", "investments", "settings"];
  const backendReady = Boolean(config.supabaseUrl && config.supabasePublishableKey);

  const original = {
    list: C.list,
    save: C.save,
    bulkSave: C.bulkSave,
    remove: C.remove,
    load: C.load,
    saveRegularLaunch: C.saveRegularLaunch,
    saveCardLaunch: C.saveCardLaunch,
    saveTransfer: C.saveTransfer,
    settleTransaction: C.settleTransaction,
    settleInvoice: C.settleInvoice,
    importInvoice: C.importInvoice,
  };

  const state = {
    session: null,
    user: null,
    memberships: [],
    activeWorkspaceId: "",
    activeMembership: null,
    platformAdmin: false,
    authMode: backendReady ? "remote" : "local",
    syncState: "idle",
    initialized: false,
  };

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  let authRefreshTimer = null;
  let syncPromise = null;
  let renderingSecurityUi = false;

  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const stripRow = (row) => {
    const data = { ...row };
    delete data.id;
    delete data._updatedAt;
    delete data._version;
    delete data._syncState;
    return data;
  };
  const currentWorkspaceId = () => state.activeWorkspaceId || "local-personal";
  const isOwnerLike = () => state.platformAdmin || ["owner", "admin"].includes(state.activeMembership?.role);
  const permissions = () => state.activeMembership?.permissions || {};
  const can = (module, action = "view") => {
    if (state.platformAdmin || ["owner", "admin"].includes(state.activeMembership?.role)) return true;
    if (module === "finance" && action === "view" && state.activeMembership) return permissions()?.finance?.view !== false;
    return permissions()?.[module]?.[action] === true;
  };

  function authHeaders(token = state.session?.access_token) {
    const headers = {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function refreshSession() {
    if (!backendReady || !state.session?.refresh_token) return false;
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: authHeaders(null),
      body: JSON.stringify({ refresh_token: state.session.refresh_token }),
    });
    if (!response.ok) return false;
    const session = await response.json();
    state.session = session;
    state.user = session.user;
    state.platformAdmin = session.user?.app_metadata?.platform_admin === true;
    sessionStorage.setItem("fs.auth.session", JSON.stringify(session));
    scheduleRefresh();
    return true;
  }

  async function apiFetch(path, options = {}, retry = true) {
    const response = await fetch(`${config.supabaseUrl}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    if (response.status === 401 && retry && await refreshSession()) return apiFetch(path, options, false);
    return response;
  }

  function scheduleRefresh() {
    clearTimeout(authRefreshTimer);
    if (!state.session?.expires_at) return;
    const delay = Math.max(60_000, state.session.expires_at * 1000 - Date.now() - 5 * 60_000);
    authRefreshTimer = setTimeout(() => refreshSession().catch(() => {}), delay);
  }

  async function signIn(email, password) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHeaders(null),
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.message || "E-mail ou senha inválidos.");
    state.session = payload;
    state.user = payload.user;
    state.platformAdmin = payload.user?.app_metadata?.platform_admin === true;
    sessionStorage.setItem("fs.auth.session", JSON.stringify(payload));
    scheduleRefresh();
    await loadMemberships();
    return payload;
  }

  async function signOut() {
    if (backendReady && state.session?.access_token) {
      try { await apiFetch("/auth/v1/logout", { method: "POST" }); } catch (_) {}
    }
    clearTimeout(authRefreshTimer);
    sessionStorage.removeItem("fs.auth.session");
    sessionStorage.removeItem("fs.activeWorkspaceId");
    location.reload();
  }

  async function requestPasswordReset(email) {
    const body = { email };
    if (config.passwordResetUrl) body.redirect_to = config.passwordResetUrl;
    await fetch(`${config.supabaseUrl}/auth/v1/recover`, {
      method: "POST",
      headers: authHeaders(null),
      body: JSON.stringify(body),
    });
  }

  async function loadMemberships() {
    if (!backendReady || !state.user) return;
    const select = "workspace_id,role,permissions,status,workspaces(id,name,kind,owner_id)";
    const response = await apiFetch(`/rest/v1/workspace_members?select=${encodeURIComponent(select)}&user_id=eq.${encodeURIComponent(state.user.id)}&status=eq.active`);
    if (!response.ok) throw new Error("Não foi possível carregar seus ambientes financeiros.");
    state.memberships = await response.json();
    const saved = sessionStorage.getItem("fs.activeWorkspaceId");
    const selected = state.memberships.find((item) => item.workspace_id === saved) || state.memberships[0];
    if (!selected) throw new Error("Sua conta ainda não possui um ambiente financeiro ativo.");
    state.activeWorkspaceId = selected.workspace_id;
    state.activeMembership = selected;
    sessionStorage.setItem("fs.activeWorkspaceId", selected.workspace_id);
  }

  async function createWorkspace(name, kind = "client") {
    if (!backendReady || !state.user) throw new Error("Backend não conectado.");
    const response = await apiFetch("/rest/v1/workspaces", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name: String(name || "").trim(), kind, owner_id: state.user.id }),
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok) throw new Error(payload.message || payload.error || "Não foi possível criar o ambiente.");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await loadMemberships();
    return payload[0];
  }

  async function callAccessFunction(body) {
    const response = await apiFetch(`/functions/v1/${config.accessFunction || "workspace-access"}`, {
      method: "POST",
      body: JSON.stringify({ ...body, workspaceId: body.workspaceId || currentWorkspaceId() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
    return payload;
  }

  function showAuthGate(message = "") {
    let gate = document.getElementById("authGate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "authGate";
      gate.className = "auth-gate";
      document.body.appendChild(gate);
    }
    gate.innerHTML = `<section class="auth-card"><div class="auth-logo">FS</div><div><h1>Finança Simples</h1><p>Entre para acessar seus ambientes financeiros.</p></div><form id="authLoginForm" class="auth-form"><label>E-mail<input name="email" type="email" required autocomplete="username"></label><label>Senha<input name="password" type="password" required autocomplete="current-password"></label><button class="primary">Entrar</button><button type="button" id="forgotPasswordButton" class="auth-link">Esqueci minha senha</button><span id="authMessage" class="auth-message ${message ? "error" : ""}">${esc(message)}</span></form></section>`;
    gate.classList.remove("hidden");
    gate.querySelector("#authLoginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const msg = gate.querySelector("#authMessage");
      msg.classList.remove("error"); msg.textContent = "Entrando...";
      try {
        await signIn(form.email.value.trim().toLowerCase(), form.password.value);
        gate.classList.add("hidden");
        finishInitialization();
      } catch (error) {
        msg.classList.add("error"); msg.textContent = error.message || String(error);
      }
    });
    gate.querySelector("#forgotPasswordButton")?.addEventListener("click", async () => {
      const email = gate.querySelector("input[name=email]").value.trim().toLowerCase();
      const msg = gate.querySelector("#authMessage");
      if (!email) { msg.classList.add("error"); msg.textContent = "Informe seu e-mail acima."; return; }
      msg.classList.remove("error"); msg.textContent = "Enviando instruções...";
      try {
        await requestPasswordReset(email);
        msg.textContent = "Se existir uma conta com esse e-mail, enviaremos as instruções de redefinição.";
      } catch (_) {
        msg.textContent = "Se existir uma conta com esse e-mail, enviaremos as instruções de redefinição.";
      }
    });
  }

  function finishInitialization() {
    if (state.initialized) return;
    state.initialized = true;
    resolveReady();
    setTimeout(() => { decorateShell(); applyPermissions(); }, 50);
    if (navigator.onLine) setTimeout(() => syncWorkspace().catch(() => {}), 600);
    if (navigator.onLine) setTimeout(() => invoke("check_and_install_update").catch(() => {}), 1400);
  }

  async function initAuth() {
    if (!backendReady) {
      state.user = { id: "local-admin", email: "Administrador local", app_metadata: { platform_admin: true } };
      state.platformAdmin = true;
      state.activeWorkspaceId = "local-personal";
      state.activeMembership = {
        workspace_id: "local-personal",
        role: "owner",
        permissions: { finance: { view: true, write: true }, open_finance: { view: true, manage: true }, investments: { view: true, write: true }, users: { manage: true } },
        workspaces: { id: "local-personal", name: "Pessoal", kind: "personal", owner_id: "local-admin" },
      };
      state.memberships = [state.activeMembership];
      finishInitialization();
      return;
    }

    const cached = sessionStorage.getItem("fs.auth.session");
    if (cached) {
      try {
        state.session = JSON.parse(cached);
        const response = await apiFetch("/auth/v1/user");
        if (response.ok) {
          state.user = await response.json();
          state.platformAdmin = state.user?.app_metadata?.platform_admin === true;
          await loadMemberships();
          scheduleRefresh();
          finishInitialization();
          return;
        }
      } catch (_) {}
      sessionStorage.removeItem("fs.auth.session");
    }
    showAuthGate();
  }

  async function migrateLegacyRows() {
    const wid = currentWorkspaceId();
    if (!wid || sessionStorage.getItem("fs.legacyScoped") === "1") return;
    if (!isOwnerLike()) return;
    for (const type of financialTypes) {
      const rows = await original.list(type);
      for (const row of rows.filter((item) => !item.workspaceId)) {
        await original.save(type, { ...stripRow(row), workspaceId: wid }, row.id);
      }
    }
    sessionStorage.setItem("fs.legacyScoped", "1");
  }

  async function remoteList(type) {
    const response = await apiFetch(`/rest/v1/financial_entities?select=entity_type,local_id,data,version,deleted,updated_at&workspace_id=eq.${encodeURIComponent(currentWorkspaceId())}&entity_type=eq.${encodeURIComponent(type)}&deleted=eq.false`);
    if (!response.ok) throw new Error("Falha ao sincronizar dados financeiros.");
    return response.json();
  }

  async function remoteUpsert(type, row) {
    if (!backendReady || !state.session || !navigator.onLine || !config.syncEnabled) return;
    const payload = {
      workspace_id: currentWorkspaceId(),
      entity_type: type,
      local_id: row.id,
      data: { ...stripRow(row), workspaceId: currentWorkspaceId() },
      version: Number(row._version || 1),
      deleted: false,
      updated_at: row._updatedAt || new Date().toISOString(),
    };
    const response = await apiFetch("/rest/v1/financial_entities?on_conflict=workspace_id,entity_type,local_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Não foi possível enviar uma alteração ao servidor.");
  }

  async function remoteDelete(type, id) {
    if (!backendReady || !state.session || !navigator.onLine || !config.syncEnabled) return;
    const response = await apiFetch(`/rest/v1/financial_entities?workspace_id=eq.${encodeURIComponent(currentWorkspaceId())}&entity_type=eq.${encodeURIComponent(type)}&local_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Não foi possível remover o registro do servidor.");
  }

  async function syncWorkspace() {
    if (!backendReady || !state.session || !navigator.onLine || !config.syncEnabled) return;
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      state.syncState = "syncing";
      try {
        await migrateLegacyRows();
        for (const type of financialTypes) {
          const localRows = (await original.list(type)).filter((row) => row.workspaceId === currentWorkspaceId());
          const remoteRows = await remoteList(type);
          const localMap = new Map(localRows.map((row) => [row.id, row]));
          const remoteMap = new Map(remoteRows.map((row) => [row.local_id, row]));

          for (const remote of remoteRows) {
            const local = localMap.get(remote.local_id);
            const localStamp = String(local?._updatedAt || "");
            const remoteStamp = String(remote.updated_at || "");
            if (!local || remoteStamp > localStamp) {
              await original.save(type, { ...(remote.data || {}), workspaceId: currentWorkspaceId() }, remote.local_id);
            }
          }
          for (const local of localRows) {
            const remote = remoteMap.get(local.id);
            if (!remote || String(local._updatedAt || "") > String(remote.updated_at || "")) await remoteUpsert(type, local);
          }
        }
        state.syncState = "ok";
      } catch (error) {
        state.syncState = "error";
        console.warn("Finança Simples sync:", error);
      } finally {
        syncPromise = null;
        decorateShell();
      }
    })();
    return syncPromise;
  }

  async function scopeCreatedRows(type, result) {
    const rows = Array.isArray(result) ? result : (result ? [result] : []);
    const scoped = [];
    for (const row of rows) {
      const saved = await original.save(type, { ...stripRow(row), workspaceId: currentWorkspaceId() }, row.id);
      scoped.push(saved);
      await remoteUpsert(type, saved).catch(() => {});
    }
    return Array.isArray(result) ? scoped : scoped[0];
  }

  C.save = async (type, data, id = null) => {
    await ready;
    if (!can(type === "investments" ? "investments" : "finance", "write") && type !== "settings") throw new Error("Seu usuário não possui permissão para alterar estes dados.");
    const saved = await original.save(type, { ...data, workspaceId: currentWorkspaceId() }, id);
    await remoteUpsert(type, saved).catch(() => {});
    return saved;
  };
  C.bulkSave = async (items) => {
    await ready;
    if (!can("finance", "write")) throw new Error("Seu usuário não possui permissão para alterar dados financeiros.");
    const prepared = items.map((item) => ({ ...item, data: { ...(item.data || {}), workspaceId: currentWorkspaceId() } }));
    const saved = await original.bulkSave(prepared);
    for (const row of saved) await remoteUpsert(prepared.find((item) => item.id === row.id)?.type || "transactions", row).catch(() => {});
    return saved;
  };
  C.remove = async (type, id) => {
    await ready;
    if (!can(type === "investments" ? "investments" : "finance", "write")) throw new Error("Seu usuário não possui permissão para excluir este registro.");
    const row = (await original.list(type)).find((item) => item.id === id);
    if (row?.workspaceId && row.workspaceId !== currentWorkspaceId()) throw new Error("Registro pertence a outro ambiente financeiro.");
    await original.remove(type, id);
    await remoteDelete(type, id).catch(() => {});
  };
  C.load = async () => {
    await ready;
    await original.load();
    await migrateLegacyRows();
    if (backendReady && navigator.onLine) await syncWorkspace();
    await original.load();
    for (const type of financialTypes) C.S.data[type] = (C.S.data[type] || []).filter((row) => row.workspaceId === currentWorkspaceId() || (!backendReady && !row.workspaceId));
    C.S.settings = { ...C.DEFAULT_SETTINGS, ...(C.S.data.settings[0] || {}) };
    setTimeout(() => { decorateShell(); applyPermissions(); }, 0);
  };
  C.saveRegularLaunch = async (...args) => scopeCreatedRows("transactions", await original.saveRegularLaunch(...args));
  C.saveCardLaunch = async (...args) => scopeCreatedRows("transactions", await original.saveCardLaunch(...args));
  C.saveTransfer = async (...args) => scopeCreatedRows("transactions", await original.saveTransfer(...args));
  C.settleTransaction = async (id) => {
    await original.settleTransaction(id);
    const row = (await original.list("transactions")).find((item) => item.id === id);
    if (row) await scopeCreatedRows("transactions", row);
  };
  C.settleInvoice = async (cardId, invoiceMonth, accountIdOverride = "") => {
    const before = new Set((await original.list("transactions")).map((item) => item.id));
    await original.settleInvoice(cardId, invoiceMonth, accountIdOverride);
    const rows = (await original.list("transactions")).filter((item) => (item.cardId === cardId && item.invoiceMonth === invoiceMonth) || !before.has(item.id));
    for (const row of rows) await scopeCreatedRows("transactions", row);
  };
  C.importInvoice = async (cardId, dueDate, file) => {
    const before = new Set((await original.list("transactions")).map((item) => item.id));
    const count = await original.importInvoice(cardId, dueDate, file);
    const rows = (await original.list("transactions")).filter((item) => !before.has(item.id));
    for (const row of rows) await scopeCreatedRows("transactions", row);
    return count;
  };

  function workspaceName() {
    return state.activeMembership?.workspaces?.name || "Pessoal";
  }

  function decorateShell() {
    if (renderingSecurityUi) return;
    renderingSecurityUi = true;
    try {
      const actions = document.querySelector(".topbar-actions");
      if (actions && !document.getElementById("workspaceSwitcher")) {
        const wrapper = document.createElement("div");
        wrapper.className = "security-topbar";
        wrapper.innerHTML = `<select id="workspaceSwitcher" aria-label="Ambiente financeiro">${state.memberships.map((item) => `<option value="${esc(item.workspace_id)}" ${item.workspace_id === currentWorkspaceId() ? "selected" : ""}>${esc(item.workspaces?.name || "Ambiente")}</option>`).join("")}</select><button id="securityUserButton" class="security-user" title="Conta">${esc((state.user?.email || "U").slice(0,1).toUpperCase())}</button>`;
        actions.prepend(wrapper);
        wrapper.querySelector("#workspaceSwitcher")?.addEventListener("change", (event) => {
          sessionStorage.setItem("fs.activeWorkspaceId", event.target.value);
          location.reload();
        });
        wrapper.querySelector("#securityUserButton")?.addEventListener("click", showAccountModal);
      }

      const nav = document.querySelector(".nav");
      if (nav && can("users", "manage") && !document.getElementById("accessNavButton")) {
        const button = document.createElement("button");
        button.id = "accessNavButton";
        button.type = "button";
        button.innerHTML = "<span>Usuários & Acessos</span>";
        button.addEventListener("click", showAccessModal);
        nav.appendChild(button);
      }
      const storage = document.getElementById("storageLabel");
      if (storage && backendReady) storage.textContent = state.syncState === "syncing" ? "Sincronizando..." : state.syncState === "error" ? "Local · sincronização pendente" : "Local + nuvem";
    } finally { renderingSecurityUi = false; }
  }

  function applyPermissions() {
    const openButton = document.querySelector('.nav button[data-page="openfinance"]');
    const investmentsButton = document.querySelector('.nav button[data-page="investments"]');
    if (openButton) openButton.hidden = !can("open_finance", "view");
    if (investmentsButton) investmentsButton.hidden = !can("investments", "view");

    const page = C.S.page;
    if (["transactions", "accounts", "settings"].includes(page) && !can("finance", "write")) {
      document.querySelectorAll("#view form input,#view form select,#view form button").forEach((el) => { el.disabled = true; });
      document.querySelectorAll('#view button[data-action="delete"],#view button[data-action="edit"],#view button[data-action="settle"],#view button[data-action="payInvoice"]').forEach((el) => { el.disabled = true; });
    }
    if (page === "investments" && !can("investments", "write")) document.querySelectorAll("#investmentForm input,#investmentForm select,#investmentForm button").forEach((el) => { el.disabled = true; });
    decorateShell();
  }

  function modalShell(id, content) {
    document.getElementById(id)?.remove();
    const modal = document.createElement("div");
    modal.id = id;
    modal.className = "security-modal-backdrop";
    modal.innerHTML = `<section class="security-modal">${content}</section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal || event.target.closest("[data-close-security]")) modal.remove(); });
    return modal;
  }

  function showAccountModal() {
    const modal = modalShell("accountSecurityModal", `<div class="security-modal-head"><div><h2>Conta</h2><small>${esc(workspaceName())}</small></div><button class="ghost" data-close-security>Fechar</button></div><div class="security-account"><div><span>Usuário</span><strong>${esc(state.user?.email || "Administrador local")}</strong></div><div><span>Perfil</span><strong>${esc(state.platformAdmin ? "Administrador da plataforma" : state.activeMembership?.role || "—")}</strong></div><div><span>Sincronização</span><strong>${esc(backendReady ? (state.syncState === "ok" ? "Atualizada" : state.syncState === "syncing" ? "Em andamento" : "Pendente") : "Modo local")}</strong></div></div><div class="button-row"><button id="syncNowButton" class="ghost" ${backendReady ? "" : "disabled"}>Sincronizar agora</button><button id="logoutButton" class="danger ghost" ${backendReady ? "" : "disabled"}>Sair da conta</button></div>`);
    modal.querySelector("#syncNowButton")?.addEventListener("click", async (event) => { event.currentTarget.disabled = true; await syncWorkspace(); event.currentTarget.disabled = false; modal.remove(); });
    modal.querySelector("#logoutButton")?.addEventListener("click", signOut);
  }

  async function showAccessModal() {
    const modal = modalShell("workspaceAccessModal", `<div class="security-modal-head"><div><h2>Usuários & Acessos</h2><small>${esc(workspaceName())}</small></div><button class="ghost" data-close-security>Fechar</button></div><div id="accessModalBody" class="security-loading">Carregando...</div>`);
    const body = modal.querySelector("#accessModalBody");
    if (!backendReady) {
      body.innerHTML = `<div class="notice"><strong>Backend ainda não conectado.</strong><span>A estrutura de usuários está pronta; após a ativação do servidor, convites e ambientes separados ficam disponíveis.</span></div>`;
      return;
    }
    try {
      const result = await callAccessFunction({ action: "list_members" });
      renderAccessBody(body, result.members || []);
    } catch (error) {
      body.innerHTML = `<div class="notice warn"><strong>Não foi possível carregar os acessos.</strong><span>${esc(error.message || String(error))}</span></div>`;
    }
  }

  function permissionCheckbox(name, label, checked) {
    return `<label class="permission-check"><input type="checkbox" name="${esc(name)}" ${checked ? "checked" : ""}><span>${esc(label)}</span></label>`;
  }

  function permissionsFromForm(form) {
    return {
      finance: { view: true, write: form.financeWrite.checked },
      open_finance: { view: form.openView.checked, manage: form.openManage.checked },
      investments: { view: form.investView.checked, write: form.investWrite.checked },
      users: { manage: form.usersManage.checked },
    };
  }

  function renderAccessBody(container, members) {
    container.innerHTML = `<div class="security-access-grid"><section><h3>Novo ambiente financeiro</h3><form id="newWorkspaceForm" class="security-form"><label>Nome<input name="name" required placeholder="Ex.: Empresa Cliente ABC"></label><label>Tipo<select name="kind"><option value="client">Cliente</option><option value="business">Empresa</option><option value="personal">Pessoal</option></select></label><button class="ghost">Criar ambiente</button><span class="security-form-msg"></span></form></section><section><h3>Convidar usuário</h3><form id="inviteUserForm" class="security-form"><label>E-mail<input name="email" type="email" required></label><label>Perfil<select name="role"><option value="viewer">Consulta</option><option value="editor">Operador</option><option value="admin">Administrador</option><option value="custom">Personalizado</option></select></label><div class="permissions-box">${permissionCheckbox("financeWrite","Alterar dados financeiros",false)}${permissionCheckbox("openView","Visualizar Open Finance",false)}${permissionCheckbox("openManage","Gerenciar Open Finance",false)}${permissionCheckbox("investView","Visualizar investimentos",false)}${permissionCheckbox("investWrite","Alterar investimentos",false)}${permissionCheckbox("usersManage","Gerenciar usuários",false)}</div><button class="primary">Enviar convite</button><span class="security-form-msg"></span></form></section></div><section class="security-members"><h3>Usuários deste ambiente</h3><div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Financeiro</th><th>Open Finance</th><th>Investimentos</th><th>Status</th><th></th></tr></thead><tbody>${members.map((member) => `<tr><td>${esc(member.profile?.display_name || member.profile?.email || member.user_id)}</td><td>${esc(member.role)}</td><td>${member.permissions?.finance?.write ? "Editar" : "Consulta"}</td><td>${member.permissions?.open_finance?.manage ? "Gerenciar" : member.permissions?.open_finance?.view ? "Ver" : "Sem acesso"}</td><td>${member.permissions?.investments?.write ? "Editar" : member.permissions?.investments?.view ? "Ver" : "Sem acesso"}</td><td>${esc(member.status)}</td><td>${member.role !== "owner" ? `<button class="danger ghost compact" data-remove-member="${esc(member.id)}">Remover</button>` : "Proprietário"}</td></tr>`).join("")}</tbody></table></div></section>`;

    const workspaceForm = container.querySelector("#newWorkspaceForm");
    workspaceForm?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget, msg = form.querySelector(".security-form-msg"); msg.textContent = "Criando...";
      try { const created = await createWorkspace(form.name.value, form.kind.value); if (created?.id) sessionStorage.setItem("fs.activeWorkspaceId", created.id); location.reload(); }
      catch (error) { msg.textContent = error.message || String(error); msg.classList.add("error"); }
    });

    const inviteForm = container.querySelector("#inviteUserForm");
    inviteForm?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget, msg = form.querySelector(".security-form-msg"); msg.classList.remove("error"); msg.textContent = "Enviando convite...";
      try {
        await callAccessFunction({ action: "invite", email: form.email.value.trim().toLowerCase(), role: form.role.value, permissions: permissionsFromForm(form) });
        msg.textContent = "Convite enviado."; setTimeout(() => showAccessModal(), 350);
      } catch (error) { msg.textContent = error.message || String(error); msg.classList.add("error"); }
    });

    container.querySelectorAll("[data-remove-member]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("Remover o acesso deste usuário?")) return;
      try { await callAccessFunction({ action: "remove_member", memberId: button.dataset.removeMember }); showAccessModal(); }
      catch (error) { alert(error.message || String(error)); }
    }));
  }

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("button[data-page]");
    if (!nav) return;
    if (nav.dataset.page === "openfinance" && !can("open_finance", "view")) { event.preventDefault(); event.stopImmediatePropagation(); alert("Seu usuário não possui acesso ao Open Finance."); }
    if (nav.dataset.page === "investments" && !can("investments", "view")) { event.preventDefault(); event.stopImmediatePropagation(); alert("Seu usuário não possui acesso a Investimentos."); }
  }, true);

  const observer = new MutationObserver(() => { if (state.initialized) { decorateShell(); applyPermissions(); } });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("online", () => {
    if (!state.initialized) return;
    syncWorkspace().catch(() => {});
    if (config.updateCheckOnReconnect) invoke("check_and_install_update").catch(() => {});
  });

  window.FSSecurity = { state, ready, can, syncWorkspace, signOut, showAccessModal, createWorkspace };
  initAuth().catch((error) => showAuthGate(error.message || String(error)));
})();
