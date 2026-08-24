-- Domain + password login for company dashboard (secret URL still works).

alter table public.companies
  add column if not exists password_hash text not null default '',
  add column if not exists dashboard_token_enc text not null default '';

-- Drop prior overload (10 args) before replacing with password fields.
drop function if exists public.company_create(
  text, text, text, text, text, text, text, text, text, text
);

create or replace function public.company_create(
  p_token text,
  p_name text,
  p_domain text,
  p_token_hash text,
  p_token_prefix text,
  p_api_key_enc text,
  p_key_last4 text,
  p_stance text default '',
  p_context_notes text default '',
  p_model text default 'gpt-4o',
  p_password_hash text default '',
  p_dashboard_token_enc text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.companies%rowtype;
  d text := lower(trim(p_domain));
  n text := trim(p_name);
begin
  perform public.assert_db_token(p_token);
  if n = '' or length(n) < 2 then raise exception 'company name required'; end if;
  if d = '' or position('.' in d) = 0 then raise exception 'domain required'; end if;
  if p_token_hash is null or trim(p_token_hash) = '' then
    raise exception 'token_hash required';
  end if;
  if p_api_key_enc is null or trim(p_api_key_enc) = '' then
    raise exception 'api key required';
  end if;
  if p_password_hash is null or trim(p_password_hash) = '' then
    raise exception 'password required';
  end if;
  if p_dashboard_token_enc is null or trim(p_dashboard_token_enc) = '' then
    raise exception 'dashboard token required';
  end if;
  if exists (select 1 from public.companies where domain = d) then
    raise exception 'this domain already has an airsup endpoint';
  end if;

  insert into public.companies (
    name, domain, token_hash, token_prefix, api_key_enc, key_last4,
    stance, context_notes, model, password_hash, dashboard_token_enc, updated_at
  ) values (
    n,
    d,
    trim(p_token_hash),
    coalesce(p_token_prefix, ''),
    trim(p_api_key_enc),
    coalesce(left(trim(p_key_last4), 8), ''),
    coalesce(p_stance, ''),
    coalesce(p_context_notes, ''),
    coalesce(nullif(trim(p_model), ''), 'gpt-4o'),
    trim(p_password_hash),
    trim(p_dashboard_token_enc),
    now()
  )
  returning * into c;

  return public.company_row_public(c);
end;
$function$;

-- Returns secrets needed for domain+password login (server verifies password).
create or replace function public.company_login_secrets(
  p_token text,
  p_domain text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.companies%rowtype;
  d text := lower(trim(p_domain));
begin
  perform public.assert_db_token(p_token);
  if d = '' then return null; end if;
  select * into c from public.companies where domain = d;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'domain', c.domain,
    'passwordHash', c.password_hash,
    'dashboardTokenEnc', c.dashboard_token_enc
  );
end;
$function$;

grant execute on function public.company_create(text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.company_login_secrets(text, text) to anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
