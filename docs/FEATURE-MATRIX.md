# Matriz funcional — Finança Simples 1.7

Referência auditada: Google Planilhas **Finança Simples - Essencial 2025**, com abas `MENU`, `JAN` a `DEZ` e `ANUAL`.

**Estado: prévia em homologação.** “Sim” abaixo significa implementação encontrada no código; não equivale a aceite funcional completo no Windows. Os critérios de liberação estão em [VALIDATION-1.7.md](VALIDATION-1.7.md).

| Área | Planilha | Aplicativo Windows 1.7 | Observação |
|---|---|---|---|
| Saldo inicial e renda média | Sim | Sim | Configurados em Parametrização. |
| Categorias de entrada e saída | Sim | Sim | Inclui as categorias originais e categorias personalizadas. |
| Bancos e dinheiro | Sim | Sim | Contas possuem saldo próprio e aceitam transferências. |
| Cartões | Até 3 no modelo | Sim, sem limite fixo | Fechamento, vencimento, limite e categoria da fatura. |
| Saídas | Sim | Sim | À vista, pendentes, fixas, variáveis e parceladas. |
| Entradas | Sim | Sim | Recebidas, previstas, fixas, variáveis e parceladas. |
| Compras no cartão | Sim | Sim | Parcelas são alocadas no ciclo correto da fatura. |
| Pagamento de fatura | Fórmula/checkbox | Sim | A compra e o pagamento não são somados duas vezes. |
| Dashboard mensal | Sim | Sim | Realizado, pendente, resultado, saldo e projeção. |
| Fatura atual e próxima | Sim | Sim | Por cartão e por competência. |
| Rankings | Sim | Sim | Receitas, despesas, cartões e categorias. |
| Visão anual | Sim | Sim | Doze meses e filtros de período no dashboard analítico. |
| Gráficos e composição | Sim | Sim | Volumetria, categorias, cartões e próximo mês. |
| Segurança multiusuário | Não | Sim | Auth, workspaces, papéis, permissões e RLS. |
| Funcionamento offline | Limitado ao navegador | Sim | SQLite/SQLCipher local, sincronização posterior. |
| Open Finance | Não | Parcial, desativado para novas conexões | Cache e backend preparados; faltam consentimento isolado, credenciais e homologação. Sem importação automática de transações. |
| Investimentos e metas | Não | Sim | Carteira manual, resultado, liquidez, vencimentos e metas. |
| Indicadores oficiais | Não | Sim | Dólar, Selic e IPCA via Banco Central, atualizados no servidor. |
| Agente financeiro | Não | Sim | Aurora usa regras transparentes e os dados do próprio ambiente. |
| Simuladores | Não | Sim | Investimentos, crédito, financiamento e consórcio. |
| Backup e exportações | Não | Sim | SQLite consistente, JSON, CSV e impressão em PDF. |

## Regras financeiras verificadas automaticamente

- A soma das parcelas é sempre igual ao valor original, inclusive nos centavos.
- Datas no fim do mês são ajustadas para o último dia válido.
- Compras feitas após o fechamento passam para a fatura seguinte.
- Pagamento de fatura movimenta o caixa uma vez; a compra permanece apenas na análise do cartão.
- Faturas pendentes entram uma vez na projeção de saldo.
- Saldos mensais ignoram lançamentos futuros e carregam o saldo do mês anterior.
- Pagamentos atrasados entram no mês da baixa, preservando o vencimento.
- Simulações rejeitam números inválidos, prazos fracionários e resultados fora do limite seguro.

## Limites intencionais

- O sistema não executa investimentos nem movimentações bancárias.
- Aurora é um assistente educacional baseado em regras, não uma recomendação profissional.
- Cotações individuais de ativos continuam manuais; os dados automáticos atuais são indicadores macroeconômicos oficiais.
- Open Finance real depende de implementação isolada do consentimento, credenciais Pluggy e testes ponta a ponta.
- Login, sincronização, recuperação, restauração de backup e permissões entre dispositivos ainda exigem homologação real.
