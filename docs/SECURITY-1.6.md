# Finança Simples 1.6 — Identidade, isolamento e atualização

## Modelo de acesso

- Usuário é uma identidade; dados financeiros pertencem a um ambiente (`workspace`).
- O mesmo usuário pode pertencer a vários ambientes.
- Dois usuários podem compartilhar o mesmo ambiente quando desejado.
- Um cliente independente recebe outro `workspace_id`; os dados não se misturam.
- Permissões são aplicadas no frontend **e** no núcleo Rust/local; no backend cloud, Row Level Security (RLS) aplica o mesmo isolamento.

## Perfis e permissões

O modelo suporta proprietário, administrador, operador, consulta e personalizado. As permissões são separadas por Dashboard, Lançamentos, Contas & Cartões, Dashboard Analítico, Open Finance, Investimentos, Exportações, Parametrização e Usuários & Acessos.

Open Finance e Investimentos podem ser ocultados ou disponibilizados apenas para consulta/alteração conforme o usuário.

## Senhas

Enquanto o backend de identidade não estiver conectado, a versão bootstrap local usa Argon2id e não armazena a senha em texto claro. Em produção multi-dispositivo, Supabase Auth será a autoridade de identidade e o aplicativo não armazenará a senha remota.

A redefinição por e-mail só deve ser considerada ativa depois da implantação do projeto Supabase e configuração do redirect de recuperação.

## Supabase

Os arquivos em `supabase/` preparam:

- perfis;
- workspaces;
- memberships;
- entidades financeiras com `workspace_id`;
- auditoria;
- RLS;
- convite de usuário por e-mail;
- página de redefinição de senha.

Nunca colocar chave `secret`/`service_role` no aplicativo Windows. Apenas a chave publicável pode existir no cliente.

## Atualização automática

O desktop verifica atualizações quando há internet. A publicação automática só é habilitada se o GitHub Actions possuir a chave privada de assinatura do updater.

Fluxo:

1. verificar `latest.json` no release `desktop-preview`;
2. validar se há versão superior;
3. criar backup local;
4. baixar instalador;
5. validar a assinatura Tauri;
6. instalar;
7. reiniciar o Finança Simples.

Se a assinatura não estiver configurada, o pipeline **não** publica um manifesto de auto-update. Isso impede aceitar pacotes não autenticados.

### Bootstrap obrigatório

A versão 1.5 não contém updater funcional. Portanto, a primeira versão que carregar a chave pública do updater deverá ser instalada manualmente uma única vez. A partir dela, versões futuras podem ser instaladas automaticamente.

## Segredos esperados no GitHub Actions

- `TAURI_SIGNING_PRIVATE_KEY` — chave privada do updater, nunca commitada.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — se a chave tiver senha.
- `TAURI_UPDATER_PUBLIC_KEY` — chave pública usada para compilar o app; pode ser pública, mas o workflow atual a recebe como secret/variável de publicação.

A assinatura Tauri protege o canal de atualização. Assinatura Authenticode do executável Windows é uma camada adicional e independente, recomendada antes de distribuição comercial ampla.
