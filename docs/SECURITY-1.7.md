# Finança Simples 1.7 — identidade, isolamento e integrações

## Modelo de acesso

Usuários e dados são entidades separadas. Cada registro financeiro pertence a um ambiente (`workspace`), e um usuário pode participar de mais de um ambiente com permissões diferentes.

Papéis disponíveis: proprietário, administrador, operador, consulta e personalizado. As permissões cobrem Dashboard, Lançamentos, Contas & Cartões, Dashboard Analítico, Investimentos, Exportações, Parametrização e Usuários & Acessos. A permissão de Open Finance permanece reservada no modelo de dados para uma versão futura, mas o módulo está fora da navegação e do aceite da 1.7.

## Identidade e senhas

O Supabase Auth é a autoridade online. No dispositivo, a senha necessária ao modo offline é protegida com Argon2id e salt aleatório. Tokens de acesso e refresh permanecem em memória e são apagados no logout.

A recuperação por e-mail responde de forma uniforme para evitar enumeração de contas. A troca de senha online é feita pelo provedor de identidade e reconciliada no banco local.

## Dados locais

No Windows, o arquivo SQLite usa SQLCipher. A chave é aleatória, protegida por DPAPI no escopo do usuário e não é gravada em texto claro. Backups são criados por cópia consistente do banco.

## Nuvem

Todas as tabelas públicas sensíveis possuem RLS. A chave publicável do Supabase pode ser distribuída no executável; ela não substitui autenticação, membership ou autorização.

A sincronização replica apenas entidades do workspace ativo e respeita as permissões tanto no cliente quanto no banco.

## Mercado e infraestrutura reservada de Open Finance

A Edge Function `market-data` exige JWT válido e confirma membership/permissão antes de consultar indicadores ou cotações. A função `open-finance` permanece implantada apenas como infraestrutura reservada para etapa futura.

Open Finance foi adiado: a emissão de tokens de nova conexão/renovação está bloqueada e o módulo não aparece na navegação principal. Nenhum script remoto bancário é carregado no contexto privilegiado do aplicativo.

Os testes automatizados usam mocks para validar a lógica das funções. Não substituem testes de JWT, RLS e consentimento com usuários e instituições reais.

## Atualizações

O aplicativo só consulta e instala atualizações quando foi compilado com uma chave pública Tauri. O CI publica o manifesto apenas se o instalador tiver uma assinatura válida. Antes da instalação, o app cria um backup local.

A assinatura Authenticode do executável é uma camada adicional recomendada para distribuição comercial ampla.
