# Ativação e homologação

## Implementado nesta revisão

- Updater: primeira consulta após 20 segundos, a cada seis horas, retomada online e nova tentativa após 15 minutos em caso de falha. O comando nativo cria backup consistente antes de instalar; a assinatura Tauri é obrigatória.
- O CI sempre pode gerar instalador de homologação. Sem as chaves permanentes, ele não publica o canal automático nem `latest.json`; execução em pull request também não publica release.
- Login com erro limpa sessões parcialmente abertas. Senha não é mais retida pelo cliente para renovação do token. Uma renovação pendente não recria a sessão depois do logout.
- Sincronização pagina leituras, verifica identidade, respeita permissão de exclusão e preserva edições locais realizadas durante o download. Conflitos entre dispositivos ainda seguem versão/data; não há merge de campos.
- Teste Windows de SQLCipher restaura backup portátil e verifica que chave errada não altera o banco original.
- Aurora usa Responses API com `store:false`, limite de saída, timeout e modelo configurado no servidor. O usuário solicita cada análise; ela recebe resumo local de seis meses, carteira e metas. Não recebe senhas, números de conta nem descrições de lançamentos. A resposta fica somente na memória da sessão e não altera dados ou executa investimentos.
- Cotações B3 individuais pelo endpoint v2 da brapi para ações, ETFs e FIIs. O lote da carteira mantém a data e fonte por posição; resposta ausente, moeda diferente ou ticker renomeado não substitui o preço local. CDB/LCI/LCA continuam exigindo oferta/valor informado pelo usuário.

## Configuração externa necessária

Em GitHub Actions Secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_UPDATER_PUBLIC_KEY` e, se usada, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Gere e guarde a chave permanente conforme UPDATER-SECRETS.md. A versão instalada precisa conter a mesma chave pública; versões antigas sem chave exigem instalar uma primeira versão assinada manualmente. Ainda é necessário homologar a passagem entre duas versões assinadas em Windows.

Em Supabase Edge Function Secrets: `OPENAI_API_KEY`, `AURORA_MODEL` (modelo disponível na conta, compatível com Responses) e `BRAPI_TOKEN`. Configure orçamento/limites no projeto OpenAI e plano/cota da brapi antes de disponibilizar para usuários. O limite de tokens por chamada não é um limite global de gastos. Não há quota persistente por usuário nesta revisão. Nunca envie as chaves pela conversa nem as coloque no repositório. Ausência de configuração retorna indisponibilidade explícita.

Os conectores disponíveis nesta sessão não oferecem gravação de secrets. Não foi possível ativar ou verificar essas credenciais por eles.

## Evidência e limites

Em 22/09/2026: projeto Supabase confirmado `ACTIVE_HEALTHY`; funções `market-data` v3 e `aurora` v1 publicadas com JWT obrigatório e correspondentes ao código do release candidate. O Security Advisor estava sem alertas. Isso não comprova configuração das chaves dos provedores nem resposta autenticada real.

CI Windows do commit `5de5038c769526fbdffca8f58a8e0b0777916788`: run 104 (`35345354303`) concluído com sucesso, incluindo testes Rust, compilação NSIS e smoke test. Assinatura e publicação de release foram ignoradas no PR, como esperado. Há 40 testes Node aprovados localmente, incluindo o teste adicional da periodicidade do updater.

`node tests/integration/cloud-live.mjs` executa autenticação, renovação, gravação e leitura por duas sessões reais da API, somente com as variáveis documentadas no script e um workspace descartável. Esse roteiro não foi executado por falta de credenciais de homologação; não substitui teste do aplicativo instalado. Nunca coloque a senha no código ou nos logs.

Testes locais usam mocks de rede: não equivalem a login real, envio de e-mail, resposta real da IA, cotação contratada ou sincronização entre computadores. A compilação e os testes Rust no CI Windows verificam código nativo, incluindo SQLCipher/DPAPI e restauração em diretório temporário. O smoke test de processo não prova interação com telas.

Para aceite final em Windows: autenticar conta de homologação; criar lançamento offline; reconectar e confirmar em segundo dispositivo; editar em ambos e conferir política de conflito; testar logout/renovação; criar backup portátil; alterar um lançamento; restaurar com chave incorreta (deve preservar dados), depois correta (deve recuperar o snapshot); reabrir e autenticar. Usar ambiente descartável para restauração, pois ela substitui o banco local inteiro. Validar recuperação de senha no e-mail da conta de teste. Não usar dados reais no relatório público.

IA: testar diagnóstico com déficit, renda variável, fatura paga, carteira concentrada, cotação antiga e dados insuficientes. Conferir números, datas, hipóteses, ausência de promessa de retorno e instruções maliciosas em campos livres antes de habilitar amplamente.

Fontes técnicas: https://v2.tauri.app/plugin/updater/ ; https://developers.openai.com/api/docs/guides/text ; https://brapi.dev/docs/acoes/cotacao ; https://supabase.com/docs/guides/functions/secrets .
