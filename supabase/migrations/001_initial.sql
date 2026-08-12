-- Airsup v1: users, messages, conversation_waits + security-definer RPCs

create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

insert into public.app_secrets (key, value)
values ('db_token', coalesce(current_setting('app.airsup_db_token', true), 'SET_VIA_DEPLOY'))
on conflict (key) do nothing;

create or replace function public.assert_db_token(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_token is null or trim(p_token) = '' then
    raise exception 'db token required';
  end if;
  if not exists (
    select 1 from public.app_secrets
    where key = 'db_token' and value = trim(p_token)
  ) then
    raise exception 'invalid db token';
  end if;
end;
$function$;

create table if not exists public.users (
  username text primary key,
  display_name text not null,
  bio text not null default '',
  token_hash text not null,
  token_prefix text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_token_hash_uidx on public.users (token_hash);
create index if not exists users_display_name_idx on public.users (display_name);

alter table public.users enable row level security;

create table if not exists public.messages (
  id bigserial primary key,
  conversation_id text not null,
  from_username text not null references public.users(username) on delete cascade,
  to_username text not null references public.users(username) on delete cascade,
  body text not null,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'delivered'::text, 'acked'::text])),
  reply_to_id bigint references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  acked_at timestamptz
);

create index if not exists messages_inbox_idx on public.messages (to_username, id);
create index if not exists messages_unacked_idx on public.messages (to_username, status, id);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);

alter table public.messages enable row level security;

create table if not exists public.conversation_waits (
  username text not null references public.users(username) on delete cascade,
  conversation_id text not null,
  peer_username text not null default '',
  status text not null default 'active'
    check (status = any (array['active'::text, 'cancelled'::text])),
  live_await boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (username, conversation_id)
);

create index if not exists conversation_waits_expires_idx on public.conversation_waits (expires_at);

alter table public.conversation_waits enable row level security;

