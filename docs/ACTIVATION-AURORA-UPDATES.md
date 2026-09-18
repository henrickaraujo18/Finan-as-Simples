# Ativação e homologação

## Implementado nesta revisão

- Updater: primeira consulta após 20 segundos, a cada seis horas, retomada online e nova tentativa após 15 minutos em caso de falha. O comando nativo cria backup consistente antes de instalar; a assinatura Tauri é obrigatória.
- Publicação de produção falha se faltarem chaves; execução manual em outra branch não publica release.
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

Testes locais usam mocks de rede: não equivalem a login real, envio de e-mail, resposta real da IA, cotação contratada ou sincronização entre computadores. A compilação e os testes Rust no CI Windows verificam código nativo, incluindo SQLCipher/DPAPI e restauração em diretório temporário. O smoke test de processo não prova interação com telas.

Para aceite final em Windows: autenticar conta de homologação; criar lançamento offline; reconectar e confirmar em segundo dispositivo; editar em ambos e conferir política de conflito; testar logout/renovação; criar backup portátil; alterar um lançamento; restaurar com chave incorreta (deve preservar dados), depois correta (deve recuperar o snapshot); reabrir e autenticar. Usar ambiente descartável para restauração, pois ela substitui o banco local inteiro. Validar recuperação de senha no e-mail da conta de teste. Não usar dados reais no relatório público.

IA: testar diagnóstico com déficit, renda variável, fatura paga, carteira concentrada, cotação antiga e dados insuficientes. Conferir números, datas, hipóteses, ausência de promessa de retorno e instruções maliciosas em campos livres antes de habilitar amplamente.

Fontes técnicas: https://v2.tauri.app/plugin/updater/ ; https://developers.openai.com/api/docs/guides/text ; https://brapi.dev/docs/acoes/cotacao ; https://supabase.com/docs/guides/functions/secrets .
