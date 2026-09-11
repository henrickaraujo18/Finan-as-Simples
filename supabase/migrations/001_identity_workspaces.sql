-- Finança Simples — identidade, workspaces e isolamento multi-tenant
-- Aplicar somente em um projeto Supabase dedicado.
-- Nenhuma chave privilegiada é destinada ao aplicativo Windows.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  owner_user_id uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','operator','viewer','custom')),
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships(user_id, active, workspace_id);

create table if not exists public.financial_entities (
  id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('transactions','accounts','cards','categories','investments','settings')),
  data_json jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  deleted boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists financial_entities_workspace_type_idx
  on public.financial_entities(workspace_id, entity_type, deleted, updated_at desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_workspace_created_idx
  on public.audit_log(workspace_id, created_at desc);

create or replace function public.fs_full_permissions()
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select '{
    "dashboard":{"view":true,"create":false,"edit":false,"delete":false},
    "transactions":{"view":true,"create":true,"edit":true,"delete":true},
    "accounts":{"view":true,"create":true,"edit":true,"delete":true},
    "analytics":{"view":true,"create":false,"edit":false,"delete":false},
    "openFinance":{"view":true,"create":true,"edit":true,"delete":true},
    "investments":{"view":true,"create":true,"edit":true,"delete":true},
    "exports":{"view":true,"create":true,"edit":false,"delete":false},
    "settings":{"view":true,"create":true,"edit":true,"delete":true},
    "users":{"view":true,"create":true,"edit":true,"delete":true}
  }'::jsonb;
$$;

create or replace function public.fs_entity_module(p_entity_type text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case p_entity_type
    when 'transactions' then 'transactions'
    when 'accounts' then 'accounts'
    when 'cards' then 'accounts'
    when 'investments' then 'investments'
    when 'categories' then 'settings'
    when 'settings' then 'settings'
    else 'settings'
  end;
$$;

create or replace function public.fs_has_workspace_access(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.active = true
  );
$$;

create or replace function public.fs_can(p_workspace_id uuid, p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select (m.permissions -> p_module ->> p_action)::boolean
      from public.workspace_memberships m
      where m.workspace_id = p_workspace_id
        and m.user_id = auth.uid()
        and m.active = true
      limit 1
    ),
    false
  );
$$;

create or replace function public.fs_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- Criação de workspace é a única escrita administrativa exposta diretamente como RPC.
-- Ela continua restrita ao platform admin autenticado.
create or replace function public.fs_create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
  v_name text := trim(p_name);
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.fs_is_platform_admin() then
    raise exception 'platform admin required';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid workspace name';
  end if;

  insert into public.workspaces(name, owner_user_id)
  values (v_name, auth.uid())
  returning id into v_workspace_id;

  insert into public.workspace_memberships(workspace_id, user_id, role, permissions)
  values (v_workspace_id, auth.uid(), 'owner', public.fs_full_permissions());

  insert into public.audit_log(workspace_id, actor_user_id, action, details)
  values (v_workspace_id, auth.uid(), 'workspace_create', jsonb_build_object('name', v_name));

  return v_workspace_id;
end;
$$;

-- Bootstrap controlado: no projeto vazio, o primeiro usuário criado vira o administrador da plataforma.
-- Criar a conta do proprietário antes de abrir cadastro/convidar terceiros.
create or replace function public.fs_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_first_admin boolean;
begin
  perform pg_advisory_xact_lock(hashtext('financa-simples-platform-admin-bootstrap'));
  select not exists(select 1 from public.profiles where is_platform_admin = true)
    into v_first_admin;

  insert into public.profiles(id, email, is_platform_admin)
  values (new.id, coalesce(new.email, ''), v_first_admin)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists fs_auth_user_created on auth.users;
create trigger fs_auth_user_created
after insert or update of email on auth.users
for each row execute function public.fs_on_auth_user_created();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.financial_entities enable row level security;
alter table public.audit_log enable row level security;

-- Perfil próprio, platform admin e perfis de membros de ambientes que o chamador pode administrar.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.fs_is_platform_admin()
  or exists (
    select 1
    from public.workspace_memberships mine
    join public.workspace_memberships target on target.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.active = true
      and target.user_id = profiles.id
      and target.active = true
      and coalesce((mine.permissions -> 'users' ->> 'view')::boolean, false)
  )
);

-- Super admin não recebe dados financeiros automaticamente: precisa ter membership explícita no workspace.
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
for select to authenticated
using (public.fs_has_workspace_access(id));

drop policy if exists memberships_select on public.workspace_memberships;
create policy memberships_select on public.workspace_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or public.fs_can(workspace_id, 'users', 'view')
);

drop policy if exists entities_select on public.financial_entities;
create policy entities_select on public.financial_entities
for select to authenticated
using (
  public.fs_has_workspace_access(workspace_id)
  and (
    entity_type in ('categories','settings')
    or public.fs_can(workspace_id, public.fs_entity_module(entity_type), 'view')
  )
);

drop policy if exists entities_insert on public.financial_entities;
create policy entities_insert on public.financial_entities
for insert to authenticated
with check (
  updated_by = auth.uid()
  and public.fs_can(workspace_id, public.fs_entity_module(entity_type), 'create')
);

drop policy if exists entities_update on public.financial_entities;
create policy entities_update on public.financial_entities
for update to authenticated
using (public.fs_can(workspace_id, public.fs_entity_module(entity_type), 'edit'))
with check (
  updated_by = auth.uid()
  and public.fs_can(workspace_id, public.fs_entity_module(entity_type), 'edit')
);

drop policy if exists entities_delete on public.financial_entities;
create policy entities_delete on public.financial_entities
for delete to authenticated
using (public.fs_can(workspace_id, public.fs_entity_module(entity_type), 'delete'));

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
for select to authenticated
using (
  workspace_id is not null
  and public.fs_can(workspace_id, 'users', 'view')
);

-- Em projetos Supabase novos o Data API não deve depender de grants implícitos.
revoke all on public.profiles from anon;
revoke all on public.workspaces from anon;
revoke all on public.workspace_memberships from anon;
revoke all on public.financial_entities from anon;
revoke all on public.audit_log from anon;

grant select on public.profiles to authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_memberships to authenticated;
grant select, insert, update, delete on public.financial_entities to authenticated;
grant select on public.audit_log to authenticated;

-- Funções privilegiadas: retirar EXECUTE implícito de PUBLIC/anon e conceder somente o necessário.
revoke all on function public.fs_full_permissions() from public, anon;
revoke all on function public.fs_entity_module(text) from public, anon;
revoke all on function public.fs_has_workspace_access(uuid) from public, anon;
revoke all on function public.fs_can(uuid, text, text) from public, anon;
revoke all on function public.fs_is_platform_admin() from public, anon;
revoke all on function public.fs_create_workspace(text) from public, anon;
revoke all on function public.fs_on_auth_user_created() from public, anon, authenticated;

grant execute on function public.fs_full_permissions() to authenticated;
grant execute on function public.fs_entity_module(text) to authenticated;
grant execute on function public.fs_has_workspace_access(uuid) to authenticated;
grant execute on function public.fs_can(uuid, text, text) to authenticated;
grant execute on function public.fs_is_platform_admin() to authenticated;
grant execute on function public.fs_create_workspace(text) to authenticated;
