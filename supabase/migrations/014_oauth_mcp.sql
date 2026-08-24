-- OAuth 2.1 (PKCE) for universal MCP plugin URL.
-- Access tokens map to airsup users; asp_ path tokens remain valid.

create table if not exists public.oauth_auth_codes (
  code_hash text primary key,
  username text not null references public.users(username) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  resource text not null default '',
  scopes text not null default 'airsup',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_auth_codes_expires_idx on public.oauth_auth_codes (expires_at);

alter table public.oauth_auth_codes enable row level security;

create table if not exists public.oauth_access_tokens (
  token_hash text primary key,
  username text not null references public.users(username) on delete cascade,
  client_id text not null,
  resource text not null default '',
  scopes text not null default 'airsup',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_access_tokens_user_idx on public.oauth_access_tokens (username);
create index if not exists oauth_access_tokens_expires_idx on public.oauth_access_tokens (expires_at);

alter table public.oauth_access_tokens enable row level security;

create table if not exists public.oauth_refresh_tokens (
  token_hash text primary key,
  username text not null references public.users(username) on delete cascade,
  client_id text not null,
  resource text not null default '',
  scopes text not null default 'airsup',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_refresh_tokens_user_idx on public.oauth_refresh_tokens (username);

alter table public.oauth_refresh_tokens enable row level security;

create or replace function public.oauth_store_code(
  p_token text,
  p_code_hash text,
  p_username text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_code_challenge_method text,
  p_resource text,
  p_scopes text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  insert into public.oauth_auth_codes (
    code_hash, username, client_id, redirect_uri, code_challenge,
    code_challenge_method, resource, scopes, expires_at
  ) values (
    trim(p_code_hash),
    lower(trim(p_username)),
    trim(p_client_id),
    trim(p_redirect_uri),
    trim(p_code_challenge),
    coalesce(nullif(trim(p_code_challenge_method), ''), 'S256'),
    coalesce(p_resource, ''),
    coalesce(nullif(trim(p_scopes), ''), 'airsup'),
    p_expires_at
  );
end;
$function$;

create or replace function public.oauth_consume_code(
  p_token text,
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.oauth_auth_codes%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into c from public.oauth_auth_codes where code_hash = trim(p_code_hash) for update;
  if not found then return null; end if;
  if c.used_at is not null then return null; end if;
  if c.expires_at < now() then return null; end if;
  update public.oauth_auth_codes set used_at = now() where code_hash = c.code_hash;
  return jsonb_build_object(
    'username', c.username,
    'clientId', c.client_id,
    'redirectUri', c.redirect_uri,
    'codeChallenge', c.code_challenge,
    'codeChallengeMethod', c.code_challenge_method,
    'resource', c.resource,
    'scopes', c.scopes
  );
end;
$function$;

create or replace function public.oauth_store_access(
  p_token text,
  p_token_hash text,
  p_username text,
  p_client_id text,
  p_resource text,
  p_scopes text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  insert into public.oauth_access_tokens (
    token_hash, username, client_id, resource, scopes, expires_at
  ) values (
    trim(p_token_hash),
    lower(trim(p_username)),
    trim(p_client_id),
    coalesce(p_resource, ''),
    coalesce(nullif(trim(p_scopes), ''), 'airsup'),
    p_expires_at
  );
end;
$function$;

create or replace function public.oauth_store_refresh(
  p_token text,
  p_token_hash text,
  p_username text,
  p_client_id text,
  p_resource text,
  p_scopes text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  insert into public.oauth_refresh_tokens (
    token_hash, username, client_id, resource, scopes, expires_at
  ) values (
    trim(p_token_hash),
    lower(trim(p_username)),
    trim(p_client_id),
    coalesce(p_resource, ''),
    coalesce(nullif(trim(p_scopes), ''), 'airsup'),
    p_expires_at
  );
end;
$function$;

create or replace function public.oauth_auth_access(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.oauth_access_tokens%rowtype;
  u public.users%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into t from public.oauth_access_tokens where token_hash = trim(p_token_hash);
  if not found then return null; end if;
  if t.expires_at < now() then return null; end if;
  select * into u from public.users where username = t.username;
  if not found then return null; end if;
  return jsonb_build_object(
    'username', u.username,
    'displayName', u.display_name,
    'bio', u.bio,
    'tokenPrefix', u.token_prefix,
    'orgoComputerId', u.orgo_computer_id,
    'createdAt', u.created_at,
    'updatedAt', u.updated_at
  );
end;
$function$;

create or replace function public.oauth_consume_refresh(
  p_token text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.oauth_refresh_tokens%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into t from public.oauth_refresh_tokens where token_hash = trim(p_token_hash) for update;
  if not found then return null; end if;
  if t.expires_at < now() then return null; end if;
  delete from public.oauth_refresh_tokens where token_hash = t.token_hash;
  return jsonb_build_object(
    'username', t.username,
    'clientId', t.client_id,
    'resource', t.resource,
    'scopes', t.scopes
  );
end;
$function$;

grant execute on function public.oauth_store_code(text, text, text, text, text, text, text, text, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.oauth_consume_code(text, text) to anon, authenticated, service_role;
grant execute on function public.oauth_store_access(text, text, text, text, text, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.oauth_store_refresh(text, text, text, text, text, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.oauth_auth_access(text, text) to anon, authenticated, service_role;
grant execute on function public.oauth_consume_refresh(text, text) to anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
