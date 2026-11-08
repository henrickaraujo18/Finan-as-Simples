-- Finança Simples 1.7.4 — grants mínimos para bootstrap self-service.
-- RLS (migration 007) continua limitando cada INSERT ao próprio usuário/workspace.
-- Sem estes grants, SECURITY INVOKER não consegue executar os INSERTs autorizados pelas policies.

grant insert on public.workspaces to authenticated;
grant insert on public.workspace_memberships to authenticated;
grant insert on public.audit_log to authenticated;
