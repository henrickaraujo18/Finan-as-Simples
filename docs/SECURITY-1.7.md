# Finança Simples 1.7 — identidade, isolamento e integrações

## Modelo de acesso

Usuários e dados são entidades separadas. Cada registro financeiro pertence a um ambiente (`workspace`), e um usuário pode participar de mais de um ambiente com permissões diferentes.

Papéis disponíveis: proprietário, administrador, operador, consulta e personalizado. As permissões cobrem Dashboard, Lançamentos, Contas & Cartões, Dashboard Analítico, Open Finance, Investimentos, Exportações, Parametrização e Usuários & Acessos.

## Identidade e senhas

O Supabase Auth é a autoridade online. No dispositivo, a senha necessária ao modo offline é protegida com Argon2id e salt aleatório. Tokens de acesso e refresh permanecem em memória e são apagados no logout.

A recuperação por e-mail responde de forma uniforme para evitar enumeração de contas. A troca de senha online é feita pelo provedor de identidade e reconciliada no banco local.

## Dados locais

No Windows, o arquivo SQLite usa SQLCipher. A chave é aleatória, protegida por DPAPI no escopo do usuário e não é gravada em texto claro. Backups são criados por cópia consistente do banco.

## Nuvem

Todas as tabelas públicas sensíveis possuem RLS. A chave publicável do Supabase pode ser distribuída no executável; ela não substitui autenticação, membership ou autorização.

A sincronização replica apenas entidades do workspace ativo e respeita as permissões tanto no cliente quanto no banco.

## Open Finance e mercado

As Edge Functions `open-finance` e `market-data` exigem JWT válido. Antes de acessar o provedor, a função confirma a membership e a permissão do módulo.

Credenciais Pluggy ficam em segredos do servidor. O token temporário de consentimento é entregue somente à sessão autenticada e não é persistido. Contas e faturas sincronizadas são isoladas por workspace.

## Atualizações

O aplicativo só consulta e instala atualizações quando foi compilado com uma chave pública Tauri. O CI publica o manifesto apenas se o instalador tiver uma assinatura válida. Antes da instalação, o app cria um backup local.

A assinatura Authenticode do executável é uma camada adicional recomendada para distribuição comercial ampla.