-- user upsert (registration / token rotation)
create or replace function public.user_upsert(
  p_token text,
  p_username text,
  p_display_name text,
  p_token_hash text,
  p_token_prefix text,
  p_bio text default ''
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
  if p_token_hash is null or trim(p_token_hash) = '' then
    raise exception 'token_hash required';
  end if;

  insert into public.users as usr (
    username, display_name, bio, token_hash, token_prefix, updated_at
  ) values (
    uname,
    coalesce(nullif(trim(p_display_name), ''), uname),
    coalesce(p_bio, ''),
    trim(p_token_hash),
    coalesce(p_token_prefix, ''),
    now()
  )
  on conflict (username) do update set
    display_name = excluded.display_name,
    bio = coalesce(nullif(excluded.bio, ''), usr.bio),
    token_hash = excluded.token_hash,
    token_prefix = excluded.token_prefix,
    updated_at = now()
  returning * into u;

  return jsonb_build_object(
    'username', u.username,
    'displayName', u.display_name,
    'bio', u.bio,
    'tokenPrefix', u.token_prefix,
    'createdAt', u.created_at,
    'updatedAt', u.updated_at
  );
end;
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
  return jsonb_build_object(
    'username', u.username,
    'displayName', u.display_name,
    'bio', u.bio,
    'tokenPrefix', u.token_prefix,
    'createdAt', u.created_at,
    'updatedAt', u.updated_at
  );
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
  return jsonb_build_object(
    'username', u.username,
    'displayName', u.display_name,
    'bio', u.bio,
    'tokenPrefix', u.token_prefix,
    'createdAt', u.created_at,
    'updatedAt', u.updated_at
  );
end;
$function$;

create or replace function public.users_list(
  p_token text,
  p_query text default '',
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  lim integer := greatest(1, least(coalesce(p_limit, 50), 100));
  q text := lower(trim(coalesce(p_query, '')));
begin
  perform public.assert_db_token(p_token);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'username', u.username,
        'displayName', u.display_name,
        'bio', u.bio
      )
      order by u.username
    )
    from public.users u
    where q = ''
       or u.username like '%' || q || '%'
       or lower(u.display_name) like '%' || q || '%'
       or lower(u.bio) like '%' || q || '%'
    limit lim
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.message_send(
  p_token text,
  p_from text,
  p_to text,
  p_body text,
  p_conversation_id text default '',
  p_reply_to_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  msg public.messages%rowtype;
  from_u text := lower(trim(p_from));
  to_u text := lower(trim(p_to));
  cid text;
begin
  perform public.assert_db_token(p_token);
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'body required';
  end if;
  if from_u = '' or to_u = '' then raise exception 'from/to required'; end if;
  if from_u = to_u then raise exception 'cannot message yourself'; end if;
  if not exists (select 1 from public.users where username = from_u) then
    raise exception 'unknown from username';
  end if;
  if not exists (select 1 from public.users where username = to_u) then
    raise exception 'unknown to username';
  end if;

  cid := coalesce(nullif(trim(p_conversation_id), ''), gen_random_uuid()::text);

  insert into public.messages (
    conversation_id, from_username, to_username, body, reply_to_id
  ) values (
    cid, from_u, to_u, trim(p_body), p_reply_to_id
  ) returning * into msg;

  return jsonb_build_object(
    'id', msg.id,
    'conversationId', msg.conversation_id,
    'fromUsername', msg.from_username,
    'toUsername', msg.to_username,
    'body', msg.body,
    'status', msg.status,
    'replyToId', msg.reply_to_id,
    'createdAt', msg.created_at
  );
end;
$function$;

create or replace function public.inbox_unacked(
  p_token text,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uname text := lower(trim(p_username));
begin
  perform public.assert_db_token(p_token);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'conversationId', m.conversation_id,
        'fromUsername', m.from_username,
        'toUsername', m.to_username,
        'body', m.body,
        'status', m.status,
        'replyToId', m.reply_to_id,
        'createdAt', m.created_at
      )
      order by m.id asc
    )
    from public.messages m
    where m.to_username = uname
      and m.status in ('pending', 'delivered')
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.message_mark_delivered(
  p_token text,
  p_username text,
  p_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uname text := lower(trim(p_username));
begin
  perform public.assert_db_token(p_token);
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  update public.messages
  set status = 'delivered',
      delivered_at = coalesce(delivered_at, now())
  where to_username = uname
    and id = any(p_ids)
    and status = 'pending';
end;
$function$;

create or replace function public.message_ack(
  p_token text,
  p_username text,
  p_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  msg public.messages%rowtype;
  uname text := lower(trim(p_username));
begin
  perform public.assert_db_token(p_token);
  update public.messages
  set status = 'acked',
      acked_at = now(),
      delivered_at = coalesce(delivered_at, now())
  where id = p_message_id and to_username = uname
  returning * into msg;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', msg.id,
    'status', msg.status,
    'ackedAt', msg.acked_at
  );
end;
$function$;

create or replace function public.message_reply_and_ack(
  p_token text,
  p_from text,
  p_to text,
  p_body text,
  p_conversation_id text,
  p_reply_to_id bigint,
  p_ack_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  msg public.messages%rowtype;
  ack public.messages%rowtype;
  from_u text := lower(trim(p_from));
  to_u text := lower(trim(p_to));
begin
  perform public.assert_db_token(p_token);
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'body required';
  end if;
  if p_ack_id is null or p_ack_id <= 0 then
    raise exception 'ack_id required';
  end if;
  if not exists (select 1 from public.users where username = from_u) then
    raise exception 'unknown from username';
  end if;
  if not exists (select 1 from public.users where username = to_u) then
    raise exception 'unknown to username';
  end if;

  insert into public.messages (
    conversation_id, from_username, to_username, body, reply_to_id
  ) values (
    coalesce(nullif(trim(p_conversation_id), ''), gen_random_uuid()::text),
    from_u,
    to_u,
    trim(p_body),
    p_reply_to_id
  ) returning * into msg;

  update public.messages
  set status = 'acked',
      acked_at = now(),
      delivered_at = coalesce(delivered_at, now())
  where id = p_ack_id and to_username = from_u
  returning * into ack;

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', msg.id,
      'conversationId', msg.conversation_id,
      'fromUsername', msg.from_username,
      'toUsername', msg.to_username,
      'body', msg.body,
      'status', msg.status,
      'replyToId', msg.reply_to_id,
      'createdAt', msg.created_at
    ),
    'ack', case when ack.id is null then null else jsonb_build_object(
      'id', ack.id,
      'status', ack.status,
      'ackedAt', ack.acked_at
    ) end
  );
