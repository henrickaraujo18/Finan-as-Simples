# Finança Simples para Windows

O **Finança Simples** é um aplicativo Windows offline-first de organização financeira, criado a partir das regras da planilha **Finança Simples - Essencial 2025**. O app usa Tauri 2, banco SQLite/SQLCipher local e sincronização opcional pelo Supabase.

Ele é independente do sistema **Seja Doce** e não contém produtos, precificação, estoque, funcionários ou folha de pagamento.

## Funcionalidades

### Planilha Essencial 2025

- dashboard mensal com entradas, saídas, resultado, saldo atual e projetado;
- valores realizados, a pagar e a receber;
- saldo inicial, crescimento e renda média mensal;
- lançadores de saída, entrada e compra no cartão;
- despesas e receitas fixas ou variáveis;
- parcelamento em até 60 vezes com conservação exata dos centavos;
- cartões com fechamento, vencimento, limite e categoria de fatura;
- faturas do mês e do mês seguinte, pagamento e prevenção de contagem dupla;
- rankings de despesas, receitas, cartões e categorias;
- dashboard analítico por período e resumo anual;
- contas bancárias, dinheiro e transferências entre contas;
- categorias originais da planilha, com possibilidade de personalização.

### Recursos do sistema

- autenticação por e-mail e senha, ambientes financeiros isolados e permissões por módulo;
- funcionamento completo sem internet e sincronização automática quando a sessão volta a ficar online;
- banco local criptografado no Windows, chave protegida por DPAPI, backup consistente e recuperação;
- importação local de fatura CSV, exportação CSV/JSON e impressão em PDF;
- carteira de investimentos, metas, perfil de risco e acompanhamento de liquidez;
- indicadores de dólar, Selic e IPCA obtidos no servidor a partir do Banco Central e mantidos em cache local;
- **Aurora**, agente financeiro baseado em regras, com alertas sobre liquidez, orçamento, reserva e metas;
- simuladores de investimentos, empréstimos, financiamentos e consórcios;
- Open Finance via Pluggy, com consentimento, saldos e faturas, sem colocar credenciais do provedor no executável;
- atualização automática assinada quando o canal de assinatura de produção estiver configurado.

## Arquitetura e segurança

- Os dados do usuário ficam primeiro no SQLite local e continuam disponíveis offline.
- O Supabase Auth identifica o usuário e a Row Level Security isola cada `workspace`.
- Dados de Open Finance também respeitam a permissão do ambiente.
- O token temporário da conexão bancária permanece apenas em memória.
- `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, chaves secretas do Supabase e a chave privada do updater nunca entram no frontend, no instalador ou no repositório.
- A chave publicável do Supabase pode existir no cliente; a proteção dos dados é feita pela identidade do usuário, permissões e RLS.

## Estado das integrações externas

O backend, as funções e a interface do Open Finance estão implementados. Para autorizar instituições reais, a conta Pluggy de produção precisa ter suas credenciais cadastradas diretamente como segredos do Supabase.

O atualizador só publica `latest.json` quando o GitHub Actions possui o par de assinatura Tauri. Sem ele, o pipeline publica um instalador normal, mas não oferece uma atualização não assinada.

## Desenvolvimento

Pré-requisitos no Windows:

- Node.js 22 ou superior;
- Rust estável;
- Microsoft C++ Build Tools;
- WebView2 Runtime.

```powershell
npm ci
npm run test:financial
npm run dev
```

Para gerar o instalador NSIS sem canal de atualização:

```powershell
npm run build -- --config src-tauri/tauri.unsigned.conf.json --bundles nsis
```

## Validação automática

O workflow Windows valida a sintaxe do frontend, o escopo do produto, as funções avançadas obrigatórias, os cálculos financeiros em Node, os testes Rust, o núcleo Tauri, a compilação NSIS e um smoke test do executável. O instalador só é publicado quando todas essas etapas passam.

Consulte também:

- [`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md)
- [`docs/CLOUD-AND-UPDATES.md`](docs/CLOUD-AND-UPDATES.md)
- [`docs/SECURITY-1.7.md`](docs/SECURITY-1.7.md)
- [`docs/SUPABASE-DEPLOY.md`](docs/SUPABASE-DEPLOY.md)
