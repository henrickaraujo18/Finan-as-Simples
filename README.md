# Finança Simples para Windows

O **Finança Simples** é um aplicativo de controle financeiro para Windows construído com Tauri 2 e banco SQLite local. Ele é uma aplicação independente do sistema **Seja Doce** e não contém módulos de produtos, precificação, estoque, funcionários ou folha.

## Escopo do Finança Simples

- **Dashboard**: saldo atual, saldo previsto, receitas realizadas, receitas a receber, despesas realizadas, despesas a pagar, resultado do período, movimento diário, despesas por categoria e comprometimento de cartão em relação à renda média parametrizada.
- **Lançamentos**: receitas e despesas, realizado/pendente, conta, categoria, forma de pagamento, vencimento, edição, baixa e exclusão.
- **Importação de fatura**: importação local de CSV com data, descrição e valor, sem enviar o arquivo para serviços externos.
- **Open Finance**: cadastro manual de contas funciona offline. A conexão automática somente será habilitada quando existir backend seguro; credenciais nunca devem ser embarcadas no executável.
- **Investimentos**: cadastro de posições, quantidade, preço médio, preço atual e resultado. Cotações automáticas somente serão ativadas quando o serviço online estiver integrado.
- **Parametrização**: saldo inicial, renda média mensal, limite de cartões, conta padrão, integridade do banco, backup SQLite e exportação JSON.

## Armazenamento e funcionamento offline

No Windows, os dados ficam em SQLite no diretório de dados do aplicativo. O banco usa WAL, `busy_timeout` e verificação `PRAGMA quick_check`. O Finança Simples não depende de um site privado para abrir e continua funcionando sem internet para suas funções locais.

A versão 1.2.0 não apaga automaticamente registros antigos de módulos que foram incluídos por engano em builds anteriores. Esses tipos deixam de ser aceitos e não aparecem na interface, evitando perda acidental de dados.

## Desenvolvimento

Pré-requisitos no Windows:

- Node.js 22 ou superior
- Rust estável
- Microsoft C++ Build Tools
- WebView2 Runtime

```powershell
npm install
npm run dev
```

Para gerar o instalador NSIS:

```powershell
npm ci
npm run build -- --config src-tauri/tauri.unsigned.conf.json --bundles nsis
```

## Validação automática

O workflow Windows executa:

1. validação sintática do frontend com `node --check`;
2. trava de escopo para impedir reentrada de módulos da Seja Doce;
3. testes Rust do banco e dos tipos permitidos;
4. `cargo check`;
5. compilação NSIS;
6. smoke test abrindo o executável por 15 segundos;
7. publicação do instalador somente após os testes passarem.

## Segurança

Nunca coloque no código, no Tauri ou no GitHub público:

- Client Secret ou API keys do Pluggy/Open Finance;
- chaves de IA;
- senhas bancárias;
- chave privada de assinatura do atualizador.

Credenciais que tenham sido expostas anteriormente devem ser rotacionadas antes de qualquer integração de produção.

## Atualizações automáticas

A atualização automática assinada do executável será reativada somente com um canal de assinatura configurado e testado. Até lá, builds de manutenção são distribuídas como novos instaladores para não repetir a falha de inicialização causada por configuração incompleta do updater.
