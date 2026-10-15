# Recuperação do atualizador automático — versão 1.7.1

## Causa raiz verificada

A compilação de outubro tinha `SIGNED_UPDATE=false`: não incorporou a chave pública, e o job `Publicar pré-release e manifesto de atualização` foi ignorado. No GitHub existia um instalador antigo sem `latest.json`, logo o aplicativo mostrava "aguardando assinatura" e não tinha como instalar uma atualização automática.

A versão `1.7.0` também não era incrementada apesar de haver novas funcionalidades. O Tauri só instala se a versão remota for superior à atual.

## Correções na versão 1.7.1

- Agendamento de verificação em 20 segundos no início **sem depender de login**; depois, a cada seis horas.
- Evento de reconexão dispara verificação em **um segundo**.
- Retentativa de 15 minutos após erros, exibindo a causa (ex.: HTTP 404 em manifesto).
- Instalação sem chave pública mostra explicitamente que **exige instalação manual da primeira versão assinada**.
- Pipeline principal **falha** se não existirem as chaves de assinatura; não há mais CI verde simulando publicação assinada.
- `FINANCA_UPDATER_PUBLIC_KEY` foi disponibilizada aos dois fluxos de release, e o endpoint de build pode selecionar `desktop-preview` ou `releases/latest`.
- Versão `1.7.1` unificada em Tauri, Cargo e npm.

## Procedimento de ativação

1. Em um computador confiável, com Tauri CLI instalado, execute `npm run signer:generate` para criar par de chaves **Ed25519 do Tauri updater**. Preserve o arquivo privado e qualquer senha em cofre seguro. **Não envie a chave privada no chat nem a registre no repositório.**
2. Em **GitHub → Finan-as-Simples → Settings → Secrets and variables → Actions**, crie `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo da **chave privada** e `TAURI_UPDATER_PUBLIC_KEY` com o conteúdo da **chave pública**. Se houver senha, configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Acione **Actions → Gerar instalador Windows → Run workflow** na branch `main`. A compilação deve gerar `.exe`, `.sig` e publicar o `latest.json` do canal `desktop-preview`. Confirme no Release que os três arquivos existem e que o JSON tem versão **1.7.1** e assinatura não vazia.
4. Como o executável anterior foi construído **sem chave pública**, o updater dele não pode ser reparado remotamente. Faça backup primeiro e instale **manualmente uma única vez** a nova versão **assinada** sobre a versão anterior. Não desinstale nem apague a pasta de dados do aplicativo.
5. Nas versões seguintes, mantenha **a mesma chave de assinatura** e incremente a versão. Teste no Windows instalando duas versões assinadas sucessivas, desconectando e reconectando a internet e conferindo o status de atualização.

## Cuidados

- **Não desative validação de assinatura, nem use URL HTTP** como alternativa.
- O instalador NSIS de homologação gerado no pull request é **sem assinatura de updater**. Não use como base do primeiro auto-update.
- A conexão ao Supabase é independente do GitHub Release e da assinatura do updater. A tela pode indicar login da nuvem necessário sem impedir a verificação de atualizações.
- Não é possível comprovar atualização ponta a ponta apenas com os testes Node/CI. É necessário homologar com uma instalação assinada real e manifesto publicado.
