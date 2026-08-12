-- Global member numbers: early joiners get low numbers; usernames never overwrite tokens.

create table if not exists public.ainet_meta (
  key text primary key,
  value bigint not null
);

alter table public.ainet_meta enable row level security;

insert into public.ainet_meta (key, value)
select 'member_count', count(*)::bigint from public.users
on conflict (key) do nothing;

update public.ainet_meta m
set value = greatest(m.value, (select count(*)::bigint from public.users))
where m.key = 'member_count';

create or replace function public.ainet_member_count(p_token text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  return coalesce(
    (select value from public.ainet_meta where key = 'member_count'),
    (select count(*)::bigint from public.users),
    0
  );
end;
$function$;

create or replace function public.ainet_claim_member_number(p_token text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n bigint;
begin
  perform public.assert_db_token(p_token);
  insert into public.ainet_meta (key, value)
  values ('member_count', 0)
  on conflict (key) do nothing;

  update public.ainet_meta
  set value = value + 1
  where key = 'member_count'
  returning value into n;

  return n;
end;
$function$;

create or replace function public.user_register(
  p_token text,
  p_username text,
  p_display_name text,
  p_token_hash text,
  p_token_prefix text,
  p_bio text default '',
  p_member_number bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.users%rowtype;
  uname text := lower(trim(p_username));
begin
  perform public.assert_db_token(p_token);
  if uname = '' then raise exception 'username required'; end if;
  if length(uname) < 2 then raise exception 'username too short'; end if;
  if p_token_hash is null or trim(p_token_hash) = '' then raise exception 'token_hash required'; end if;

  insert into public.users as usr (
    username, display_name, bio, token_hash, token_prefix, updated_at
  ) values (
    uname,
    coalesce(nullif(trim(p_display_name), ''), uname),
    coalesce(p_bio, ''),
    trim(p_token_hash),
    coalesce(nullif(trim(p_token_prefix), ''), left(trim(p_token_hash), 10)),
    now()
  )
  on conflict (username) do nothing
  returning * into u;

  if u.username is null then
    raise exception 'username taken';
  end if;

  return jsonb_build_object(
    'username', u.username,
    'displayName', u.display_name,
    'bio', u.bio,
    'tokenPrefix', u.token_prefix,
    'createdAt', u.created_at,
    'updatedAt', u.updated_at,
    'memberNumber', p_member_number
  );
end;
$function$;

grant execute on function public.ainet_member_count(text) to anon, authenticated, service_role;
grant execute on function public.ainet_claim_member_number(text) to anon, authenticated, service_role;
grant execute on function public.user_register(text, text, text, text, text, text, bigint) to anon, authenticated, service_role;
