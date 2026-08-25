-- Main goal + company knowledge context for negotiate endpoint

alter table public.companies
  add column if not exists main_goal text not null
    default 'Make the company more money. Cut costs. Save time.';

create table if not exists public.company_context_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  filename text not null,
  mime_type text not null default 'application/octet-stream',
  byte_size integer not null default 0,
  status text not null default 'ready'
    check (status in ('processing','ready','failed')),
  error text,
  source_kind text not null default 'file'
    check (source_kind in ('file','folder','zip','image','other')),
  created_at timestamptz not null default now()
);

create index if not exists company_context_assets_company_idx
  on public.company_context_assets (company_id, created_at desc);

create table if not exists public.company_context_chunks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  asset_id uuid references public.company_context_assets(id) on delete cascade,
  title text not null default '',
  summary text not null default '',
  body text not null,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists company_context_chunks_company_idx
  on public.company_context_chunks (company_id, created_at desc);
create index if not exists company_context_chunks_keywords_idx
  on public.company_context_chunks using gin (keywords);

alter table public.company_context_assets enable row level security;
alter table public.company_context_chunks enable row level security;

drop function if exists public.company_row_secret(public.companies);
drop function if exists public.company_row_public(public.companies);

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
    'mainGoal', coalesce(c.main_goal, 'Make the company more money. Cut costs. Save time.'),
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

drop function if exists public.company_update(text, text, text, text, text, text, text, text);

create or replace function public.company_update(
  p_token text,
  p_token_hash text,
  p_name text default null,
  p_stance text default null,
  p_context_notes text default null,
  p_api_key_enc text default null,
  p_key_last4 text default null,
  p_model text default null,
  p_main_goal text default null
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
    main_goal = case
      when p_main_goal is null then main_goal
      else coalesce(nullif(trim(p_main_goal), ''), main_goal)
    end,
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

grant execute on function public.company_update(text, text, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

create or replace function public.company_context_asset_add(
  p_token text,
  p_token_hash text,
  p_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_source_kind text default 'file',
  p_status text default 'processing'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  a public.company_context_assets%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  insert into public.company_context_assets (
    company_id, filename, mime_type, byte_size, source_kind, status
  ) values (
    u.id,
    left(trim(p_filename), 400),
    coalesce(nullif(trim(p_mime_type), ''), 'application/octet-stream'),
    greatest(0, coalesce(p_byte_size, 0)),
    coalesce(nullif(trim(p_source_kind), ''), 'file'),
    coalesce(nullif(trim(p_status), ''), 'processing')
  ) returning * into a;

  return jsonb_build_object(
    'id', a.id,
    'filename', a.filename,
    'mimeType', a.mime_type,
    'byteSize', a.byte_size,
    'status', a.status,
    'sourceKind', a.source_kind,
    'createdAt', a.created_at
  );
end;
$function$;

create or replace function public.company_context_asset_finish(
  p_token text,
  p_token_hash text,
  p_asset_id uuid,
  p_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  a public.company_context_assets%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  update public.company_context_assets
  set status = p_status,
      error = nullif(trim(coalesce(p_error, '')), '')
  where id = p_asset_id and company_id = u.id
  returning * into a;
  if not found then raise exception 'asset not found'; end if;

  return jsonb_build_object(
    'id', a.id,
    'filename', a.filename,
    'status', a.status,
    'error', a.error
  );
end;
$function$;

create or replace function public.company_context_chunk_add(
  p_token text,
  p_token_hash text,
  p_asset_id uuid,
  p_title text,
  p_summary text,
  p_body text,
  p_keywords text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  c public.company_context_chunks%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  insert into public.company_context_chunks (
    company_id, asset_id, title, summary, body, keywords
  ) values (
    u.id,
    p_asset_id,
    left(coalesce(p_title, ''), 200),
    left(coalesce(p_summary, ''), 800),
    left(coalesce(p_body, ''), 12000),
    coalesce(p_keywords, '{}')
  ) returning * into c;

  return jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'summary', c.summary
  );
end;
$function$;

create or replace function public.company_context_list(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'filename', a.filename,
      'mimeType', a.mime_type,
      'byteSize', a.byte_size,
      'status', a.status,
      'error', a.error,
      'sourceKind', a.source_kind,
      'createdAt', a.created_at,
      'chunkCount', (
        select count(*)::int from public.company_context_chunks ch where ch.asset_id = a.id
      )
    ) order by a.created_at desc)
    from public.company_context_assets a
    where a.company_id = u.id
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.company_context_delete_asset(
  p_token text,
  p_token_hash text,
  p_asset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  deleted integer;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;
  delete from public.company_context_assets
  where id = p_asset_id and company_id = u.id;
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$function$;

create or replace function public.company_context_retrieve(
  p_token text,
  p_domain text,
  p_query text,
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  lim integer := least(greatest(coalesce(p_limit, 8), 1), 20);
  q text := lower(trim(coalesce(p_query, '')));
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where lower(domain) = lower(trim(p_domain));
  if not found then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row_json order by score desc, created_at desc)
    from (
      select
        jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'summary', c.summary,
          'body', left(c.body, 2500),
          'keywords', c.keywords,
          'createdAt', c.created_at
        ) as row_json,
        c.created_at,
        (
          case when q = '' then 1
          else
            (case when position(q in lower(c.title)) > 0 then 5 else 0 end) +
            (case when position(q in lower(c.summary)) > 0 then 3 else 0 end) +
            (case when position(q in lower(c.body)) > 0 then 2 else 0 end) +
            (select count(*)::int from unnest(c.keywords) k
              where position(lower(k) in q) > 0 or position(q in lower(k)) > 0)
          end
        ) as score
      from public.company_context_chunks c
      where c.company_id = u.id
    ) scored
    where score > 0 or q = ''
    limit lim
  ), '[]'::jsonb);
end;
$function$;

grant execute on function public.company_context_asset_add(text, text, text, text, integer, text, text)
  to anon, authenticated, service_role;
grant execute on function public.company_context_asset_finish(text, text, uuid, text, text)
  to anon, authenticated, service_role;
grant execute on function public.company_context_chunk_add(text, text, uuid, text, text, text, text[])
  to anon, authenticated, service_role;
grant execute on function public.company_context_list(text, text)
  to anon, authenticated, service_role;
grant execute on function public.company_context_delete_asset(text, text, uuid)
  to anon, authenticated, service_role;
grant execute on function public.company_context_retrieve(text, text, text, integer)
  to anon, authenticated, service_role;
