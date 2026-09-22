# Validação e aceite — Finança Simples 1.7

## Situação

A versão 1.7 é o **release candidate para homologação real no Windows**. O escopo desta entrega inclui o aplicativo financeiro desktop, autenticação, ambientes e permissões, sincronização offline-first, banco local criptografado, backup/restauração, investimentos, metas, indicadores, cotações B3, simuladores e Aurora com IA.

**Open Finance foi adiado para uma etapa posterior e não faz parte do critério de aceite da 1.7.** A infraestrutura já criada permanece preservada e bloqueada para novas conexões; o acesso foi retirado da navegação principal.

## Implementado e coberto por testes automáticos

- dashboard mensal e analítico;
- entradas, saídas, pendências, baixas e recorrências já suportadas pelo modelo atual;
- cartões, fechamento, vencimento, parcelamento e pagamento de fatura sem contagem dupla;
- contas, transferências e saldos históricos;
- categorias e parametrização;
- carteira de investimentos e metas;
- indicadores de dólar, Selic e IPCA via serviço de servidor;
- cotações individuais B3 para ações, ETFs e FIIs via `market-data`;
- Aurora com IA pela Responses API, executada no servidor e sem chave no aplicativo;
- autenticação Supabase, workspaces, permissões e RLS;
- sincronização offline-first com tratamento de conflitos por versão/data;
- SQLCipher com chave protegida por DPAPI no Windows;
- backup consistente, backup portátil e restauração;
- atualização automática preparada com assinatura Tauri;
- testes Node, Rust, `cargo check`, compilação NSIS e smoke test no CI Windows.

Executar localmente:

```powershell
npm ci
npm run test:financial
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml
```

## Homologação real que deve ser feita com o instalador

Os itens abaixo são testes de aceite, não funcionalidades pendentes de implementação:

| Área | Roteiro de homologação |
|---|---|
| Interface Windows | Abrir e percorrer Dashboard, Lançamentos, Contas & Cartões, Dashboard Analítico, Investimentos, Parametrização e Usuários & Acessos; cadastrar, editar e excluir registros. |
| Login | Entrar com conta real, sair, entrar novamente e confirmar persistência/renovação da sessão conforme esperado. |
| Permissões | Validar proprietário, operador e consulta, incluindo negações de criação/edição/exclusão. |
| Sincronização | Criar lançamento offline, reconectar e confirmar o registro em outra sessão/dispositivo; depois testar edição concorrente e exclusão. |
| Recuperação de senha | Solicitar e concluir a recuperação usando uma conta de homologação. |
| Backup | Criar backup, alterar dados, testar chave incorreta e depois restaurar corretamente em ambiente descartável. |
| Aurora | Validar resposta real com cenários de déficit, renda variável, reserva insuficiente, concentração de carteira, cotação antiga e dados insuficientes. |
| Cotações | Atualizar PETR4/VALE3 ou outro ativo de teste e conferir fonte, data e preservação do preço local quando a API estiver indisponível. |
| Atualizador | Quando as chaves Tauri forem configuradas, instalar uma versão assinada e homologar o upgrade para uma versão seguinte com backup automático. |

## Dependências externas de ativação

Para Aurora e cotações, os segredos de servidor precisam estar configurados no Supabase:

- `OPENAI_API_KEY`;
- `AURORA_MODEL`;
- `BRAPI_TOKEN`.

Para o canal de atualização automática:

- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_UPDATER_PUBLIC_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` quando aplicável.

A ausência dessas chaves **não impede gerar o instalador de homologação**. Ela apenas deixa indisponível o recurso externo correspondente ou impede a publicação de atualização automática assinada.

## Fora do escopo da 1.7

- Open Finance / Pluggy, consentimento bancário e importação automática de transações;
- convergência com um site legado separado, caso ele volte a ser utilizado;
- execução automática de investimentos ou movimentações bancárias.

O sistema não deve armazenar no cliente chaves privadas, service role, Client Secret bancário ou chave de IA.
