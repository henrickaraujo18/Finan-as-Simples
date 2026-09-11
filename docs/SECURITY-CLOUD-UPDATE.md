# Finança Simples — segurança de nuvem e atualização

## Estado da versão 1.7

- Supabase Auth por e-mail e senha;
- ambientes financeiros (`workspace_id`) separados;
- papéis e permissões por módulo;
- RLS e auditoria no backend;
- sincronização multi-dispositivo offline-first;
- SQLCipher com chave protegida por DPAPI no Windows;
- backup consistente e fluxo de recuperação;
- funções autenticadas para convites, membros, mercado e Open Finance;
- updater Tauri que só é habilitado em builds assinadas.

## Modelo de isolamento

Cada registro pertence a um workspace. Um usuário só consulta ou altera o módulo permitido pela sua membership. Ser administrador da plataforma não concede acesso implícito aos dados financeiros de um cliente.

As entidades avançadas seguem os mesmos módulos:

| Entidade | Permissão |
|---|---|
| `investment_goals`, `market_data` | `investments` |
| `open_finance_connections`, `open_finance_accounts`, `open_finance_bills` | `openFinance` |

## Open Finance

A Edge Function valida o usuário e a membership antes de emitir um token temporário. O identificador do item Pluggy é vinculado ao workspace e conferido novamente ao sincronizar, renovar ou revogar o consentimento.

O aplicativo nunca recebe o Client Secret nem a API key do provedor. A senha bancária é informada apenas no ambiente da instituição/provedor durante o consentimento.

## Atualização automática

A build só ativa o updater quando encontra:

- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, se aplicável;
- `TAURI_UPDATER_PUBLIC_KEY`.

Sem esse conjunto, o CI gera um instalador convencional e não publica `latest.json`. Com assinatura:

1. o CI gera o instalador e o arquivo `.sig`;
2. o smoke test abre o executável;
3. o release publica instalador, assinatura e manifesto;
4. o cliente cria backup antes do download;
5. o Tauri valida a assinatura antes da instalação.

## Verificações recomendadas antes da distribuição comercial

- configurar e testar o primeiro par permanente de assinatura Tauri;
- adicionar assinatura Authenticode ao executável/instalador;
- testar dois usuários e dois workspaces com autorizações negativas;
- configurar limites e proteção contra força bruta no Auth;
- revisar sessões e revogação de dispositivos;
- executar secret scanning, dependency scanning e SBOM;
- realizar restauração real de backup em uma máquina Windows limpa.
