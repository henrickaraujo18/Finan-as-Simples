-- Finança Simples — administrador da plataforma deve ser atribuído explicitamente.
-- Evita que o primeiro cadastro público obtenha privilégios elevados automaticamente.

create or replace function private.fs_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles(id, email, is_platform_admin)
  values (new.id, coalesce(new.email, ''), false)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

revoke all on function private.fs_on_auth_user_created() from public, anon, authenticated;
