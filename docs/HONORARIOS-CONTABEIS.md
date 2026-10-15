# Módulo Honorários Contábeis (piloto)

O módulo **Honorários Contábeis** é uma extensão do Finança Simples Windows 1.7.
Ele não substitui o livro-caixa nem mantém uma segunda contabilidade financeira.

## Fluxo

1. Cadastre um cliente com código único, regime, honorário, vencimento e início.
2. Em Cobranças selecione a competência e clique **Gerar mensalidades**. A geração é idempotente pelo par cliente/competência/tipo mensalidade.
3. É possível criar cobranças avulsas e alterar cobranças ainda não totalmente recebidas.
4. Em Recebimentos selecione cobrança, data, conta de entrada, meio e valor. A confirmação cria **uma única transação de receita** com os identificadores da cobrança e do recibo no mesmo lote local atômico.
5. O dashboard destaca faturamento por competência, entradas por data de caixa, saldo e inadimplência vencida em toda a carteira.

## Migração da planilha Excel

A planilha Controle_de_Honorarios_Contabeis_Dashboard.xlsx tem três abas de dados: Clientes, Honorários e Recebimentos.
Exporte cada aba como CSV separado por ponto e vírgula e importe, nessa ordem, em **Honorários > Importar / Exportar**.
Importações pulam linhas vazias e IDs de origem já migrados. Se houver recebimentos, selecione a conta de entrada para registrá-los no livro-caixa.

**Antes de importar recebimentos históricos**, compare o livro-caixa existente com os pagamentos da planilha.
A rotina cria lançamentos de entrada para todos os recebimentos importados: se os mesmos pagamentos já tiverem sido digitados diretamente no livro-caixa, é preciso conciliá-los previamente, para não duplicar receitas.

## Migração técnica / deploy

- Aplique a migração Supabase `009_accounting_fees.sql` antes de sincronizar estes novos tipos.
- Os tipos `fee_clients`, `fee_charges` e `fee_receipts` são armazenados no banco local criptografado e participam da sincronização por workspace.
- Permissões atuais de **Lançamentos (transactions)** também regem Honorários; nenhuma permissão adicional é concedida.
- Teste o instalador Windows e a sincronização com base real antes de publicar o updater assinado.
- O app não faz baixa bancária automática nem emite boletos/notas fiscais nesta versão.

## Melhorias de cobrança e conciliação

- Na abertura do aplicativo, após carregar os dados do ambiente, o sistema gera as mensalidades da competência atual para clientes ativos, com honorário positivo e contrato vigente (início e fim inclusivos por competência). Não gera meses históricos automaticamente; use **Gerar mensalidades** para competências anteriores.
- A geração evita a repetição local por cliente/competência/tipo mensalidade. Em cenários de múltiplos dispositivos offline, é necessário validar conflitos após sincronização antes de assumir unicidade global.
- Na aba **Conciliação**, selecione uma cobrança em aberto e uma receita previamente realizada no livro-caixa. A operação cria apenas o vínculo de recebimento e atualiza o lançamento existente, preservando sua identificação, conta e valor. Não cria outra entrada.
- Só são elegíveis receitas já pagas, ainda não vinculadas e com valor integral menor ou igual ao saldo da cobrança; quando um depósito cobre várias cobranças, divida o lançamento antes de conciliar.
- Recomendado homologar em cópia da base, particularmente com múltiplos dispositivos, antes de publicar o atualizador.
