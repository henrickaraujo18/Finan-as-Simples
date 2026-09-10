# Finança Simples — Identidade, ambientes e atualização automática

## Estado da versão 1.6

A versão 1.6 introduz a fundação de identidade e isolamento de dados no aplicativo Windows:

- conta proprietária por e-mail e senha;
- senha local protegida por Argon2id + salt aleatório;
- ambientes financeiros (`workspace_id`) separados;
- memberships e permissões por módulo;
- super administrador da plataforma;
- auditoria local de acessos e alterações relevantes;
- backend Supabase preparado com Row Level Security (RLS);
- Edge Function preparada para convites por e-mail;
- Tauri updater preparado para atualização automática assinada.

A base local continua SQLite convencional nesta etapa. Criptografia do arquivo de banco com SQLCipher deve ser tratada como uma etapa de segurança separada, com migração e recuperação testadas antes de ser habilitada em produção.

## Identidade em nuvem

Para ativar usuários em computadores diferentes, recuperação de senha por e-mail e sincronização entre dispositivos, criar/conectar um projeto Supabase dedicado e aplicar:

1. `supabase/migrations/001_identity_workspaces.sql`
2. `supabase/functions/invite-user/index.ts`

Depois preencher somente valores públicos em `desktop-dist/cloud-config.js`:

- `supabaseUrl`
- `supabaseAnonKey`
- `passwordResetRedirect`

Nunca colocar no aplicativo Windows:

- `SUPABASE_SERVICE_ROLE_KEY`;
- Client Secret do Pluggy/Open Finance;
- chave privada do Tauri updater;
- tokens administrativos ou credenciais privilegiadas.

## Modelo de isolamento

Usuários e dados são entidades diferentes. Cada registro financeiro pertence a um `workspace_id`.

Exemplo:

- Henrick pode ser membro de `Henrick — Pessoal`, `Cliente A` e `Cliente B`;
- Cliente A pode ser membro apenas de `Cliente A`;
- os dados de cada workspace são filtrados no backend e protegidos por RLS no Supabase;
- ocultar um botão no frontend nunca substitui a autorização do backend.

Permissões principais:

- Dashboard;
- Lançamentos;
- Contas & Cartões;
- Dashboard Analítico;
- Open Finance;
- Investimentos;
- Exportações;
- Parametrização;
- Usuários & Acessos.

Cada módulo pode ter `view`, `create`, `edit` e `delete`.

## Recuperação de senha

O aplicativo local apresenta uma resposta genérica ao pedido de recuperação para não revelar se determinado e-mail é cadastrado.

O envio real do e-mail e a troca de credencial devem ser realizados pelo provedor de identidade em nuvem. O aplicativo Windows não deve possuir credencial de servidor capaz de redefinir senhas diretamente.

## Atualização automática

O atualizador só é habilitado em builds que possuam a chave pública Tauri incorporada. A chave privada nunca deve entrar no repositório.

Segredos esperados no GitHub Actions:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

Fluxo de produção:

1. CI valida frontend, Rust e banco;
2. CI compila o instalador NSIS;
3. com as chaves presentes, Tauri gera `.exe.sig`;
4. CI executa o smoke test do executável;
5. CI publica instalador + assinatura + `latest.json` na release `desktop-preview`;
6. o aplicativo conectado à internet consulta `latest.json`;
7. se houver versão superior, cria backup local;
8. baixa o instalador;
9. Tauri valida a assinatura;
10. instala a atualização;
11. reinicia o Finança Simples.

Sem as chaves de assinatura, o CI ainda pode gerar um instalador para testes, mas não publica `latest.json` e a atualização automática permanece desativada.

## Segurança futura recomendada

Antes de considerar o sistema adequado para dados financeiros sensíveis em produção, ainda devem ser avaliados/testados:

- SQLCipher para criptografia do banco local;
- backup criptografado e restauração testada;
- Content Security Policy (CSP) restritiva;
- assinatura Authenticode do executável/instalador;
- rate limiting e proteção contra brute force no backend de autenticação;
- política de sessões e revogação de dispositivos;
- secret scanning, dependency scanning e SBOM;
- testes de isolamento multi-tenant e testes de autorização negativos.
