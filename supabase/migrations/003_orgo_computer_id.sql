-- Per-user Orgo computer mapping (replaces Vercel ORGO_COMPUTER_MAP)

alter table public.users
  add column if not exists orgo_computer_id text;

create index if not exists users_orgo_computer_id_idx
  on public.users (orgo_computer_id)
  where orgo_computer_id is not null and orgo_computer_id <> '';

-- helper: include orgoComputerId in user json
create or replace function public.user_row_json(u public.users)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'username', u.username,
    'displayName', u.display_name,
    'bio', u.bio,
    'tokenPrefix', u.token_prefix,
    'orgoComputerId', nullif(trim(u.orgo_computer_id), ''),
    'createdAt', u.created_at,
    'updatedAt', u.updated_at
  );
$function$;

create or replace function public.user_auth(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.users%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into u from public.users where token_hash = trim(p_token_hash);
  if not found then return null; end if;
  return public.user_row_json(u);
end;
$function$;

create or replace function public.user_get(
  p_token text,
  p_username text
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
  select * into u from public.users where username = uname;
  if not found then return null; end if;
  return public.user_row_json(u);
end;
$function$;

create or replace function public.user_register(
  p_token text,
  p_username text,
  p_display_name text,
  p_token_hash text,
  p_token_prefix text,
  p_bio text default '',
  p_member_number bigint default null,
  p_orgo_computer_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.users%rowtype;
  uname text := lower(trim(p_username));
  orgo_id text := nullif(trim(coalesce(p_orgo_computer_id, '')), '');
begin
  perform public.assert_db_token(p_token);
  if uname = '' then raise exception 'username required'; end if;
  if length(uname) < 2 then raise exception 'username too short'; end if;
  if p_token_hash is null or trim(p_token_hash) = '' then raise exception 'token_hash required'; end if;

  insert into public.users as usr (
    username, display_name, bio, token_hash, token_prefix, orgo_computer_id, updated_at
  ) values (
    uname,
    coalesce(nullif(trim(p_display_name), ''), uname),
    coalesce(p_bio, ''),
    trim(p_token_hash),
    coalesce(nullif(trim(p_token_prefix), ''), left(trim(p_token_hash), 10)),
    orgo_id,
    now()
  )
  on conflict (username) do nothing
  returning * into u;

  if u.username is null then
    raise exception 'username taken';
  end if;

  return public.user_row_json(u) || jsonb_build_object('memberNumber', p_member_number);
end;
$function$;

create or replace function public.user_set_orgo_computer(
  p_token text,
  p_token_hash text,
  p_orgo_computer_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.users%rowtype;
  orgo_id text := nullif(trim(coalesce(p_orgo_computer_id, '')), '');
begin
  perform public.assert_db_token(p_token);
  select * into u from public.users where token_hash = trim(p_token_hash);
  if not found then raise exception 'unauthorized'; end if;

  update public.users
  set orgo_computer_id = orgo_id,
      updated_at = now()
  where username = u.username
  returning * into u;

  return public.user_row_json(u);
end;
$function$;

grant execute on function public.user_set_orgo_computer(text, text, text)
  to anon, authenticated, service_role;

create or replace function public.user_set_orgo_computer_admin(
  p_token text,
  p_username text,
  p_orgo_computer_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u public.users%rowtype;
  uname text := lower(trim(p_username));
  orgo_id text := nullif(trim(coalesce(p_orgo_computer_id, '')), '');
begin
  perform public.assert_db_token(p_token);
  if uname = '' then raise exception 'username required'; end if;

  update public.users
  set orgo_computer_id = orgo_id,
      updated_at = now()
  where username = uname
  returning * into u;

  if not found then raise exception 'unknown username'; end if;
  return public.user_row_json(u);
end;
$function$;

grant execute on function public.user_set_orgo_computer_admin(text, text, text)
  to anon, authenticated, service_role;

grant execute on function public.user_register(text, text, text, text, text, text, bigint, text)
  to anon, authenticated, service_role;
