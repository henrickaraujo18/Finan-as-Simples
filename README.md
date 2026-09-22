# Finança Simples para Windows

O **Finança Simples** é um aplicativo Windows offline-first de organização financeira, construído com Tauri 2, SQLCipher local e sincronização opcional pelo Supabase. A referência funcional inicial foi a planilha **Finança Simples - Essencial 2025**.

Ele é independente do sistema **Seja Doce**.

## Estado da versão 1.7

A versão **1.7.0** é o release candidate para homologação real no Windows.

Entram no escopo desta versão:

- dashboard mensal e analítico;
- lançamentos, contas, cartões, faturas e transferências;
- ambientes financeiros, usuários e permissões;
- operação offline e sincronização posterior;
- SQLCipher + DPAPI;
- backup, recuperação e exportações;
- investimentos e metas;
- indicadores BCB;
- cotações B3 de ações, ETFs e FIIs;
- Aurora com IA executada no servidor;
- simuladores financeiros;
- mecanismo de atualização automática assinada.

**Open Finance foi adiado e está fora do critério de aceite da 1.7.** A infraestrutura existente foi preservada, mas novas conexões permanecem bloqueadas e o módulo não aparece na navegação principal.

## Segurança e armazenamento

- dados financeiros ficam primeiro no banco local criptografado;
- a chave do banco é protegida pelo Windows/DPAPI;
- o Supabase Auth identifica o usuário;
- cada registro cloud pertence a um `workspace_id`;
- RLS e permissões de módulo isolam os ambientes;
- a interface não contém `service_role`, Client Secret bancário, chave privada do updater ou chave de IA;
- backups consistentes são criados antes de atualização automática.

## Aurora

A Aurora usa uma Edge Function autenticada e a Responses API. O aplicativo envia somente um resumo financeiro necessário à análise, como agregados por período, carteira, metas e a pergunta do usuário.

Não são enviados pela Aurora:

- senha;
- números completos de conta;
- credenciais bancárias;
- descrições individuais dos lançamentos.

A ativação depende de `OPENAI_API_KEY` e `AURORA_MODEL` configurados como segredos no servidor.

## Cotações e indicadores

- dólar, Selic e IPCA são consultados no servidor a partir de fontes do Banco Central;
- ações, ETFs e FIIs podem receber cotações individuais pelo serviço `market-data`;
- a cotação B3 depende de `BRAPI_TOKEN`;
- quando uma cotação automática não está disponível, o aplicativo preserva o último preço válido/manual.

## Atualizações

O aplicativo possui o fluxo de updater Tauri com:

1. consulta periódica;
2. backup antes de instalar;
3. download do instalador;
4. validação criptográfica da assinatura;
5. instalação e reinício.

O CI sempre pode gerar um **instalador de homologação**. A publicação de `latest.json` e do canal automático só ocorre quando a assinatura de produção estiver configurada.

Secrets do updater:

- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_UPDATER_PUBLIC_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, quando aplicável.

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

Instalador NSIS sem canal de atualização:

```powershell
npm run build -- --config src-tauri/tauri.unsigned.conf.json --bundles nsis
```

## Validação

O GitHub Actions executa verificações estáticas, testes financeiros em Node, testes Rust, `cargo check`, compilação NSIS e smoke test do executável.

Os próximos passos são testes reais do instalador, não desenvolvimento de novas funções do escopo 1.7. Consulte:

- [Validação e aceite](docs/VALIDATION-1.7.md)
- [Matriz funcional](docs/FEATURE-MATRIX.md)
- [Ativação da Aurora e updater](docs/ACTIVATION-AURORA-UPDATES.md)
- [Nuvem e atualizações](docs/CLOUD-AND-UPDATES.md)
- [Segurança 1.7](docs/SECURITY-1.7.md)
