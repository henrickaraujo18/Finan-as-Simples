# Finança Simples — nuvem e atualizações

## Supabase

O cliente Windows contém apenas a URL pública e a chave publicável do projeto. A sessão é validada pelo Supabase Auth e os registros financeiros cloud pertencem a um `workspace_id`.

Proteções ativas:

- RLS nas tabelas públicas sensíveis;
- workspaces e memberships;
- permissões por módulo e ação;
- sincronização offline-first com controle de versão;
- auditoria administrativa;
- helpers privilegiados fora do Data API público;
- Edge Functions autenticadas para convites, gestão de membros, dados de mercado e Aurora.

Nunca incluir no cliente ou repositório:

- `sb_secret_...` ou `service_role`;
- chaves de IA;
- credenciais bancárias;
- chave privada do updater.

## Aurora

A função `aurora` exige JWT e valida acesso aos módulos necessários antes de chamar o provedor.

Segredos esperados no Supabase:

- `OPENAI_API_KEY`;
- `AURORA_MODEL`.

A análise usa resumo financeiro limitado e é solicitada explicitamente pelo usuário. A resposta não altera dados nem executa operações financeiras.

## Indicadores e cotações

A função `market-data` fornece:

- dólar comercial;
- meta Selic;
- IPCA mensal;
- cotações B3 individuais para ações, ETFs e FIIs quando configurada.

Para cotações B3, configurar `BRAPI_TOKEN` no servidor. Falhas externas não devem apagar ou substituir silenciosamente o último preço local válido.

## Open Finance

**Adiado para uma etapa posterior.** Não faz parte do aceite da versão 1.7.

A infraestrutura já criada permanece preservada e protegida por autenticação/permissão, mas novas conexões e renovações continuam bloqueadas. O módulo foi removido da navegação principal para não interferir na homologação do restante do sistema.

## Atualização automática Tauri

Fluxo previsto:

1. o app consulta `latest.json` quando há internet;
2. uma versão superior dispara backup local;
3. o updater baixa o instalador;
4. a assinatura Tauri é validada;
5. somente artefato válido é instalado;
6. o aplicativo reinicia.

O CI pode gerar instalador de homologação mesmo sem assinatura. Porém `latest.json`, assinatura e canal automático **não são publicados** sem as chaves permanentes.

Secrets do GitHub Actions:

- `TAURI_UPDATER_PUBLIC_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` quando aplicável.

A chave privada deve ficar somente em armazenamento seguro/GitHub Actions Secrets.

## Primeira transição assinada

Uma instalação antiga que não contém a chave pública do updater precisa receber manualmente a primeira versão assinada. Depois disso, versões seguintes podem usar o canal automático.
