# Finança Simples — cloud e atualizações

## Supabase

Projeto dedicado criado em `sa-east-1`.

O cliente Windows recebe apenas:
- URL pública do projeto;
- publishable key `sb_publishable_...`.

Nunca incluir no aplicativo ou no repositório:
- `sb_secret_...`;
- `service_role`;
- credenciais Pluggy/Open Finance;
- chave privada do updater.

A base cloud utiliza RLS, workspaces, memberships, entidades financeiras e auditoria. Helpers privilegiados ficam no schema `private`, fora do Data API público.

Edge Functions:
- `invite-user`: exige JWT válido e revalida permissão de gestão antes de usar a chave secreta no servidor;
- `reset-password`: landing page pública para convite/recuperação, sem chave secreta e sem dependência JavaScript externa.

## Atualização automática Tauri

Fluxo de produção:
1. usuário abre o Finança Simples;
2. havendo internet, o app consulta o manifesto `latest.json` do release `desktop-preview`;
3. uma versão superior dispara backup local;
4. o updater baixa o instalador;
5. a assinatura Tauri é validada;
6. somente artefato válido é instalado;
7. o app reinicia.

A publicação de `latest.json` é deliberadamente bloqueada quando a build não possui as chaves de assinatura.

### Secrets exigidos no GitHub Actions

- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (se a chave possuir senha)

Gerar o par com o Tauri CLI fora do repositório. A chave pública pode ser distribuída; a privada deve permanecer exclusivamente em armazenamento seguro/GitHub Actions Secrets e possuir cópia de recuperação fora do computador de desenvolvimento.

## Primeira transição

Versões antigas sem updater assinado precisam receber uma instalação manual da primeira 1.6 de produção. Depois disso, versões futuras podem ser instaladas automaticamente pelo canal assinado.
