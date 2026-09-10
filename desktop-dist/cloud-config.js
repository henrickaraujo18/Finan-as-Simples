// Configuração pública do provedor de identidade/sincronização.
// A publishable key do Supabase é própria para cliente. NUNCA coloque secret key,
// service_role legado, credenciais do Open Finance ou qualquer outro segredo neste arquivo.
window.FSCloudConfig = Object.freeze({
  supabaseUrl: "",
  supabasePublishableKey: "",
  // Compatibilidade temporária com código 1.6 durante a ativação do backend.
  supabaseAnonKey: "",
  passwordResetRedirect: "",
  inviteFunction: "invite-user",
});
