(() => {
  const tauriCore = window.__TAURI__?.core;
  const C = window.FSCore;
  const cfg = window.FSCloudConfig || {};
  if (!tauriCore?.invoke || !C || !cfg.supabaseUrl || !cfg.supabasePublishableKey) return;

  const nativeInvoke = tauriCore.invoke.bind(tauriCore);
  const state = {
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
    refreshPromise: null,
    syncPromise: null,
    timer: null,
    lastPassword: "",
  };

  const authBase = `${cfg.supabaseUrl}/auth/v1`;
  const functionBase = `${cfg.supabaseUrl}/functions/v1`;
  const apiHeaders = () => ({
    apikey: cfg.supabasePublishableKey,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });

  class CloudError extends Error {
    constructor(message, status = 0, code = "") {
      super(message);
      this.name = "CloudError";
      this.status = status;
      this.code = code;
    }
  }

  function cloudOnline() {
    return navigator.onLine !== false;
  }

  function clearCloudSession() {
    state.accessToken = "";
    state.refreshToken = "";
    state.expiresAt = 0;
    state.lastPassword = "";
  }

  function setCloudSession(payload, password = "") {
    state.accessToken = payload?.access_token || "";
    state.refreshToken = payload?.refresh_token || "";
    state.expiresAt = Date.now() + Math.max(30, Number(payload?.expires_in || 3600) - 60) * 1000;
    if (password) state.lastPassword = password;
  }

  async function parseResponse(response, fallback) {
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    const message = body?.msg || body?.message || body?.error_description || body?.error || fallback;
    const code = body?.error_code || body?.code || "";
    throw new CloudError(String(message || fallback), response.status, String(code));
  }

  async function signIn(email, password) {
    const response = await fetch(`${authBase}/token?grant_type=password`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ email: String(email || "").trim().toLowerCase(), password }),
    });
    const payload = await parseResponse(response, "Não foi possível autenticar.");
    setCloudSession(payload, password);
    return payload;
  }

  async function signUp(email, password) {
    const response = await fetch(`${authBase}/signup`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ email: String(email || "").trim().toLowerCase(), password }),
    });
    const payload = await parseResponse(response, "Não foi possível criar a conta.");
    if (payload?.access_token) setCloudSession(payload, password);
    return payload;
  }

  async function refreshSession() {
    if (!state.refreshToken) throw new CloudError("Sessão online expirada. Entre novamente.", 401, "session_expired");
    const response = await fetch(`${authBase}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ refresh_token: state.refreshToken }),
    });
    const payload = await parseResponse(response, "Não foi possível renovar a sessão.");
    setCloudSession(payload, state.lastPassword);
    return payload;
  }

  async function token() {
    if (!state.accessToken) throw new CloudError("Sessão online não iniciada.", 401, "no_session");
    if (Date.now() < state.expiresAt) return state.accessToken;
    if (!state.refreshPromise) {
      state.refreshPromise = refreshSession().finally(() => { state.refreshPromise = null; });
    }
    await state.refreshPromise;
    return state.accessToken;
  }

  function networkFailure(error) {
    return error instanceof TypeError || (error instanceof CloudError && (error.status === 0 || error.status >= 500));
  }

  async function reconcile(password) {
    const accessToken = await token();
    return nativeInvoke("cloud_reconcile_login", { accessToken, password });
  }

  async function syncNow() {
    if (!cloudOnline() || !state.accessToken) return null;
    if (state.syncPromise) return state.syncPromise;
    state.syncPromise = (async () => {
      const accessToken = await token();
      const result = await nativeInvoke("cloud_sync", { accessToken });
      const node = document.getElementById("cloudSyncState");
      if (node) node.textContent = result.pending ? `Nuvem: ${result.pending} pendente(s)` : "Nuvem: sincronizado";
      return result;
    })().catch((error) => {
      const node = document.getElementById("cloudSyncState");
      if (node) node.textContent = "Nuvem: sincronização pendente";
      throw error;
    }).finally(() => { state.syncPromise = null; });
    return state.syncPromise;
  }

  function scheduleSync(delay = 600) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => syncNow().catch(() => {}), delay);
  }

  async function ensureCloudWorkspace(status) {
    const workspaceId = status?.activeWorkspaceId;
    if (!workspaceId) return status;
    const workspace = (status.workspaces || []).find((item) => item.id === workspaceId);
    if (!workspace) return status;
    const accessToken = await token();
    await nativeInvoke("cloud_ensure_workspace", {
      accessToken,
      workspaceId,
      name: workspace.name || "Meu Financeiro",
    });
    return status;
  }

  async function bootstrapExistingCloudAccount(password) {
    const reconciled = await reconcile(password);
    if ((reconciled?.workspaces || []).length) {
      await syncNow().catch(() => {});
      return reconciled;
    }
    return null;
  }

  async function cloudOwnerSetup(args) {
    const email = args?.email;
    const password = args?.password;
    const workspaceName = args?.workspaceName || "Meu Financeiro";

    try {
      await signIn(email, password);
      const existing = await bootstrapExistingCloudAccount(password);
      if (existing) return existing;

      const local = await nativeInvoke("auth_setup_owner", { email, password, workspaceName });
      await ensureCloudWorkspace(local);
      const reconciled = await reconcile(password);
      await syncNow().catch(() => {});
      return reconciled;
    } catch (error) {
      if (error instanceof CloudError && [400, 401].includes(error.status)) {
        clearCloudSession();
        const created = await signUp(email, password);
        if (!created?.access_token) {
          throw new Error("Conta criada. Confirme seu e-mail e depois volte ao Finança Simples com o mesmo e-mail e senha.");
        }
        const local = await nativeInvoke("auth_setup_owner", { email, password, workspaceName });
        await ensureCloudWorkspace(local);
        const reconciled = await reconcile(password);
        await syncNow().catch(() => {});
        return reconciled;
      }
      if (networkFailure(error)) {
        return nativeInvoke("auth_setup_owner", { email, password, workspaceName });
      }
      throw error;
    }
  }

  async function cloudLogin(args) {
    if (!cloudOnline()) return nativeInvoke("auth_login", args);
    try {
      await signIn(args?.email, args?.password);
      const reconciled = await reconcile(args?.password);
      if (!(reconciled?.workspaces || []).length) {
        throw new Error("Sua conta está válida, mas ainda não possui um ambiente financeiro. Peça acesso ao administrador ou crie o ambiente pelo primeiro acesso.");
      }
      await syncNow().catch(() => {});
      return reconciled;
    } catch (error) {
      if (networkFailure(error)) return nativeInvoke("auth_login", args);
      clearCloudSession();
      if (error instanceof CloudError && [400, 401].includes(error.status)) throw new Error("E-mail ou senha inválidos.");
      throw error;
    }
  }

  async function requestReset(email) {
    if (!cloudOnline()) {
      return { accepted: true, cloudProviderRequired: false, message: "Conecte o computador à internet para solicitar a redefinição de senha." };
    }
    const redirectTo = cfg.passwordResetRedirect || undefined;
    const endpoint = redirectTo
      ? `${authBase}/recover?redirect_to=${encodeURIComponent(redirectTo)}`
      : `${authBase}/recover`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ email: String(email || "").trim().toLowerCase() }),
      });
      // A resposta visual é deliberadamente uniforme para impedir enumeração de contas.
      if (!response.ok && response.status >= 500) throw new CloudError("Serviço de e-mail temporariamente indisponível.", response.status);
    } catch (error) {
      if (networkFailure(error)) throw new Error("Não foi possível contatar o serviço de recuperação. Verifique a internet e tente novamente.");
    }
    return { accepted: true, cloudProviderRequired: false, message: "Se existir uma conta vinculada a este e-mail, as instruções de recuperação serão enviadas." };
  }

  async function edge(slug, body) {
    const accessToken = await token();
    const response = await fetch(`${functionBase}/${slug}`, {
      method: "POST",
      headers: { ...apiHeaders(), Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    return parseResponse(response, "Operação cloud recusada.");
  }

  async function cloudListMembers(workspaceId) {
    if (!state.accessToken || !cloudOnline()) return nativeInvoke("auth_list_members", { workspaceId });
    const result = await edge("manage-members", { action: "list", workspaceId });
    return result.members || [];
  }

  async function cloudInvite(input) {
    if (!state.accessToken || !cloudOnline()) return nativeInvoke("auth_create_or_grant_user", { input });
    await edge(cfg.inviteFunction || "invite-user", {
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      permissions: input.permissions,
      redirectTo: cfg.passwordResetRedirect || undefined,
    });
    return cloudListMembers(input.workspaceId);
  }

  async function cloudUpdateMember(input) {
    if (!state.accessToken || !cloudOnline()) return nativeInvoke("auth_update_member_permissions", { input });
    await edge("manage-members", {
      action: "update",
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      permissions: input.permissions,
    });
    return cloudListMembers(input.workspaceId);
  }

  async function cloudRemoveMember(args) {
    if (!state.accessToken || !cloudOnline()) return nativeInvoke("auth_remove_member", args);
    await edge("manage-members", {
      action: "remove",
      workspaceId: args.workspaceId,
      userId: args.userId,
    });
    return cloudListMembers(args.workspaceId);
  }

  async function cloudChangePassword(args) {
    if (!state.accessToken || !cloudOnline()) return nativeInvoke("auth_change_password", args);
    const currentEmail = document.querySelector(".identity-user strong")?.textContent || "";
    await signIn(currentEmail, args.currentPassword);
    const accessToken = await token();
    const response = await fetch(`${authBase}/user`, {
      method: "PUT",
      headers: { ...apiHeaders(), Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password: args.newPassword }),
    });
    await parseResponse(response, "Não foi possível alterar a senha.");
    const result = await nativeInvoke("auth_change_password", args);
    state.lastPassword = args.newPassword;
    return result;
  }

  const cloudCommands = new Set([
    "auth_setup_owner", "auth_login", "auth_logout", "auth_create_workspace",
    "auth_list_members", "auth_create_or_grant_user", "auth_update_member_permissions",
    "auth_remove_member", "auth_change_password", "auth_request_password_reset",
    "auth_switch_workspace",
  ]);

  tauriCore.invoke = async function securedCloudInvoke(command, args = {}) {
    if (!cloudCommands.has(command)) return nativeInvoke(command, args);
    if (command === "auth_setup_owner") return cloudOwnerSetup(args);
    if (command === "auth_login") return cloudLogin(args);
    if (command === "auth_request_password_reset") return requestReset(args.email);
    if (command === "auth_list_members") return cloudListMembers(args.workspaceId);
    if (command === "auth_create_or_grant_user") return cloudInvite(args.input);
    if (command === "auth_update_member_permissions") return cloudUpdateMember(args.input);
    if (command === "auth_remove_member") return cloudRemoveMember(args);
    if (command === "auth_change_password") return cloudChangePassword(args);
    if (command === "auth_logout") {
      clearCloudSession();
      return nativeInvoke(command, args);
    }
    if (command === "auth_create_workspace") {
      const status = await nativeInvoke(command, args);
      if (state.accessToken && cloudOnline()) {
        await ensureCloudWorkspace(status);
        scheduleSync(50);
      }
      return status;
    }
    if (command === "auth_switch_workspace") {
      const status = await nativeInvoke(command, args);
      scheduleSync(50);
      return status;
    }
    return nativeInvoke(command, args);
  };

  function installSyncBadge() {
    const foot = document.querySelector(".sidebar-foot");
    if (!foot || document.getElementById("cloudSyncState")) return;
    const node = document.createElement("small");
    node.id = "cloudSyncState";
    node.textContent = state.accessToken ? "Nuvem: sincronizando..." : "Nuvem: login necessário";
    foot.appendChild(node);
  }

  new MutationObserver(installSyncBadge).observe(document.documentElement, { childList: true, subtree: true });
  installSyncBadge();
  window.addEventListener("online", () => scheduleSync(100));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync(150);
  });
  setInterval(() => scheduleSync(0), 15000);

  window.FSCloudRuntime = Object.freeze({
    sync: syncNow,
    isAuthenticated: () => Boolean(state.accessToken),
    clear: clearCloudSession,
  });
})();
