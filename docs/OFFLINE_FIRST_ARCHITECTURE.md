# Finança Simples — Arquitetura Offline-First

## Princípio

O aplicativo Windows é o sistema principal. A internet amplia capacidades, mas não é requisito para abrir o programa, consultar dados já existentes ou executar a operação financeira essencial.

A interface, as regras de negócio essenciais e o banco primário do dispositivo são embarcados no instalador. Serviços remotos são tratados como integrações sincronizáveis.

## Camadas

```text
Tauri / Windows
│
├── Frontend embarcado
│   ├── Dashboard
│   ├── Lançamentos
│   ├── Contas
│   ├── Orçamentos
│   ├── Produtos / precificação
│   ├── Estoque
│   ├── Gestão de funcionários
│   ├── DRE / balanço / fluxo de caixa
│   └── Relatórios / exportações
│
├── Núcleo Rust
│   ├── regras locais
│   ├── validação
│   ├── SQLite
│   ├── cache de serviços
│   ├── outbox de sincronização
│   └── backup / recuperação
│
└── Internet quando disponível
    ├── API de sincronização
    ├── Open Finance / Pluggy
    ├── cotações
    ├── regras e tabelas tributárias atualizadas
    ├── agente / IA
    └── atualização do aplicativo
```

## Matriz de disponibilidade

| Função | Offline | Online |
|---|---|---|
| Abrir o sistema | Completo | Completo |
| Consultar histórico | Completo | Completo + sincronizado |
| Lançar receita/despesa | Completo | Completo + sincronização |
| Contas, categorias e centros de custo | Completo | Completo + sincronização |
| Orçamentos | Completo | Completo + compartilhamento/sincronização |
| Precificação | Completo com parâmetros locais | Atualiza parâmetros externos |
| Estoque | Completo | Completo + sincronização |
| Funcionários e folha gerencial | Completo com regras em cache | Atualiza tabelas/regras |
| DRE, balanço e fluxo de caixa | Completo | Completo |
| PDF/CSV/relatórios | Completo | Completo |
| Open Finance | Últimos dados sincronizados | Sincronização ativa |
| Cotações | Último valor em cache, com data | Tempo real |
| IA/agente | Histórico e fila de solicitações | Respostas e ações conectadas |
| Atualizações do app | Versão instalada continua operando | Busca e instala nova versão assinada |

## Banco local

SQLite é o armazenamento transacional do dispositivo.

Requisitos:

- `foreign_keys = ON`;
- journal `WAL`;
- `busy_timeout`;
- migrações versionadas;
- valores monetários em centavos inteiros;
- UUID por entidade criada no cliente;
- exclusões sincronizáveis via tombstone, não remoção imediata;
- datas em ISO 8601;
- backups consistentes e retenção configurável.

## Sincronização

Toda alteração local relevante grava, na mesma transação do dado, um registro na `sync_queue` (outbox pattern).

O servidor deve aceitar uma `idempotency_key` para que repetir um envio não duplique registros.

Fluxo esperado:

1. usuário altera dados localmente;
2. SQLite confirma o commit;
3. registro correspondente já existe na outbox;
4. quando houver internet, o sincronizador envia lotes;
5. servidor confirma versão/revisão;
6. item local passa para `synced`;
7. alterações remotas são recebidas por cursor incremental;
8. conflitos são resolvidos por política explícita, nunca silenciosamente.

## Conflitos

Cada entidade sincronizada deve evoluir para conter:

- `id` UUID;
- `local_revision`;
- `remote_revision`;
- `updated_at`;
- `device_id`;
- `deleted_at` opcional.

Política inicial:

- dados bancários importados: servidor/integração é autoridade;
- lançamentos manuais ainda não sincronizados: cliente é autoridade;
- cadastros editados em dois dispositivos: manter ambas as revisões e solicitar resolução quando houver alteração concorrente real;
- nunca usar somente `updated_at` como garantia de consistência.

## Cache de serviços

Open Finance, cotações e regras tributárias devem gravar a última resposta válida com:

- payload;
- data da atualização;
- validade/expiração;
- origem;
- versão da regra quando aplicável.

No modo offline a interface deve mostrar a idade do cache e não apresentar dados antigos como se fossem atuais.

## Segurança

Nunca armazenar no frontend ou no repositório:

- Client Secret do Pluggy;
- chave privada do updater;
- chaves privadas de IA;
- credenciais bancárias.

Segredos de integração ficam somente no backend. O desktop recebe tokens de sessão/referências com escopo e expiração.

O armazenamento local deverá evoluir com proteção de segredos pelo sistema operacional e mecanismo de bloqueio local opcional.

## Atualização

O aplicativo deve continuar utilizável se o servidor de atualização estiver indisponível.

Atualizações do Tauri serão reativadas somente com:

- chave pública configurada no cliente;
- artefatos assinados;
- chave privada apenas no CI/segredo do repositório;
- rollback/teste de inicialização antes de promoção;
- migrações do banco compatíveis com atualização e recuperação.

## Regra de desenvolvimento

Nenhuma funcionalidade essencial pode depender de `window.location`, iframe ou carregamento obrigatório do site hospedado.

Uma versão só pode ser promovida se:

1. compilar em Windows;
2. abrir sem console;
3. criar/abrir o SQLite local;
4. permanecer executando no smoke test;
5. continuar abrindo com o endpoint remoto indisponível;
6. preservar os dados locais de uma versão anterior.
