# Finança Simples — nuvem, Open Finance e atualizações

## Supabase

O cliente Windows contém apenas a URL pública e a chave publicável do projeto. A sessão de usuário é validada pelo Supabase Auth e cada registro financeiro possui um `workspace_id`.

Proteções ativas:

- RLS em todas as tabelas públicas sensíveis;
- workspaces e memberships para isolamento entre clientes;
- permissões por módulo e ação;
- sincronização offline-first com controle de versão;
- auditoria de operações administrativas;
- helpers privilegiados fora do Data API público;
- Edge Functions autenticadas para convites, gestão de membros, dados de mercado e Open Finance.

Nunca incluir no aplicativo ou no repositório:

- `sb_secret_...` ou `service_role`;
- `PLUGGY_CLIENT_SECRET`;
- chaves de IA;
- senhas bancárias;
- chave privada de assinatura do updater.

## Open Finance

Nova conexão e renovação estão bloqueadas nesta prévia, inclusive a emissão de tokens pela função. O widget não é carregado no contexto privilegiado do Tauri.

O código existente verifica JWT, membership e permissão `openFinance` e contém consulta/revogação de itens vinculados ao workspace, além de cache de instituições, contas e faturas. Esses fluxos precisam de homologação com o provedor. Não há importação/conciliação automática de transações bancárias.

Antes de produção: implementar consentimento isolado, validar campos e paginação da API e configurar `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` diretamente nos segredos das Edge Functions do Supabase. O token da API Pluggy nunca deve ser enviado ao aplicativo.

## Indicadores do Banco Central

A função autenticada `market-data` consulta o SGS do Banco Central para dólar comercial, meta Selic e IPCA mensal. O aplicativo mantém a última leitura no banco local para consulta offline.

## Atualização automática Tauri

Fluxo de produção:

1. o app consulta `latest.json` quando há internet;
2. uma versão superior dispara backup local;
3. o updater baixa o instalador;
4. a assinatura Tauri é validada;
5. somente um artefato válido é instalado;
6. o aplicativo reinicia.

A publicação de `latest.json` é bloqueada quando a build não possui as chaves de assinatura.

Secrets exigidos no GitHub Actions:

- `TAURI_UPDATER_PUBLIC_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (se aplicável).

Gere o par com o Tauri CLI fora do repositório. A chave privada deve permanecer exclusivamente em armazenamento seguro/GitHub Actions Secrets e possuir cópia de recuperação.

## Primeira transição assinada

Versões antigas sem uma chave pública de updater precisam receber manualmente o primeiro instalador assinado. Depois disso, versões futuras podem usar o canal automático.
