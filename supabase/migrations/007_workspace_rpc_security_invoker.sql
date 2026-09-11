-- Finança Simples 1.6 — remove SECURITY DEFINER dos RPCs públicos de workspace.

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or private.fs_has_workspace_access(id)
);

drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner on public.workspaces
for insert to authenticated
with check (owner_user_id = (select auth.uid()));

drop policy if exists memberships_insert_owner_bootstrap on public.workspace_memberships;
create policy memberships_insert_owner_bootstrap on public.workspace_memberships
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and exists (
    select 1 from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = (select auth.uid())
  )
);

drop policy if exists audit_insert_self on public.audit_log;
create policy audit_insert_self on public.audit_log
for insert to authenticated
with check (
  actor_user_id = (select auth.uid())
  and workspace_id is not null
  and (
    private.fs_has_workspace_access(workspace_id)
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
        and w.owner_user_id = (select auth.uid())
    )
  )
);

create or replace function public.fs_ensure_workspace(p_workspace_id uuid, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_name text := trim(p_name);
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid workspace name';
  end if;

  if exists (select 1 from public.workspaces where id = p_workspace_id) then
    if not exists (
      select 1 from public.workspace_memberships
      where workspace_id = p_workspace_id and user_id = auth.uid() and active = true
    ) then
      raise exception 'workspace access denied';
    end if;
    return p_workspace_id;
  end if;

  insert into public.workspaces(id, name, owner_user_id)
  values (p_workspace_id, v_name, auth.uid());

  insert into public.workspace_memberships(workspace_id, user_id, role, permissions)
  values (p_workspace_id, auth.uid(), 'owner', private.fs_full_permissions());

  insert into public.audit_log(workspace_id, actor_user_id, action, details)
  values (p_workspace_id, auth.uid(), 'workspace_create', jsonb_build_object('name', v_name));

  return p_workspace_id;
end;
$$;

create or replace function public.fs_create_workspace(p_name text)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select public.fs_ensure_workspace(gen_random_uuid(), p_name);
$$;

drop function if exists public.fs_my_workspaces();
create function public.fs_my_workspaces()
returns table(id uuid, name text, owner_user_id uuid, role text, permissions jsonb, is_owner boolean)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select w.id, w.name, w.owner_user_id, m.role, m.permissions, (w.owner_user_id = auth.uid())
  from public.workspace_memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = auth.uid()
    and m.active = true
    and w.active = true
  order by w.created_at, w.name;
$$;

revoke all on function public.fs_ensure_workspace(uuid, text) from public, anon;
revoke all on function public.fs_create_workspace(text) from public, anon;
revoke all on function public.fs_my_workspaces() from public, anon;
grant execute on function public.fs_ensure_workspace(uuid, text) to authenticated;
grant execute on function public.fs_create_workspace(text) to authenticated;
grant execute on function public.fs_my_workspaces() to authenticated;
