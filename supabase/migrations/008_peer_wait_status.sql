-- Track whether the peer opened the inbound (thinking) vs never picked up (offline).

alter table public.messages
  add column if not exists wake_sent_at timestamptz,
  add column if not exists wake_error text;

create or replace function public.message_get_inbound(
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
  if p_message_id is null or p_message_id <= 0 then
    return null;
  end if;
  update public.messages
  set status = case when status = 'pending' then 'delivered' else status end,
      delivered_at = coalesce(delivered_at, now())
  where id = p_message_id
    and to_username = uname
  returning * into msg;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', msg.id,
    'conversationId', msg.conversation_id,
    'fromUsername', msg.from_username,
    'toUsername', msg.to_username,
    'body', msg.body,
    'status', msg.status,
    'replyToId', msg.reply_to_id,
    'createdAt', msg.created_at,
    'deliveredAt', msg.delivered_at
  );
end;
$function$;

create or replace function public.message_mark_wake(
  p_token text,
  p_from text,
  p_message_id bigint,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  from_u text := lower(trim(p_from));
begin
  perform public.assert_db_token(p_token);
  if p_message_id is null or p_message_id <= 0 then
    return;
  end if;
  if p_error is not null and length(trim(p_error)) > 0 then
    update public.messages
    set wake_error = left(trim(p_error), 240)
    where id = p_message_id
      and from_username = from_u;
  else
    update public.messages
    set wake_sent_at = coalesce(wake_sent_at, now()),
        wake_error = null
    where id = p_message_id
      and from_username = from_u;
  end if;
end;
$function$;

create or replace function public.message_outbound_status(
  p_token text,
  p_from text,
  p_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  msg public.messages%rowtype;
  from_u text := lower(trim(p_from));
begin
  perform public.assert_db_token(p_token);
  if p_message_id is null or p_message_id <= 0 then
    return null;
  end if;
  select * into msg
  from public.messages
  where id = p_message_id
    and from_username = from_u;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', msg.id,
    'status', msg.status,
    'createdAt', msg.created_at,
    'deliveredAt', msg.delivered_at,
    'wakeSentAt', msg.wake_sent_at,
    'wakeError', msg.wake_error
  );
end;
$function$;

grant execute on function public.message_mark_wake(text, text, bigint, text)
  to anon, authenticated, service_role;
grant execute on function public.message_outbound_status(text, text, bigint)
  to anon, authenticated, service_role;
grant execute on function public.message_get_inbound(text, text, bigint)
  to anon, authenticated, service_role;
