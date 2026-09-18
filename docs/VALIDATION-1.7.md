# Validação e pendências — Finança Simples 1.7

## Situação

Versão de revisão, ainda não aprovada para produção. O app Windows é a base de implementação; o site anterior não foi alterado. O trabalho não deve ser descrito como “sistema completo” enquanto os critérios abaixo estiverem pendentes.

## Implementado e testado automaticamente

30 testes Node cobrem cálculos de parcelas, ciclos de cartão, não duplicação de faturas, saldos históricos, baixa em atraso, simuladores, renderização em DOM simulado, convergência do cabeçalho, bloqueio de troca de ambiente, autorização das funções em mocks e indisponibilidade de indicadores.

As alterações incluem carteira, metas, indicadores BCB, Aurora baseada em regras, simuladores e tipos de dados correspondentes no SQLite/Supabase. Scripts de terceiros não são carregados no contexto privilegiado do Tauri. Respostas bancárias parciais não apagam registros do cache.

Executar:

```powershell
npm ci
npm run test:financial
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml
```

O GitHub Actions compila o instalador Windows e verifica que o executável permanece aberto por 15 segundos. Em PR, gera artefato de teste sem publicar release. O resultado específico do run deve ser consultado no PR; um resultado de versão anterior não valida a 1.7.

## Critérios de aceite ainda pendentes

| Critério | O que falta validar ou implementar |
|---|---|
| Paridade completa com a planilha | Roteiro manual com receitas, despesas, parcelas e faturas de vários meses; comparar saldos e rankings com as fórmulas originais. |
| Interface Windows | Cadastro, edição, exclusão, ida e volta entre todas as telas, layouts e ausência de erros JavaScript no WebView2 real. |
| Identidade e permissões | Proprietário, operador e consulta em dois ambientes, incluindo negações de acesso, convites, login offline e recuperação de senha. |
| Sincronização | Dois dispositivos, reconexão, conflitos, exclusões e troca de ambiente durante requisições. |
| Backup | Restaurar cópia consistente numa máquina Windows de teste e confirmar comportamento da chave DPAPI; manter cópia dos dados anteriores. |
| Open Finance | Implementar consentimento isolado do aplicativo, configurar credenciais por canal seguro e validar paginação, campos, renovação e revogação. Nova conexão/renovação estão bloqueadas no app e na função. |
| Dados bancários | Cache de saldos e faturas não equivale à importação/conciliação automática de transações; esta ainda não está implementada. |
| Atualização automática | Configurar par de assinatura Tauri e testar upgrade com backup. Builds sem chaves não têm auto-update. |
| Continuidade com o web | Site anterior e app usam persistências distintas; definir migração ou convergência antes de prometer a mesma base em ambos. |
| IA e cotações individuais | Aurora é um mecanismo local de regras. IA generativa, regras atualizadas no servidor e preços automáticos por ativo não estão implementados. |
| Importadores | O desktop importa CSV; os demais formatos existentes no web precisam de portabilidade e testes. |

## Credenciais e consentimento

Não enviar senhas bancárias, Client Secret, service role ou chave privada de assinatura no chat ou no repositório. Configurar apenas nos gestores de segredos dos provedores correspondentes. A autorização de uma instituição bancária é uma ação do titular e não deve ser executada automaticamente pelo desenvolvimento.

## Evidências de referência

- Planilha “Finança Simples — Essencial 2025”, preservada sem escrita nesta implementação; seus dados privados não são versionados neste repositório.
- [SGS 1: dólar americano de venda](https://dadosabertos.bcb.gov.br/dataset/1-taxa-de-cambio---livre---dolar-americano-venda---diario).
- [Limites de segurança e acesso remoto do Tauri](https://v2.tauri.app/security/capabilities/).

Os testes de funções são isolados, com respostas simuladas; não comprovam uma conexão bancária nem login de produção. A ausência de alertas no Security Advisor também não substitui testes de autorização e revisão de aplicação.
