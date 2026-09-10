-- Finança Simples — criação segura de ambientes próprios e descoberta para sincronização.

create or replace function public.fs_ensure_workspace(p_workspace_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := trim(p_name);
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid workspace name';
  end if;

  select owner_user_id into v_owner from public.workspaces where id = p_workspace_id;
  if found then
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

create or replace function public.fs_my_workspaces()
returns table(id uuid, name text, role text, permissions jsonb, is_owner boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select w.id, w.name, m.role, m.permissions, (w.owner_user_id = auth.uid())
  from public.workspace_memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = auth.uid()
    and m.active = true
    and w.active = true
  order by w.created_at, w.name;
$$;

revoke all on function public.fs_ensure_workspace(uuid, text) from public, anon;
revoke all on function public.fs_my_workspaces() from public, anon;
grant execute on function public.fs_ensure_workspace(uuid, text) to authenticated;
grant execute on function public.fs_my_workspaces() to authenticated;

create or replace function public.fs_create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid := gen_random_uuid();
begin
  return public.fs_ensure_workspace(v_workspace_id, p_name);
end;
$$;
revoke all on function public.fs_create_workspace(text) from public, anon;
grant execute on function public.fs_create_workspace(text) to authenticated;
