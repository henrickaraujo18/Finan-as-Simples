// Configuração pública do provedor de identidade/sincronização.
// O anon key do Supabase é público por definição; NUNCA coloque service_role, Client Secret
// do Open Finance ou qualquer outro segredo privilegiado neste arquivo.
window.FSCloudConfig = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  passwordResetRedirect: "",
});
