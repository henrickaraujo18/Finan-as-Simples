(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;

  function cloudReady() {
    return Boolean(window.FSCloudConfig?.supabaseUrl && window.FSCloudRuntime);
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function replaceCopy(root = document) {
    if (!cloudReady()) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const replacements = new Map([
      [" O backend de e-mail ainda será vinculado à conta em nuvem desta instalação.", ""],
      [" O envio por e-mail será ativado quando o backend de identidade em nuvem for conectado.", ""],
      ["Backend configurado. A próxima etapa é vincular as contas locais ao provedor de identidade para sincronização multi-dispositivo.", "Identidade e sincronização em nuvem disponíveis quando a sessão está online."],
      ["Conta local nesta versão; convite remoto será ativado com a sincronização do backend.", "O usuário receberá um convite por e-mail para ativar o acesso."],
      ["Modo local protegido ativo. Para convites remotos, redefinição por e-mail e sincronização entre computadores, conecte o backend Supabase.", "Modo offline protegido. Ao reconectar, o sistema volta a sincronizar automaticamente."],
      ["necessária somente para novo usuário local", "não utilizada nos convites por e-mail"],
    ]);
    let node;
    while ((node = walker.nextNode())) {
      const original = node.nodeValue || "";
      let value = original;
      for (const [from, to] of replacements) value = value.replace(from, to);
      if (value !== original) node.nodeValue = value;
    }

    const gate = document.getElementById("authGate");
    const setup = document.getElementById("ownerSetupForm");
    if (gate && setup) {
      setText(gate.querySelector(".auth-heading span"), "Acesso seguro");
      setText(gate.querySelector(".auth-heading h2"), "Entrar ou criar sua conta");
      setText(gate.querySelector(".auth-heading p"), "Use seu e-mail e senha. Se este computador ainda não estiver cadastrado, seus ambientes autorizados serão vinculados automaticamente.");
      setText(setup.querySelector('button[type="submit"], button:not([type])'), "Continuar");
    }

    const cloudCard = [...document.querySelectorAll(".security-card")].find((card) => card.textContent.includes("Identidade em nuvem"));
    if (cloudCard) {
      setText(cloudCard.querySelector("strong"), window.FSCloudRuntime.isAuthenticated() ? "Conectada" : (navigator.onLine ? "Login necessário" : "Offline"));
    }
  }

  function installOwnerWorkspaceCreator() {
    if (!cloudReady()) return;
    if (document.getElementById("workspaceForm") || document.getElementById("cloudOwnerWorkspacePanel")) return;
    const view = document.getElementById("view");
    if (!view || document.getElementById("pageTitle")?.textContent !== "Usuários & Acessos") return;
    const roleText = document.querySelector(".identity-user small")?.textContent?.trim();
    if (roleText !== "Proprietário") return;

    const hero = view.querySelector(".access-hero") || view.firstElementChild;
    const panel = document.createElement("section");
    panel.id = "cloudOwnerWorkspacePanel";
    panel.className = "panel";
    panel.innerHTML = `<div class="panel-head"><div><h3>Novo ambiente financeiro</h3><small>Crie um ambiente separado para cada cliente que não deve compartilhar dados.</small></div></div>
      <form id="cloudOwnerWorkspaceForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome do ambiente<input name="name" required maxlength="120" placeholder="Ex.: Empresa Cliente ABC"></label></div><div class="button-row"><button class="primary">Criar ambiente</button><span id="cloudWorkspaceMsg" class="form-msg"></span></div></form>`;
    hero?.insertAdjacentElement("afterend", panel);

    panel.querySelector("form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = document.getElementById("cloudWorkspaceMsg");
      const name = new FormData(event.currentTarget).get("name")?.toString().trim();
      if (!name) return;
      if (message) {
        message.classList.remove("error");
        setText(message, "Criando ambiente...");
      }
      try {
        const status = await invoke("auth_create_workspace", { name });
        const activeId = status?.activeWorkspaceId;
        const active = (status?.workspaces || []).find((item) => item.id === activeId);
        const selector = document.getElementById("workspaceSelector");
        if (selector && activeId) {
          let option = [...selector.options].find((item) => item.value === activeId);
          if (!option) {
            option = new Option(active?.name || name, activeId);
            selector.add(option);
          }
          selector.value = activeId;
          selector.dispatchEvent(new Event("change", { bubbles: true }));
        }
        setText(message, "Ambiente criado e isolado com sucesso.");
        event.currentTarget.reset();
      } catch (error) {
        if (message) {
          setText(message, error?.message || String(error));
          message.classList.add("error");
        }
      }
    });
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      replaceCopy(document.body);
      installOwnerWorkspaceCreator();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  replaceCopy(document.body);
  installOwnerWorkspaceCreator();
})();
