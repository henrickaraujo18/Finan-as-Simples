(() => {
  const C = window.FSCore;
  const rawInvoke = window.__TAURI__?.core?.invoke;
  if (!C || !rawInvoke) return;

  const originalLoad = C.load;
  const auth = {
    status: null,
    gateShown: false,
    updateChecked: false,
    editingMemberId: null,
    switching: false,
    workspaceLocks: 0,
  };

  const MODULES = [
    ["dashboard", "Dashboard"],
    ["transactions", "Lançamentos"],
    ["accounts", "Contas & Cartões"],
    ["analytics", "Dashboard Analítico"],
    ["openFinance", "Open Finance"],
    ["investments", "Investimentos"],
    ["exports", "Exportações"],
    ["settings", "Parametrização"],
    ["users", "Usuários & Acessos"],
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const formObject = (form) => Object.fromEntries(new FormData(form).entries());

  function modulePermission(module, action = "view") {
    return Boolean(auth.status?.permissions?.[module]?.[action]);
  }

  window.FSAuth = {
    can: modulePermission,
    workspaceId: () => auth.status?.activeWorkspaceId || "",
    lockWorkspace() {
      if (auth.switching || !auth.status?.authenticated) throw new Error("Aguarde a entrada no ambiente financeiro.");
      auth.workspaceLocks += 1;
      const selector = $("workspaceSelector");
      if (selector) selector.disabled = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        auth.workspaceLocks -= 1;
        const current = $("workspaceSelector");
        if (current) current.disabled = auth.switching || auth.workspaceLocks > 0;
      };
    },
  };

  function cloudConfigured() {
    const config = window.FSCloudConfig || {};
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  }

  function roleLabel(role) {
    return ({ owner: "Proprietário", admin: "Administrador", operator: "Operador", viewer: "Consulta", custom: "Personalizado" })[role] || role;
  }

  function statusMessage(element, text, error = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("error", error);
  }

  function gateRoot() {
    let root = $("authGate");
    if (!root) {
      root = document.createElement("div");
      root.id = "authGate";
      root.className = "auth-gate hidden";
      document.body.appendChild(root);
    }
    return root;
  }

  async function respectStartupBrand() {
    if (auth.gateShown) return;
    auth.gateShown = true;
    await sleep(5100);
  }

  function setupScreen(message = "") {
    return `<div class="auth-card auth-card-wide">
      <div class="auth-logo">FS</div>
      <div class="auth-heading"><span>Primeiro acesso</span><h2>Proteja seu Finança Simples</h2><p>Crie a conta proprietária. Os dados financeiros existentes serão vinculados automaticamente ao seu ambiente principal.</p></div>
      <form id="ownerSetupForm" class="auth-form">
        <label>E-mail<input name="email" type="email" autocomplete="email" required placeholder="seu@email.com"></label>
        <label>Senha<input name="password" type="password" autocomplete="new-password" minlength="10" required placeholder="Mínimo de 10 caracteres"></label>
        <label>Confirmar senha<input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required></label>
        <label>Nome do ambiente financeiro<input name="workspaceName" maxlength="120" value="Meu Financeiro" required></label>
        <button class="primary auth-primary">Criar conta proprietária</button>
        <span id="authMessage" class="auth-message ${message ? "error" : ""}">${esc(message)}</span>
      </form>
      <div class="auth-security-note"><strong>Senha protegida com Argon2id</strong><span>A senha não é armazenada em texto legível no banco local.</span></div>
    </div>`;
  }

  function loginScreen(message = "") {
    return `<div class="auth-card">
      <div class="auth-logo">FS</div>
      <div class="auth-heading"><span>Acesso seguro</span><h2>Finança Simples</h2><p>Entre com seu e-mail e senha para acessar seus ambientes financeiros.</p></div>
      <form id="loginForm" class="auth-form">
        <label>E-mail<input name="email" type="email" autocomplete="email" required placeholder="seu@email.com"></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary auth-primary">Entrar</button>
        <button type="button" class="auth-link" data-auth-action="forgot">Esqueci minha senha</button>
        <span id="authMessage" class="auth-message ${message ? "error" : ""}">${esc(message)}</span>
      </form>
      <div class="auth-security-note"><strong>Ambientes isolados</strong><span>Cada cliente ou perfil financeiro mantém registros separados e permissões próprias.</span></div>
    </div>`;
  }

  function resetScreen() {
    return `<div class="auth-card">
      <div class="auth-logo">FS</div>
      <div class="auth-heading"><span>Recuperação de acesso</span><h2>Redefinir senha</h2><p>Informe seu e-mail. A resposta não confirma se a conta existe, protegendo sua privacidade.</p></div>
      <form id="resetForm" class="auth-form">
        <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
        <button class="primary auth-primary">Enviar instruções</button>
        <button type="button" class="auth-link" data-auth-action="back-login">Voltar para entrar</button>
        <span id="authMessage" class="auth-message"></span>
      </form>
    </div>`;
  }

  function bindGate(resolve) {
    $("ownerSetupForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formObject(event.currentTarget);
      const message = $("authMessage");
      if (values.password !== values.confirmPassword) {
        return statusMessage(message, "As senhas não coincidem.", true);
      }
      statusMessage(message, "Criando sua conta...");
      try {
        const result = await rawInvoke("auth_setup_owner", {
          email: values.email,
          password: values.password,
          workspaceName: values.workspaceName,
        });
        resolve(result);
      } catch (error) {
        statusMessage(message, error?.message || String(error), true);
      }
    });

    $("loginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formObject(event.currentTarget);
      const message = $("authMessage");
      statusMessage(message, "Validando acesso...");
      try {
        const result = await rawInvoke("auth_login", { email: values.email, password: values.password });
        resolve(result);
      } catch (error) {
        statusMessage(message, error?.message || String(error), true);
      }
    });

    $("resetForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formObject(event.currentTarget);
      const message = $("authMessage");
      statusMessage(message, "Processando solicitação...");
      try {
        const result = await rawInvoke("auth_request_password_reset", { email: values.email });
        const suffix = cloudConfigured()
          ? ""
          : " Conecte o backend de identidade para habilitar o envio por e-mail.";
        statusMessage(message, `${result.message}${suffix}`);
      } catch (error) {
        statusMessage(message, "Se existir uma conta vinculada a este e-mail, as instruções de recuperação serão enviadas.");
      }
    });
  }

  function showAuthGate(status) {
    return new Promise((resolve) => {
      const root = gateRoot();
      root.classList.remove("hidden");
      root.innerHTML = status.setupRequired ? setupScreen() : loginScreen();
      bindGate((result) => {
        root.classList.add("hidden");
        root.innerHTML = "";
        resolve(result);
      });
    });
  }

  async function ensureAuthenticated() {
    let status = await rawInvoke("auth_status");
    if (!status.authenticated) {
      await respectStartupBrand();
      status = await showAuthGate(status);
    }
    auth.status = status;
    return status;
  }

  function installChrome() {
    if (!auth.status?.authenticated) return;
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return;

    let shell = $("identityControls");
    if (!shell) {
      shell = document.createElement("div");
      shell.id = "identityControls";
      shell.className = "identity-controls";
      actions.prepend(shell);
    }

    const activeId = auth.status.activeWorkspaceId;
    const identitySignature = JSON.stringify([activeId, auth.status.workspaces, auth.status.user]);
    if (shell.dataset.identitySignature !== identitySignature) {
      shell.dataset.identitySignature = identitySignature;
      shell.innerHTML = `<label class="workspace-control"><span>Ambiente</span><select id="workspaceSelector">${(auth.status.workspaces || []).map((workspace) => `<option value="${esc(workspace.id)}" ${workspace.id === activeId ? "selected" : ""}>${esc(workspace.name)}</option>`).join("")}</select></label>
      <div class="identity-user"><strong>${esc(auth.status.user?.email || "")}</strong><small>${auth.status.user?.isSuperAdmin ? "Administrador da plataforma" : roleLabel((auth.status.workspaces || []).find((item) => item.id === activeId)?.role)}</small></div>
      <button class="ghost compact" data-auth-action="logout">Sair</button>`;
    }
    if ($("workspaceSelector")) $("workspaceSelector").disabled = auth.switching || auth.workspaceLocks > 0;

    const foot = document.querySelector(".sidebar-foot");
    if (foot && !$("updateState")) {
      const update = document.createElement("small");
      update.id = "updateState";
      update.textContent = navigator.onLine ? "Atualizações: verificando..." : "Atualizações: aguardando internet";
      foot.appendChild(update);
    }
  }

  function applyPermissions() {
    if (!auth.status?.authenticated) return;
    const pageModules = {
      dashboard: "dashboard",
      transactions: "transactions",
      accounts: "accounts",
      annual: "analytics",
      openfinance: "openFinance",
      investments: "investments",
      settings: "settings",
      access: "users",
    };
    document.querySelectorAll(".nav button[data-page]").forEach((button) => {
      const module = pageModules[button.dataset.page];
      if (!module) return;
      button.classList.toggle("permission-hidden", !modulePermission(module, "view"));
    });

    const disableForm = (id, enabled) => {
      const form = $(id);
      if (!form) return;
      form.querySelectorAll("input,select,button").forEach((element) => {
        if (element.dataset.page) return;
        element.disabled = !enabled;
      });
      form.classList.toggle("permission-readonly", !enabled);
    };

    if (C.S.page === "transactions") {
      const create = modulePermission("transactions", "create");
      disableForm("expenseForm", create);
      disableForm("incomeForm", create);
      disableForm("cardTxForm", create);
      disableForm("transferForm", create);
      disableForm("importForm", create);
      if (!modulePermission("transactions", "edit")) {
        document.querySelectorAll('[data-action="edit"],[data-action="settle"]').forEach((button) => button.classList.add("permission-hidden"));
      }
      if (!modulePermission("transactions", "delete")) {
        document.querySelectorAll('[data-action="delete"][data-type="transactions"]').forEach((button) => button.classList.add("permission-hidden"));
      }
    }
    if (C.S.page === "accounts") {
      disableForm("accountForm", modulePermission("accounts", "create") || modulePermission("accounts", "edit"));
      disableForm("cardForm", modulePermission("accounts", "create") || modulePermission("accounts", "edit"));
    }
    if (C.S.page === "investments") {
      disableForm("investmentForm", modulePermission("investments", "create") || modulePermission("investments", "edit"));
      for (const id of ["investmentV17Form", "goalV17Form"]) {
        const action = $(id)?.dataset.editing === "true" ? "edit" : "create";
        disableForm(id, modulePermission("investments", action));
      }
      disableForm("riskProfileForm", modulePermission("settings", "edit"));
      document.querySelectorAll('[data-v17-action^="edit-"]').forEach((button) => button.classList.toggle("permission-hidden", !modulePermission("investments", "edit")));
      document.querySelectorAll('[data-v17-action^="delete-"]').forEach((button) => button.classList.toggle("permission-hidden", !modulePermission("investments", "delete")));
    }
    if (C.S.page === "openfinance") {
      const actions = { connect: "create", renew: "edit", "sync-all": "edit", disconnect: "delete" };
      document.querySelectorAll('[data-of-action]').forEach((button) => button.classList.toggle("permission-hidden", !modulePermission("openFinance", actions[button.dataset.ofAction] || "view")));
    }
    if (C.S.page === "settings") {
      disableForm("settingsForm", modulePermission("settings", "edit"));
      disableForm("categoryForm", modulePermission("settings", "create"));
    }
  }

  function blankPermissions() {
    return Object.fromEntries(MODULES.map(([module]) => [module, { view: false, create: false, edit: false, delete: false }]));
  }

  function presetPermissions(role) {
    const permissions = blankPermissions();
    const view = (...modules) => modules.forEach((module) => { permissions[module].view = true; });
    const manage = (...modules) => modules.forEach((module) => {
      permissions[module] = { view: true, create: true, edit: true, delete: true };
    });

    if (role === "admin") {
      MODULES.forEach(([module]) => { permissions[module] = { view: true, create: true, edit: true, delete: true }; });
    } else if (role === "operator") {
      view("dashboard", "analytics", "openFinance", "exports");
      manage("transactions", "accounts");
    } else if (role === "viewer") {
      view("dashboard", "transactions", "accounts", "analytics", "openFinance", "investments");
    }
    return permissions;
  }

  function permissionRows(permissions = blankPermissions()) {
    return MODULES.map(([module, label]) => {
      const canManage = !["dashboard", "analytics"].includes(module);
      const current = permissions[module] || {};
      const managed = Boolean(current.create || current.edit || current.delete);
      return `<div class="permission-row ${["openFinance", "investments"].includes(module) ? "permission-highlight" : ""}">
        <strong>${esc(label)}</strong>
        <label><input type="checkbox" data-permission-module="${module}" data-permission-kind="view" ${current.view ? "checked" : ""}> Visualizar</label>
        <label class="${canManage ? "" : "muted-control"}"><input type="checkbox" data-permission-module="${module}" data-permission-kind="manage" ${managed ? "checked" : ""} ${canManage ? "" : "disabled"}> Alterar</label>
      </div>`;
    }).join("");
  }

  function collectPermissions(root) {
    const permissions = blankPermissions();
    root.querySelectorAll("[data-permission-module]").forEach((input) => {
      const module = input.dataset.permissionModule;
      if (!permissions[module]) return;
      if (input.dataset.permissionKind === "view") permissions[module].view = input.checked;
      if (input.dataset.permissionKind === "manage" && input.checked) {
        permissions[module].view = true;
        permissions[module].create = true;
        permissions[module].edit = true;
        permissions[module].delete = true;
      }
    });
    return permissions;
  }

  function memberBadges(member) {
    const open = member.permissions?.openFinance?.view ? "Open Finance" : "Sem Open Finance";
    const invest = member.permissions?.investments?.view ? "Investimentos" : "Sem investimentos";
    return `<span class="access-chip">${esc(open)}</span><span class="access-chip">${esc(invest)}</span>`;
  }

  async function renderAccessPage() {
    if (!modulePermission("users", "view") && !auth.status?.user?.isSuperAdmin) return;
    C.S.page = "access";
    document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.page === "access"));
    const title = $("pageTitle");
    if (title) title.textContent = "Usuários & Acessos";
    const view = $("view");
    if (!view) return;
    const activeId = auth.status.activeWorkspaceId;
    const active = (auth.status.workspaces || []).find((workspace) => workspace.id === activeId);
    view.innerHTML = `<section class="loading">Carregando acessos...</section>`;

    let members = [];
    try {
      members = await rawInvoke("auth_list_members", { workspaceId: activeId });
    } catch (error) {
      view.innerHTML = `<section class="fatal"><h2>Acesso indisponível</h2><p>${esc(error?.message || error)}</p></section>`;
      return;
    }

    const canManage = auth.status.user?.isSuperAdmin || modulePermission("users", "create") || modulePermission("users", "edit");
    const cloudText = cloudConfigured()
      ? "Identidade e sincronização em nuvem disponíveis quando a sessão está online."
      : "Modo local protegido ativo. Para convites remotos, redefinição por e-mail e sincronização entre computadores, conecte o backend Supabase.";

    view.innerHTML = `<section class="hero access-hero"><div><h2>Usuários & Acessos</h2><p>Controle quem entra em cada ambiente e o que cada pessoa pode visualizar ou alterar.</p></div><span class="tag ok">${esc(active?.name || "Ambiente")}</span></section>
      <section class="security-grid">
        <article class="security-card"><span>Conta atual</span><strong>${esc(auth.status.user?.email || "")}</strong><small>${auth.status.user?.isSuperAdmin ? "Super administrador da plataforma" : roleLabel(active?.role)}</small></article>
        <article class="security-card"><span>Ambientes disponíveis</span><strong>${auth.status.workspaces?.length || 0}</strong><small>Dados financeiros separados por ambiente</small></article>
        <article class="security-card"><span>Identidade em nuvem</span><strong>${cloudConfigured() ? "Preparada" : "Pendente"}</strong><small>${esc(cloudText)}</small></article>
      </section>

      ${auth.status.user?.isSuperAdmin ? `<section class="panel"><div class="panel-head"><div><h3>Novo ambiente financeiro</h3><small>Use um ambiente separado para cada cliente que não deve compartilhar dados.</small></div></div><form id="workspaceForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome do ambiente<input name="name" required maxlength="120" placeholder="Ex.: Empresa Cliente ABC"></label></div><div class="button-row"><button class="primary">Criar ambiente</button><span id="workspaceMsg" class="form-msg"></span></div></form></section>` : ""}

      <div class="two-col access-columns">
        <section class="panel"><div class="panel-head"><div><h3>${auth.editingMemberId ? "Editar permissões" : "Adicionar acesso"}</h3><small>${cloudConfigured() ? "O usuário receberá um convite por e-mail para ativar o acesso." : "Cria ou vincula um usuário local a este ambiente."}</small></div></div>
          <form id="memberForm" class="form panel-body ${canManage ? "" : "permission-readonly"}">
            <div class="form-grid">
              <label class="wide">E-mail<input name="email" type="email" required ${auth.editingMemberId ? "readonly" : ""}></label>
              <label class="wide">Senha inicial <small>${auth.editingMemberId ? "(não é alterada aqui)" : "necessária somente para novo usuário local"}</small><input name="tempPassword" type="password" minlength="10" ${auth.editingMemberId ? "disabled" : ""}></label>
              <label class="wide">Perfil<select name="role"><option value="admin">Administrador</option><option value="operator">Operador</option><option value="viewer">Somente consulta</option><option value="custom" selected>Personalizado</option></select></label>
            </div>
            <div id="permissionMatrix" class="permission-matrix">${permissionRows()}</div>
            <div class="button-row"><button class="primary" ${canManage ? "" : "disabled"}>${auth.editingMemberId ? "Salvar permissões" : "Adicionar usuário"}</button>${auth.editingMemberId ? `<button type="button" class="ghost" data-auth-action="cancel-member-edit">Cancelar</button>` : ""}<span id="memberMsg" class="form-msg"></span></div>
          </form>
        </section>
        <section class="panel"><div class="panel-head"><div><h3>Alterar minha senha</h3><small>A nova senha será protegida localmente com Argon2id.</small></div></div><form id="passwordForm" class="form panel-body"><label>Senha atual<input name="currentPassword" type="password" required></label><label>Nova senha<input name="newPassword" type="password" minlength="10" required></label><label>Confirmar nova senha<input name="confirmPassword" type="password" minlength="10" required></label><div class="button-row"><button class="ghost">Alterar senha</button><span id="passwordMsg" class="form-msg"></span></div></form></section>
      </div>

      <section class="panel"><div class="panel-head"><div><h3>Pessoas com acesso</h3><small>Permissões são aplicadas no backend local; ocultar botões não é a única barreira.</small></div></div><div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Acessos sensíveis</th><th></th></tr></thead><tbody>${members.map((member) => `<tr><td><strong>${esc(member.email)}</strong>${member.isSuperAdmin ? `<br><small class="muted">Administrador da plataforma</small>` : ""}</td><td>${esc(roleLabel(member.role))}</td><td>${memberBadges(member)}</td><td class="right actions-cell">${member.isOwner ? `<span class="tag ok">Proprietário</span>` : canManage ? `<button class="ghost compact" data-member-action="edit" data-user-id="${esc(member.userId)}">Permissões</button><button class="danger ghost compact" data-member-action="remove" data-user-id="${esc(member.userId)}">Remover</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nenhum usuário adicional.</td></tr>`}</tbody></table></div></section>`;

    const memberById = new Map(members.map((member) => [member.userId, member]));

    $("workspaceForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = $("workspaceMsg");
      const { name } = formObject(event.currentTarget);
      statusMessage(message, "Criando ambiente...");
      try {
        auth.status = await rawInvoke("auth_create_workspace", { name });
        installChrome();
        statusMessage(message, "Ambiente criado.");
        await renderAccessPage();
      } catch (error) {
        statusMessage(message, error?.message || String(error), true);
      }
    });

    const memberForm = $("memberForm");
    memberForm?.elements.role?.addEventListener("change", (event) => {
      if (event.target.value === "custom") return;
      $("permissionMatrix").innerHTML = permissionRows(presetPermissions(event.target.value));
    });
    memberForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formObject(event.currentTarget);
      const message = $("memberMsg");
      const permissions = collectPermissions(event.currentTarget);
      statusMessage(message, "Salvando acesso...");
      try {
        if (auth.editingMemberId) {
          await rawInvoke("auth_update_member_permissions", {
            input: { workspaceId: activeId, userId: auth.editingMemberId, role: values.role, permissions },
          });
          auth.editingMemberId = null;
        } else {
          await rawInvoke("auth_create_or_grant_user", {
            input: { workspaceId: activeId, email: values.email, tempPassword: values.tempPassword || null, role: values.role, permissions },
          });
        }
        await renderAccessPage();
      } catch (error) {
        statusMessage(message, error?.message || String(error), true);
      }
    });

    $("passwordForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formObject(event.currentTarget);
      const message = $("passwordMsg");
      if (values.newPassword !== values.confirmPassword) return statusMessage(message, "As novas senhas não coincidem.", true);
      statusMessage(message, "Alterando senha...");
      try {
        await rawInvoke("auth_change_password", { currentPassword: values.currentPassword, newPassword: values.newPassword });
        event.currentTarget.reset();
        statusMessage(message, "Senha alterada com sucesso.");
      } catch (error) {
        statusMessage(message, error?.message || String(error), true);
      }
    });

    view.querySelectorAll("[data-member-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const member = memberById.get(button.dataset.userId);
        if (!member) return;
        if (button.dataset.memberAction === "edit") {
          auth.editingMemberId = member.userId;
          await renderAccessPage();
          const form = $("memberForm");
          if (!form) return;
          form.elements.email.value = member.email;
          form.elements.role.value = member.role;
          $("permissionMatrix").innerHTML = permissionRows(member.permissions);
          form.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        if (button.dataset.memberAction === "remove") {
          if (!confirm(`Remover o acesso de ${member.email} deste ambiente?`)) return;
          try {
            await rawInvoke("auth_remove_member", { workspaceId: activeId, userId: member.userId });
            await renderAccessPage();
          } catch (error) {
            alert(error?.message || String(error));
          }
        }
      });
    });
  }

  async function switchWorkspace(workspaceId) {
    if (auth.switching || auth.workspaceLocks > 0) {
      if ($("workspaceSelector")) $("workspaceSelector").value = auth.status.activeWorkspaceId;
      return;
    }
    auth.switching = true;
    installChrome();
    try {
      auth.status = await rawInvoke("auth_switch_workspace", { workspaceId });
      C.S.page = modulePermission("dashboard", "view") ? "dashboard" : "transactions";
      Object.keys(C.S.edit || {}).forEach((type) => { C.S.edit[type] = null; });
      await originalLoad();
      installChrome();
      applyPermissions();
      window.dispatchEvent(new Event("online"));
    } catch (error) {
      alert(error?.message || String(error));
    } finally {
      auth.switching = false;
      installChrome();
    }
  }

  async function checkAutomaticUpdate() {
    if (auth.updateChecked || !navigator.onLine) return;
    auth.updateChecked = true;
    const state = $("updateState");
    if (state) state.textContent = "Atualizações: verificando...";
    try {
      const result = await rawInvoke("check_and_install_update");
      if (state) state.textContent = result.configured
        ? (result.available ? `Atualizando para ${result.version}...` : "Atualizações: em dia")
        : "Atualizações automáticas: aguardando assinatura";
    } catch (error) {
      auth.updateChecked = false;
      if (state) state.textContent = "Atualizações: nova tentativa quando houver conexão";
    }
  }

  function scheduleUpdater() {
    setTimeout(checkAutomaticUpdate, 1800);
  }

  C.load = async function securedLoad() {
    await ensureAuthenticated();
    const result = await originalLoad();
    setTimeout(() => {
      installChrome();
      applyPermissions();
      scheduleUpdater();
    }, 0);
    return result;
  };

  document.addEventListener("change", (event) => {
    if (event.target?.id === "workspaceSelector") switchWorkspace(event.target.value);
  });

  document.addEventListener("click", async (event) => {
    const forgot = event.target.closest('[data-auth-action="forgot"]');
    if (forgot) {
      event.preventDefault();
      const root = gateRoot();
      root.innerHTML = resetScreen();
      bindGate(() => {});
      return;
    }
    const back = event.target.closest('[data-auth-action="back-login"]');
    if (back) {
      event.preventDefault();
      const root = gateRoot();
      root.innerHTML = loginScreen();
      bindGate(() => {});
      return;
    }
    const logout = event.target.closest('[data-auth-action="logout"]');
    if (logout) {
      event.preventDefault();
      await rawInvoke("auth_logout");
      location.reload();
      return;
    }
    const cancelEdit = event.target.closest('[data-auth-action="cancel-member-edit"]');
    if (cancelEdit) {
      event.preventDefault();
      auth.editingMemberId = null;
      renderAccessPage();
    }
  });

  document.addEventListener("click", (event) => {
    const accessButton = event.target.closest('[data-page="access"]');
    if (!accessButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    renderAccessPage();
  }, true);

  const observer = new MutationObserver(() => {
    installChrome();
    applyPermissions();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("online", () => {
    auth.updateChecked = false;
    scheduleUpdater();
  });
})();
