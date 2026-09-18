// Configuração pública do provedor de identidade/sincronização.
// A publishable key do Supabase é própria para cliente. NUNCA coloque secret key,
// service_role legado, credenciais do Open Finance ou qualquer outro segredo neste arquivo.
window.FSCloudConfig = Object.freeze({
  supabaseUrl: "https://jozjcqskvkwxoaqmthrj.supabase.co",
  supabasePublishableKey: "sb_publishable_pIcoV3Oq9FZSzVvTXQy8GQ_5Zf9SXq8",
  // Alias mantido para compatibilidade com a camada de autenticação existente.
  supabaseAnonKey: "sb_publishable_pIcoV3Oq9FZSzVvTXQy8GQ_5Zf9SXq8",
  passwordResetRedirect: "https://jozjcqskvkwxoaqmthrj.supabase.co/functions/v1/reset-password",
  inviteFunction: "invite-user",
});
