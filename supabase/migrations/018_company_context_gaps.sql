-- Adaptive context gaps + allow ai_build / gap source kinds

alter table public.company_context_assets
  drop constraint if exists company_context_assets_source_kind_check;

alter table public.company_context_assets
  add constraint company_context_assets_source_kind_check
  check (source_kind in ('file','folder','zip','image','other','ai_build','gap'));

create table if not exists public.company_context_gaps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  gap_key text not null,
  title text not null,
  reason text not null default '',
  field_type text not null default 'file'
    check (field_type in ('file','text','textarea')),
  placeholder text not null default '',
  accept text not null default '',
  priority integer not null default 100,
  status text not null default 'open'
    check (status in ('open','filled','dismissed')),
  filled_asset_id uuid references public.company_context_assets(id) on delete set null,
  filled_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, gap_key)
);

create index if not exists company_context_gaps_company_status_idx
  on public.company_context_gaps (company_id, status, priority);

alter table public.company_context_gaps enable row level security;

create or replace function public.company_context_gap_row(g public.company_context_gaps)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'id', g.id,
    'key', g.gap_key,
    'title', g.title,
    'reason', g.reason,
    'fieldType', g.field_type,
    'placeholder', g.placeholder,
    'accept', g.accept,
    'priority', g.priority,
    'status', g.status,
    'filledAssetId', g.filled_asset_id,
    'filledPreview', g.filled_preview,
    'createdAt', g.created_at,
    'updatedAt', g.updated_at
  );
$function$;

create or replace function public.company_context_gaps_replace(
  p_token text,
  p_token_hash text,
  p_gaps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  item jsonb;
  inserted jsonb := '[]'::jsonb;
  g public.company_context_gaps%rowtype;
  i integer := 0;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  delete from public.company_context_gaps
  where company_id = u.id and status = 'open';

  if p_gaps is null or jsonb_typeof(p_gaps) <> 'array' then
    return '[]'::jsonb;
  end if;

  for item in select * from jsonb_array_elements(p_gaps)
  loop
    i := i + 1;
    if i > 8 then exit; end if;
    insert into public.company_context_gaps (
      company_id, gap_key, title, reason, field_type, placeholder, accept, priority, status
    ) values (
      u.id,
      left(coalesce(nullif(trim(item->>'key'), ''), 'gap-' || i::text), 80),
      left(coalesce(nullif(trim(item->>'title'), ''), 'Missing detail'), 160),
      left(coalesce(trim(item->>'reason'), ''), 400),
      case
        when lower(coalesce(item->>'fieldType', item->>'field_type', 'file')) in ('text','textarea','file')
          then lower(coalesce(item->>'fieldType', item->>'field_type', 'file'))
        else 'file'
      end,
      left(coalesce(trim(item->>'placeholder'), ''), 200),
      left(coalesce(trim(item->>'accept'), ''), 120),
      coalesce((item->>'priority')::int, i * 10),
      'open'
    )
    on conflict (company_id, gap_key) do update set
      title = excluded.title,
      reason = excluded.reason,
      field_type = excluded.field_type,
      placeholder = excluded.placeholder,
      accept = excluded.accept,
      priority = excluded.priority,
      status = case
        when public.company_context_gaps.status = 'filled' then 'filled'
        else 'open'
      end,
      updated_at = now()
    returning * into g;

    inserted := inserted || jsonb_build_array(public.company_context_gap_row(g));
  end loop;

  return inserted;
end;
$function$;

create or replace function public.company_context_gaps_list(
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
    select jsonb_agg(public.company_context_gap_row(g) order by
      case g.status when 'open' then 0 when 'filled' then 1 else 2 end,
      g.priority asc,
      g.created_at asc
    )
    from public.company_context_gaps g
    where g.company_id = u.id
      and g.status in ('open', 'filled')
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.company_context_gap_fill(
  p_token text,
  p_token_hash text,
  p_gap_id uuid,
  p_filled_asset_id uuid default null,
  p_filled_preview text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  g public.company_context_gaps%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  update public.company_context_gaps
  set status = 'filled',
      filled_asset_id = coalesce(p_filled_asset_id, filled_asset_id),
      filled_preview = left(coalesce(p_filled_preview, filled_preview, ''), 240),
      updated_at = now()
  where id = p_gap_id and company_id = u.id
  returning * into g;
  if not found then raise exception 'gap not found'; end if;
  return public.company_context_gap_row(g);
end;
$function$;

create or replace function public.company_context_gap_dismiss(
  p_token text,
  p_token_hash text,
  p_gap_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.companies%rowtype;
  g public.company_context_gaps%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.companies where token_hash = trim(p_token_hash);
  if not found then raise exception 'company not found'; end if;

  update public.company_context_gaps
  set status = 'dismissed', updated_at = now()
  where id = p_gap_id and company_id = u.id and status = 'open'
  returning * into g;
  if not found then raise exception 'gap not found'; end if;
  return public.company_context_gap_row(g);
end;
$function$;

grant execute on function public.company_context_gaps_replace(text, text, jsonb)
  to anon, authenticated, service_role;
grant execute on function public.company_context_gaps_list(text, text)
  to anon, authenticated, service_role;
grant execute on function public.company_context_gap_fill(text, text, uuid, uuid, text)
  to anon, authenticated, service_role;
grant execute on function public.company_context_gap_dismiss(text, text, uuid)
  to anon, authenticated, service_role;