end;
$function$;

create or replace function public.wait_upsert(
  p_token text,
  p_username text,
  p_conversation_id text,
  p_peer_username text,
  p_ttl_ms integer,
  p_live_await boolean default false,
  p_cancel boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.conversation_waits%rowtype;
  uname text := lower(trim(p_username));
  cid text := trim(p_conversation_id);
  peer text := lower(trim(coalesce(p_peer_username, '')));
  ttl integer := greatest(5000, least(coalesce(p_ttl_ms, 300000), 86400000));
begin
  perform public.assert_db_token(p_token);
  if uname = '' or cid = '' then
    raise exception 'username and conversation_id required';
  end if;

  insert into public.conversation_waits as w (
    username, conversation_id, peer_username, status, live_await, expires_at, updated_at
  ) values (
    uname,
    cid,
    peer,
    case when coalesce(p_cancel, false) then 'cancelled' else 'active' end,
    coalesce(p_live_await, false),
    case
      when coalesce(p_cancel, false) then now()
      else now() + make_interval(secs => ttl / 1000.0)
    end,
    now()
  )
  on conflict (username, conversation_id) do update set
    peer_username = case
      when excluded.peer_username <> '' then excluded.peer_username
      else w.peer_username
    end,
    status = case
      when coalesce(p_cancel, false) then 'cancelled'
      else 'active'
    end,
    live_await = case
      when coalesce(p_cancel, false) then true
      else (w.live_await or excluded.live_await)
    end,
    expires_at = case
      when coalesce(p_cancel, false) then now()
      else now() + make_interval(secs => ttl / 1000.0)
    end,
    updated_at = now()
  returning * into r;

  return jsonb_build_object(
    'username', r.username,
    'conversationId', r.conversation_id,
    'peerUsername', r.peer_username,
    'status', r.status,
    'liveAwait', r.live_await,
    'expiresAt', r.expires_at,
    'updatedAt', r.updated_at,
    'createdAt', r.created_at
  );
end;
$function$;

create or replace function public.wait_get(
  p_token text,
  p_username text,
  p_conversation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.conversation_waits%rowtype;
begin
  perform public.assert_db_token(p_token);
  select * into r
  from public.conversation_waits
  where username = lower(trim(p_username))
    and conversation_id = trim(p_conversation_id);
  if not found then return null; end if;
  return jsonb_build_object(
    'username', r.username,
    'conversationId', r.conversation_id,
    'peerUsername', r.peer_username,
    'status', r.status,
    'liveAwait', r.live_await,
    'expiresAt', r.expires_at,
    'updatedAt', r.updated_at,
    'createdAt', r.created_at
  );
end;
$function$;

create or replace function public.wait_get_many(
  p_token text,
  p_pairs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  out jsonb := '[]'::jsonb;
begin
  perform public.assert_db_token(p_token);
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) = 0 then
    return out;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'username', w.username,
      'conversationId', w.conversation_id,
      'peerUsername', w.peer_username,
      'status', w.status,
      'liveAwait', w.live_await,
      'expiresAt', w.expires_at,
      'updatedAt', w.updated_at,
      'createdAt', w.created_at
    )
    order by w.username, w.conversation_id
  ), '[]'::jsonb)
  into out
  from public.conversation_waits w
  inner join lateral (
    select
      lower(trim(coalesce(elem->>'username', elem->>'handle', ''))) as username,
      trim(coalesce(elem->>'conversationId', elem->>'conversation_id', '')) as conversation_id
    from jsonb_array_elements(p_pairs) elem
  ) p on p.username = w.username and p.conversation_id = w.conversation_id
  where p.username <> '' and p.conversation_id <> '';

  return coalesce(out, '[]'::jsonb);
end;
$function$;
