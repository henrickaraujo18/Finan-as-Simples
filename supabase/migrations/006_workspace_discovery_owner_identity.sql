-- Finança Simples — inclui o proprietário real do workspace na descoberta cloud.

drop function if exists public.fs_my_workspaces();
create function public.fs_my_workspaces()
returns table(id uuid, name text, owner_user_id uuid, role text, permissions jsonb, is_owner boolean)
language sql
stable
security definer
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
revoke all on function public.fs_my_workspaces() from public, anon;
grant execute on function public.fs_my_workspaces() to authenticated;
