# Matriz funcional — Finança Simples 1.7

Referência funcional: **Finança Simples - Essencial 2025**.

**Estado: release candidate para homologação real.** “Implementado” significa que o recurso está presente no código e coberto pelo nível de teste indicado; a validação final de uso deve ser feita no aplicativo instalado.

| Área | Situação 1.7 | Observação |
|---|---|---|
| Dashboard mensal | Implementado | Realizado, pendente, resultado, saldo e projeção. |
| Lançamentos | Implementado | Entradas, saídas, baixas, parcelamento e vencimentos. |
| Contas e transferências | Implementado | Saldos próprios, dinheiro e transferências. |
| Cartões e faturas | Implementado | Fechamento, vencimento, limite e pagamento sem duplicidade. |
| Dashboard Analítico | Implementado | Períodos, rankings, composição e visão anual. |
| Categorias e parametrização | Implementado | Inclui categorias-base e personalização. |
| Multiusuário | Implementado | Supabase Auth, workspaces, papéis, permissões e RLS. |
| Funcionamento offline | Implementado | SQLCipher local e sincronização posterior. |
| Sincronização | Implementada | Pronta para homologação real entre sessões/dispositivos. |
| Backup e restauração | Implementado | Backup consistente, portátil e recuperação testada automaticamente. |
| Investimentos | Implementado | Carteira manual, resultado, liquidez e vencimentos. |
| Metas financeiras | Implementado | Valor-alvo, acumulado, prazo e progresso. |
| Indicadores oficiais | Implementado | Dólar, Selic e IPCA via servidor/BCB com cache local. |
| Cotações B3 | Implementado | Ações, ETFs e FIIs via serviço `market-data`; depende de `BRAPI_TOKEN`. |
| Aurora | Implementado | IA via servidor/Responses API; depende de `OPENAI_API_KEY` e modelo configurado. |
| Simuladores | Implementado | Investimentos, empréstimos, financiamentos e consórcios. |
| Exportações | Implementado | JSON, CSV quando aplicável e impressão/PDF. |
| Atualização automática | Implementada no código | Publicação automática depende da assinatura Tauri de produção. |
| Open Finance | **Adiado** | Fora do escopo da 1.7; infraestrutura preservada e conexão bloqueada. |

## Regras financeiras verificadas automaticamente

- parcelas conservam exatamente o valor original, inclusive centavos;
- datas no fim do mês são ajustadas ao último dia válido;
- compras após fechamento passam para a fatura seguinte;
- pagamento de fatura movimenta o caixa uma vez;
- faturas pendentes entram uma vez na projeção;
- saldos mensais carregam corretamente o histórico;
- pagamentos atrasados entram no mês da baixa preservando vencimento;
- simulações rejeitam entradas inválidas e estouros;
- cotações ausentes não substituem silenciosamente preços locais;
- Aurora não é chamada quando faltam autorização ou configuração.

## Limites intencionais

- o sistema não executa compras, vendas ou transferências bancárias;
- Aurora produz análise de apoio e não executa ações;
- CDB, LCI/LCA e outros ativos sem cotação padronizada continuam com valor informado pelo usuário;
- Open Finance será tratado em uma etapa própria.
