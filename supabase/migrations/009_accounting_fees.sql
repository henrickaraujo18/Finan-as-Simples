-- Honorários contábeis — entidades isoladas por workspace e sincronizadas offline-first.
-- Por compatibilidade com permissões já concedidas, o acesso utiliza o módulo transactions.
alter table public.financial_entities
  drop constraint if exists financial_entities_entity_type_check;

alter table public.financial_entities
  add constraint financial_entities_entity_type_check check (
    entity_type in (
      'transactions','accounts','cards','categories','investments','investment_goals',
      'market_data','open_finance_connections','open_finance_accounts','open_finance_bills',
      'settings','fee_clients','fee_charges','fee_receipts'
    )
  );

create or replace function public.fs_entity_module(p_entity_type text)
returns text
language sql immutable security invoker
set search_path = pg_catalog
as $$
  select case p_entity_type
    when 'transactions' then 'transactions'
    when 'fee_clients' then 'transactions'
    when 'fee_charges' then 'transactions'
    when 'fee_receipts' then 'transactions'
    when 'accounts' then 'accounts'
    when 'cards' then 'accounts'
    when 'investments' then 'investments'
    when 'investment_goals' then 'investments'
    when 'market_data' then 'investments'
    when 'open_finance_connections' then 'openFinance'
    when 'open_finance_accounts' then 'openFinance'
    when 'open_finance_bills' then 'openFinance'
    when 'categories' then 'settings'
    when 'settings' then 'settings'
    else 'settings'
  end;
$$;

revoke all on function public.fs_entity_module(text) from public, anon;
grant execute on function public.fs_entity_module(text) to authenticated;
