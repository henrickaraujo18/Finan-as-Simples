(() => {
  // Ao voltar da recuperação, reconstrói o gate de autenticação para preservar
  // a Promise que bloqueia o carregamento dos dados até um login válido.
  document.addEventListener("click", (event) => {
    const back = event.target.closest('[data-auth-action="back-login"]');
    if (!back) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.reload();
  }, true);
})();
