-- Company endpoints (person-to-company). Separate from users/Orgo.
-- Discovery is domain lookup; visiting AIs talk to the company's own model.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null,
  token_hash text not null,
  token_prefix text not null default '',
  api_key_enc text not null,
  key_last4 text not null default '',
  model text not null default 'gpt-4o',
  stance text not null default '',
  context_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_domain_uidx on public.companies (domain);
create unique index if not exists companies_token_hash_uidx on public.companies (token_hash);

alter table public.companies enable row level security;

create table if not exists public.company_messages (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id text not null,
  visitor_username text not null default '',
  role text not null
    check (role = any (array['visitor'::text, 'company'::text])),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists company_messages_thread_idx
  on public.company_messages (company_id, conversation_id, id);

alter table public.company_messages enable row level security;

create or replace function public.company_row_public(c public.companies)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'domain', c.domain,
    'tokenPrefix', c.token_prefix,
    'keyLast4', c.key_last4,
    'model', c.model,
    'stance', c.stance,
    'contextNotes', c.context_notes,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at
  );
$function$;

create or replace function public.company_row_secret(c public.companies)
returns jsonb
language sql
immutable
as $function$
  select public.company_row_public(c) || jsonb_build_object(
    'apiKeyEnc', c.api_key_enc
  );
$function$;

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
  p_model text default 'gpt-4o'
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
  if exists (select 1 from public.companies where domain = d) then
    raise exception 'this domain already has an airsup endpoint';
  end if;

  insert into public.companies (
    name, domain, token_hash, token_prefix, api_key_enc, key_last4,
    stance, context_notes, model, updated_at
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
    now()
  )
  returning * into c;

  return public.company_row_public(c);
end;
$function$;

create or replace function public.company_get_by_token(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.companies%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into c from public.companies where token_hash = trim(p_token_hash);
  if not found then return null; end if;
  return public.company_row_public(c);
end;
$function$;

create or replace function public.company_get_secret_by_token(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.companies%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into c from public.companies where token_hash = trim(p_token_hash);
  if not found then return null; end if;
  return public.company_row_secret(c);
end;
$function$;

create or replace function public.company_get_secret_by_domain(
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
  select * into c from public.companies where domain = d;
  if not found then return null; end if;
  return public.company_row_secret(c);
end;
$function$;

create or replace function public.company_update(
  p_token text,
  p_token_hash text,
  p_name text default null,
  p_stance text default null,
  p_context_notes text default null,
  p_api_key_enc text default null,
  p_key_last4 text default null,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.companies%rowtype;
begin
  perform public.assert_db_token(p_token);

  update public.companies
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    stance = coalesce(p_stance, stance),
    context_notes = coalesce(p_context_notes, context_notes),
    api_key_enc = coalesce(nullif(trim(p_api_key_enc), ''), api_key_enc),
    key_last4 = case
      when p_api_key_enc is not null and trim(p_api_key_enc) <> ''
        then coalesce(left(trim(p_key_last4), 8), key_last4)
      else key_last4
    end,
    model = coalesce(nullif(trim(p_model), ''), model),
    updated_at = now()
  where token_hash = trim(p_token_hash)
  returning * into c;

  if not found then raise exception 'company not found'; end if;
  return public.company_row_public(c);
end;
$function$;

create or replace function public.company_check_domains(
  p_token text,
  p_domains jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  if p_domains is null or jsonb_typeof(p_domains) <> 'array' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'domain', d.domain,
        'live', c.id is not null,
        'name', c.name
      )
      order by d.ord
    )
    from (
      select
        lower(trim(elem.value #>> '{}')) as domain,
        elem.ordinality as ord
      from jsonb_array_elements(p_domains) with ordinality as elem(value, ordinality)
    ) d
    left join public.companies c on c.domain = d.domain
    where d.domain <> ''
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.company_message_append(
  p_token text,
  p_company_id uuid,
  p_conversation_id text,
  p_visitor_username text,
  p_role text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.company_messages%rowtype;
  cid text := trim(p_conversation_id);
  role text := lower(trim(p_role));
begin
  perform public.assert_db_token(p_token);
  if cid = '' then raise exception 'conversation_id required'; end if;
  if role not in ('visitor', 'company') then raise exception 'invalid role'; end if;
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'body required'; end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'unknown company';
  end if;

  insert into public.company_messages (
    company_id, conversation_id, visitor_username, role, body
  ) values (
    p_company_id,
    cid,
    lower(trim(coalesce(p_visitor_username, ''))),
    role,
    trim(p_body)
  )
  returning * into m;

  return jsonb_build_object(
    'id', m.id,
    'companyId', m.company_id,
    'conversationId', m.conversation_id,
    'visitorUsername', m.visitor_username,
    'role', m.role,
    'body', m.body,
    'createdAt', m.created_at
  );
end;
$function$;

create or replace function public.company_messages_for_talk(
  p_token text,
  p_company_id uuid,
  p_conversation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid text := trim(p_conversation_id);
begin
  perform public.assert_db_token(p_token);
  if cid = '' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'conversationId', m.conversation_id,
        'visitorUsername', m.visitor_username,
        'role', m.role,
        'body', m.body,
        'createdAt', m.created_at
      )
      order by m.id
    )
    from public.company_messages m
    where m.company_id = p_company_id
      and m.conversation_id = cid
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.company_conversations(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid uuid;
begin
  perform public.assert_db_token(p_token);
  select id into cid from public.companies where token_hash = trim(p_token_hash);
  if not found then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t."lastAt" desc)
    from (
      select
        last.conversation_id as "conversationId",
        last.visitor_username as "visitorUsername",
        last.role as "lastRole",
        left(last.body, 280) as "lastBody",
        last.created_at as "lastAt",
        cnt.n as "messageCount",
        (last.visitor_username = '_owner_') as "isTest"
      from public.company_messages last
      inner join (
        select conversation_id, max(id) as max_id, count(*)::int as n
        from public.company_messages
        where company_id = cid
        group by conversation_id
      ) cnt on cnt.max_id = last.id
    ) t
  ), '[]'::jsonb);
end;
$function$;
