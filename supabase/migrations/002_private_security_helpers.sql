-- Finança Simples — endurecimento das funções privilegiadas
-- Move helpers SECURITY DEFINER para schema não exposto pelo Data API.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.fs_has_workspace_access(uuid) set schema private;
alter function public.fs_can(uuid,text,text) set schema private;
alter function public.fs_is_platform_admin() set schema private;
alter function public.fs_on_auth_user_created() set schema private;
alter function public.fs_create_workspace(text) set schema private;

revoke all on function private.fs_has_workspace_access(uuid) from public, anon;
revoke all on function private.fs_can(uuid,text,text) from public, anon;
revoke all on function private.fs_is_platform_admin() from public, anon;
revoke all on function private.fs_create_workspace(text) from public, anon;
revoke all on function private.fs_on_auth_user_created() from public, anon, authenticated;
grant execute on function private.fs_has_workspace_access(uuid) to authenticated;
grant execute on function private.fs_can(uuid,text,text) to authenticated;
grant execute on function private.fs_is_platform_admin() to authenticated;
grant execute on function private.fs_create_workspace(text) to authenticated;

create or replace function public.fs_create_workspace(p_name text)
returns uuid
language sql
security invoker
set search_path = pg_catalog, private
as $$ select private.fs_create_workspace(p_name); $$;
revoke all on function public.fs_create_workspace(text) from public, anon;
grant execute on function public.fs_create_workspace(text) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or private.fs_is_platform_admin() or exists (
    select 1 from public.workspace_memberships mine
    join public.workspace_memberships target on target.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.active = true
      and target.user_id = profiles.id
      and target.active = true
      and coalesce((mine.permissions -> 'users' ->> 'view')::boolean, false)
  )
);

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
for select to authenticated
using (private.fs_has_workspace_access(id));

drop policy if exists memberships_select on public.workspace_memberships;
create policy memberships_select on public.workspace_memberships
for select to authenticated
using (user_id = auth.uid() or private.fs_can(workspace_id, 'users', 'view'));

drop policy if exists entities_select on public.financial_entities;
create policy entities_select on public.financial_entities
for select to authenticated
using (
  private.fs_has_workspace_access(workspace_id)
  and (
    entity_type in ('categories','settings')
    or private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'view')
  )
);

drop policy if exists entities_insert on public.financial_entities;
create policy entities_insert on public.financial_entities
for insert to authenticated
with check (
  updated_by = auth.uid()
  and private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'create')
);

drop policy if exists entities_update on public.financial_entities;
create policy entities_update on public.financial_entities
for update to authenticated
using (private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'edit'))
with check (
  updated_by = auth.uid()
  and private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'edit')
);

drop policy if exists entities_delete on public.financial_entities;
create policy entities_delete on public.financial_entities
for delete to authenticated
using (private.fs_can(workspace_id, public.fs_entity_module(entity_type), 'delete'));

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
for select to authenticated
using (
  workspace_id is not null
  and private.fs_can(workspace_id, 'users', 'view')
);
