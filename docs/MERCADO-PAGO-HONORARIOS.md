# Mercado Pago CPF — integração de honorários (especificação de implantação)

Estado: **preparação em Sandbox; nenhuma cobrança real habilitada**.

## Decisões

- Recebedor: conta Mercado Pago de pessoa física do prestador, com atividade e titularidade compatíveis com os contratos.
- Checkout Pro: `POST https://api.mercadopago.com/checkout/preferences`, `external_reference` estável derivado de workspace + cobrança.
- Cobrança mensal: uma preferência por cobrança; não utilizar simultaneamente assinatura Mercado Pago e gerador de mensalidades Finança Simples.
- Meios: Pix e boleto quando habilitados no checkout/conta; disponibilidade deve ser testada.
- Não armazenar `access_token` nem segredo webhook no Tauri/JS, GitHub ou banco acessível por RLS.
- Credenciais devem residir apenas nos Secrets do Supabase: `MP_ACCESS_TOKEN_SANDBOX`, `MP_WEBHOOK_SECRET_SANDBOX`. Produção usa secrets separados.
- Configuração padrão: `MP_PAYMENTS_ENABLED=false` e `MP_ENV=sandbox`; jamais alternar para produção automaticamente.
- Envio: e-mail via provedor habilitado; WhatsApp exige integração/autorização própria. Não afirmar que o Mercado Pago envia mensagens personalizadas automaticamente.

## Operações a implementar após acesso administrativo restabelecido

1. Banco: adicionar tabela `fee_payment_links` por workspace/charge com unicidade `(workspace_id,charge_id,provider)`, status e `preference_id`; tabela privada de eventos com unicidade por payment-id e transição de status; políticas RLS restritas a membros autorizados, gravações pelo backend.
2. API autenticada `mp-create-checkout`: recuperar valor, competência, cliente e situação da cobrança **no servidor**, verificar permissões do workspace e saldo, bloquear cobranças já quitadas, usar idempotência/transação e criar preferência MP; persistir o vínculo antes de devolver URL. Nunca confiar em valor informado pelo cliente.
3. API pública `mp-webhook`: validar `x-signature` usando `ts`, `v1`, `x-request-id` e `data.id` conforme documentação vigente; recusar assinaturas inválidas; consultar a API MP com credencial do vendedor e conferir `external_reference`, valor, moeda, beneficiário e status. Responder rapidamente; processar em operação idempotente.
4. Pagamentos aprovados: criar **um único** recebimento e transação financeira vinculados, na mesma transação SQL, usando chave única no `payment_id`. Não dar baixa por callback da tela nem pela notificação não verificada. Registrar estornos/devoluções como reversões auditáveis.
5. Taxas: contabilizar honorário bruto, tarifa MP e crédito líquido separadamente; reconciliar data de aprovação vs disponibilização/repasse conforme política de caixa escolhida.
6. Agendamento: função cron cria cobranças após sincronização e respeita vigência do contrato; necessita lock/índice único para clientes em dispositivos offline. Notificações devem ter opt-in, preferência de canal e registro de tentativas.
7. Homologação: cenários Pix, boleto, vencimento, pagamento duplicado, webhook duplicado ou fora de ordem, lançamento já conciliado, chargeback/estorno e desconexão de rede.

## Ativação pelo titular

1. Acessar https://www.mercadopago.com.br/developers/panel/app e criar aplicação "Finança Simples – Honorários" com Checkout Pro.
2. Verificar chave Pix cadastrada e meios de pagamento liberados; entrar em credenciais de teste.
3. Configurar os secrets diretamente no Supabase, **sem enviar tokens pelo chat**.
4. Após publicar `mp-webhook` no Supabase, cadastrar a URL de teste no Mercado Pago Developers, selecionar eventos de pagamentos e registrar o secret de assinatura.
5. Executar testes com contas de teste Mercado Pago e somente então aprovar o modo produção.

Fontes:
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/create-payment-preference
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/create-preference/post
