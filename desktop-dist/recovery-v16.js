(() => {
  const invoke = () => window.__TAURI__?.core?.invoke;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function setMessage(node, text, error = false) {
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("error", error);
  }

  async function restore(backupPath, recoveryKey, message) {
    if (!backupPath || !recoveryKey) {
      setMessage(message, "Informe o caminho do arquivo .fsbackup e a chave de recuperação.", true);
      return;
    }
    if (!confirm("A restauração substituirá os dados locais deste computador. Um backup de segurança será criado antes de qualquer alteração. Continuar?")) return;
    setMessage(message, "Validando backup e preparando restauração...");
    try {
      await invoke()("restore_portable_backup", { backupPath, recoveryKey });
    } catch (error) {
      setMessage(message, error?.message || String(error), true);
    }
  }

  function injectLoginRestore() {
    const gate = $("authGate");
    if (!gate || gate.classList.contains("hidden") || $("preLoginRestore")) return;
    const card = gate.querySelector(".auth-card");
    if (!card) return;
    const details = document.createElement("details");
    details.id = "preLoginRestore";
    details.className = "recovery-details";
    details.innerHTML = `<summary>Restaurar backup de outro computador</summary>
      <div class="recovery-form">
        <p>Use um arquivo <strong>.fsbackup</strong> e a chave de recuperação guardada fora do computador anterior.</p>
        <label>Caminho completo do arquivo<input id="preRestorePath" placeholder="C:\\Users\\...\\backup.fsbackup"></label>
        <label>Chave de recuperação<input id="preRestoreKey" type="password" autocomplete="off" maxlength="64" placeholder="64 caracteres"></label>
        <button id="preRestoreButton" type="button" class="ghost">Validar e restaurar</button>
        <span id="preRestoreMsg" class="form-msg"></span>
      </div>`;
    card.appendChild(details);
    $("preRestoreButton")?.addEventListener("click", () => restore(
      $("preRestorePath")?.value.trim(),
      $("preRestoreKey")?.value.trim(),
      $("preRestoreMsg"),
    ));
  }

  function injectSettingsRecovery() {
    const view = $("view");
    if (!view || $("recoverySecurityPanel")) return;
    const title = $("pageTitle")?.textContent?.trim();
    if (title !== "Parametrização") return;

    const panel = document.createElement("section");
    panel.id = "recoverySecurityPanel";
    panel.className = "panel recovery-panel";
    panel.innerHTML = `<div class="panel-head"><div><h3>Segurança e recuperação</h3><small>Backup local para recuperação rápida e backup portátil para perda total do computador.</small></div><span class="tag ok">SQLCipher + DPAPI</span></div>
      <div class="panel-body recovery-grid">
        <article class="recovery-card"><h4>Backup portátil criptografado</h4><p>Cria um <strong>.fsbackup</strong> que pode ser restaurado em outro Windows. A chave abaixo é independente do computador.</p><button id="createPortableBackup" class="primary">Criar backup portátil</button><span id="portableBackupMsg" class="form-msg"></span><div id="portableBackupResult" class="recovery-result hidden"></div></article>
        <article class="recovery-card"><h4>Restaurar backup</h4><p>O arquivo e a chave são validados antes da restauração. Se algo falhar, o sistema tenta retornar automaticamente ao estado anterior.</p><label>Caminho do .fsbackup<input id="settingsRestorePath" placeholder="C:\\Users\\...\\backup.fsbackup"></label><label>Chave de recuperação<input id="settingsRestoreKey" type="password" autocomplete="off" maxlength="64"></label><button id="settingsRestoreButton" class="ghost">Validar e restaurar</button><span id="settingsRestoreMsg" class="form-msg"></span></article>
      </div>`;
    view.appendChild(panel);

    $("createPortableBackup")?.addEventListener("click", async () => {
      const message = $("portableBackupMsg");
      const result = $("portableBackupResult");
      setMessage(message, "Criando snapshot consistente e criptografado...");
      try {
        const info = await invoke()("create_portable_backup");
        setMessage(message, "Backup portátil criado com sucesso.");
        if (result) {
          result.classList.remove("hidden");
          result.innerHTML = `<strong>Arquivo</strong><code>${esc(info.path)}</code><strong>Chave de recuperação</strong><code class="recovery-key">${esc(info.recoveryKey)}</code><small>Guarde o arquivo e esta chave em locais separados. Quem possuir ambos poderá acessar seus dados.</small>`;
        }
      } catch (error) {
        setMessage(message, error?.message || String(error), true);
      }
    });

    $("settingsRestoreButton")?.addEventListener("click", () => restore(
      $("settingsRestorePath")?.value.trim(),
      $("settingsRestoreKey")?.value.trim(),
      $("settingsRestoreMsg"),
    ));
  }

  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      injectLoginRestore();
      injectSettingsRecovery();
    });
  }

  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("click", () => setTimeout(refresh, 0));
  refresh();
})();
