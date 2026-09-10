-- Finança Simples — índices e otimizações de RLS apontadas pelo Performance Advisor.

create index if not exists audit_log_actor_user_idx on public.audit_log(actor_user_id);
create index if not exists financial_entities_updated_by_idx on public.financial_entities(updated_by);
create index if not exists workspaces_owner_user_idx on public.workspaces(owner_user_id);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid()) or private.fs_is_platform_admin() or exists (
    select 1 from public.workspace_memberships mine
    join public.workspace_memberships target on target.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and mine.active = true
      and target.user_id = profiles.id
      and target.active = true
      and coalesce((mine.permissions -> 'users' ->> 'view')::boolean, false)
  )
);

drop policy if exists memberships_select on public.workspace_memberships;
create policy memberships_select on public.workspace_memberships
for select to authenticated
using (user_id = (select auth.uid()) or private.fs_can(workspace_id, 'users', 'view'));

drop policy if exists entities_insert on public.financial_entities;
create policy entities_insert on public.financial_entities
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'create')
);

drop policy if exists entities_update on public.financial_entities;
create policy entities_update on public.financial_entities
for update to authenticated
using (private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'edit'))
with check (
  updated_by = (select auth.uid())
  and private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'edit')
);
