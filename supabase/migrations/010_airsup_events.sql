-- Persistent Airsup ops events so we can answer "what is failing?" from the DB.

create table if not exists public.airsup_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  severity text not null default 'info'
    check (severity in ('info', 'warn', 'error')),
  ok boolean not null default true,
  username text not null default '',
  peer_username text not null default '',
  message_id bigint,
  computer_id text,
  request_id text not null default '',
  summary text not null default '',
  detail jsonb not null default '{}'::jsonb
);

create index if not exists airsup_events_created_idx
  on public.airsup_events (created_at desc);

create index if not exists airsup_events_fail_idx
  on public.airsup_events (created_at desc)
  where ok = false or severity in ('warn', 'error');

create index if not exists airsup_events_kind_idx
  on public.airsup_events (kind, created_at desc);

alter table public.airsup_events enable row level security;

create or replace function public.airsup_event_log(
  p_token text,
  p_kind text,
  p_severity text default 'info',
  p_ok boolean default true,
  p_username text default '',
  p_peer text default '',
  p_message_id bigint default null,
  p_computer_id text default null,
  p_request_id text default '',
  p_summary text default '',
  p_detail jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id bigint;
  sev text := lower(coalesce(nullif(trim(p_severity), ''), 'info'));
begin
  perform public.assert_db_token(p_token);
  if p_kind is null or trim(p_kind) = '' then
    raise exception 'kind required';
  end if;
  if sev not in ('info', 'warn', 'error') then
    sev := 'info';
  end if;

  insert into public.airsup_events (
    kind, severity, ok, username, peer_username, message_id,
    computer_id, request_id, summary, detail
  ) values (
    left(trim(p_kind), 64),
    sev,
    coalesce(p_ok, true),
    left(lower(trim(coalesce(p_username, ''))), 40),
    left(lower(trim(coalesce(p_peer, ''))), 40),
    p_message_id,
    nullif(left(trim(coalesce(p_computer_id, '')), 80), ''),
    left(trim(coalesce(p_request_id, '')), 32),
    left(trim(coalesce(p_summary, '')), 400),
    coalesce(p_detail, '{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$function$;

create or replace function public.airsup_failures_list(
  p_token text,
  p_hours int default 48,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 48), 168)));
  lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  event_rows jsonb;
  message_rows jsonb;
begin
  perform public.assert_db_token(p_token);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  into event_rows
  from (
    select
      e.id,
      e.created_at,
      e.kind,
      e.severity,
      e.ok,
      e.username,
      e.peer_username,
      e.message_id,
      e.computer_id,
      e.request_id,
      e.summary,
      e.detail,
      'event'::text as source
    from public.airsup_events e
    where e.created_at >= since
      and (e.ok = false or e.severity in ('warn', 'error'))
    order by e.created_at desc
    limit lim
  ) x;

  -- Derived message problems (wake failed, or woken but never opened).
  select coalesce(jsonb_agg(row_to_json(y)::jsonb order by y.created_at desc), '[]'::jsonb)
  into message_rows
  from (
    select
      m.id as message_id,
      m.created_at,
      m.from_username as username,
      m.to_username as peer_username,
      m.status,
      m.wake_sent_at,
      m.wake_error,
      m.delivered_at,
      case
        when m.wake_error is not null and length(trim(m.wake_error)) > 0 then 'wake_error'
        when m.wake_sent_at is not null and m.delivered_at is null
          and m.wake_sent_at < now() - interval '3 minutes' then 'wake_not_opened'
        when m.wake_sent_at is null
          and m.reply_to_id is null
          and m.status = 'pending'
          and m.created_at < now() - interval '2 minutes' then 'no_wake_pending'
        else null
      end as issue,
      'message'::text as source
    from public.messages m
    where m.created_at >= since
      and (
        (m.wake_error is not null and length(trim(m.wake_error)) > 0)
        or (
          m.wake_sent_at is not null
          and m.delivered_at is null
          and m.wake_sent_at < now() - interval '3 minutes'
        )
        or (
          m.wake_sent_at is null
          and m.reply_to_id is null
          and m.status = 'pending'
          and m.created_at < now() - interval '2 minutes'
        )
      )
    order by m.created_at desc
    limit lim
  ) y
  where y.issue is not null;

  return jsonb_build_object(
    'ok', true,
    'since', since,
    'events', event_rows,
    'messages', message_rows,
    'counts', jsonb_build_object(
      'events', jsonb_array_length(event_rows),
      'messages', jsonb_array_length(message_rows)
    )
  );
end;
$function$;

grant execute on function public.airsup_event_log(
  text, text, text, boolean, text, text, bigint, text, text, text, jsonb
) to anon, authenticated, service_role;

grant execute on function public.airsup_failures_list(text, int, int)
  to anon, authenticated, service_role;
