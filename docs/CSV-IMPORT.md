# Importação de fatura CSV — Finança Simples

A importação está disponível em **Lançamentos → Importar fatura CSV**. Cadastre antes o cartão em **Contas & Cartões**.

1. Selecione o cartão e a data de vencimento da fatura.
2. Escolha o CSV original do banco. São aceitos arquivos UTF-8, Windows-1252/ISO-8859-1 e UTF-16 com BOM, delimitados por vírgula ou ponto e vírgula.
3. Opcionalmente, informe o valor líquido da fatura para conferir com a soma das linhas.
4. Clique em **Analisar fatura CSV**. Nada é gravado nesta etapa.
5. Confira os itens, suas categorias, os alertas e os valores. Lançamentos identificados como duplicados são desmarcados e desabilitados.
6. Marque a confirmação de avisos quando existir divergência, crédito/estorno ou compra com data futura.
7. Clique em **Confirmar lançamentos selecionados** para persistir apenas os itens escolhidos.

## Regras financeiras

- Cada linha do arquivo equivale a **uma parcela já cobrada nessa fatura**. `4/12` é gravado como quarta de doze, mas não cria outras 11 parcelas ou lançamentos futuros.
- Valores negativos são preservados como créditos/estornos contra o total do cartão. Verifique manualmente os créditos para os quais o banco não usa sinal negativo.
- A categorização é uma sugestão de correspondência local com categorias existentes, e pode ser corrigida antes de confirmar.
- Duplicatas são reconhecidas por cartão, mês da fatura, data da compra, descrição normalizada, parcela e valor. Compras indistinguíveis podem exigir revisão do operador.
- O sistema relê a base antes da gravação e recusa duplicatas adicionais encontradas nesse intervalo. **Não é uma garantia de unicidade no banco** em sessões realmente simultâneas.
- Se já existir pagamento da fatura registrado, a importação é bloqueada para evitar uma nova cobrança incorreta.
- Datas inválidas, valores zerados e linhas malformadas causam erro explícito em vez de serem descartados silenciosamente.
- O importador não modifica lançamentos anteriormente existentes.

## Homologação

O teste `node --test tests/invoice-csv-v18.test.mjs` cobre caracteres acentuados do Bradesco, delimitadores, aspas, estornos, centavos, parcelamentos e duplicidades.

Recomenda-se validar com fatura fictícia em um ambiente de teste antes de importar o extrato real e baixar a fatura.
