-- Distributed Orgo relay leases (works across Vercel serverless instances).

create table if not exists public.orgo_relay_leases (
  computer_id text not null,
  conversation_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (computer_id, conversation_id)
);

create index if not exists orgo_relay_leases_computer_expires_idx
  on public.orgo_relay_leases (computer_id, expires_at);

alter table public.orgo_relay_leases enable row level security;

create or replace function public.orgo_lease_acquire(
  p_token text,
  p_computer_id text,
  p_conversation_id text,
  p_max_parallel integer default 2,
  p_ttl_ms integer default 180000
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid text := trim(p_computer_id);
  conv text := trim(p_conversation_id);
  ttl integer := greatest(30000, least(coalesce(p_ttl_ms, 180000), 300000));
  max_p integer := greatest(1, least(coalesce(p_max_parallel, 2), 4));
  active_count integer;
begin
  perform public.assert_db_token(p_token);
  if cid = '' or conv = '' then
    raise exception 'computer_id and conversation_id required';
  end if;

  delete from public.orgo_relay_leases where expires_at < now();

  if exists (
    select 1 from public.orgo_relay_leases
    where computer_id = cid and conversation_id = conv and expires_at >= now()
  ) then
    return false;
  end if;

  select count(*)::integer into active_count
  from public.orgo_relay_leases
  where computer_id = cid and expires_at >= now();

  if active_count >= max_p then
    return false;
  end if;

  insert into public.orgo_relay_leases (computer_id, conversation_id, expires_at)
  values (cid, conv, now() + make_interval(secs => ttl / 1000.0))
  on conflict (computer_id, conversation_id) do nothing;

  return exists (
    select 1 from public.orgo_relay_leases
    where computer_id = cid and conversation_id = conv and expires_at >= now()
  );
end;
$function$;

create or replace function public.orgo_lease_release(
  p_token text,
  p_computer_id text,
  p_conversation_id text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  delete from public.orgo_relay_leases
  where computer_id = trim(p_computer_id)
    and conversation_id = trim(p_conversation_id);
end;
$function$;

grant execute on function public.orgo_lease_acquire(text, text, text, integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.orgo_lease_release(text, text, text)
  to anon, authenticated, service_role;
