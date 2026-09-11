# Implantação Supabase — Finança Simples

Esta etapa deve ser executada somente em um projeto Supabase dedicado ao Finança Simples.

## Ordem

1. Criar projeto.
2. Aplicar, em ordem, todas as migrações de `supabase/migrations/001_*.sql` a `008_*.sql`.
3. Criar a primeira conta do proprietário antes da abertura do cadastro a terceiros; no bootstrap atual, o primeiro perfil criado recebe o papel de administrador da plataforma.
4. Implantar `invite-user`, `manage-members`, `market-data` e `open-finance` com verificação JWT habilitada.
5. Implantar `reset-password` como endpoint público para o link de recuperação.
6. Configurar os redirects do Auth para o endpoint de recuperação.
7. Configurar `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` somente como segredos das Edge Functions, quando o Open Finance de produção for ativado.
8. Preencher no desktop somente `supabaseUrl`, chave publicável e URL de recuperação.
9. Executar Security Advisor e testes de isolamento entre dois usuários/workspaces antes de habilitar sincronização real em produção.

## Testes mínimos de isolamento

- Usuário A não lê `financial_entities` do workspace B.
- Usuário consulta não insere/edita/exclui lançamentos.
- Usuário sem Investimentos não lê entidades `investments`.
- Usuário sem Investimentos não atualiza `investment_goals` nem `market_data`.
- Usuário sem Open Finance não recebe acesso ao módulo nem operações de conexão.
- Um item Pluggy vinculado ao workspace A não pode ser consultado, renovado ou revogado pelo workspace B.
- Remover membership revoga consultas subsequentes.
- Um usuário que pertence a dois workspaces vê apenas o workspace selecionado por vez no cache local.
- Convite não permite conceder poderes superiores aos do chamador sem autorização.
- Reset de senha não revela se determinado e-mail existe.

## Segredos

Nunca colocar no desktop ou GitHub público:

- chave secreta Supabase;
- service role legado;
- credenciais de Open Finance/Pluggy;
- chave privada do updater.

A chave publicável Supabase é própria para cliente e depende de RLS para limitar dados.
