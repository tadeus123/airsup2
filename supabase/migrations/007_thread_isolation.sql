-- Hard per-message isolation: fetch one inbound row, and bind replies to that thread.

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
  select * into msg
  from public.messages
  where id = p_message_id
    and to_username = uname;
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
    'createdAt', msg.created_at
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
  inbound public.messages%rowtype;
  from_u text := lower(trim(p_from));
  to_u text := lower(trim(p_to));
  cid text := trim(p_conversation_id);
begin
  perform public.assert_db_token(p_token);
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'body required';
  end if;
  if p_ack_id is null or p_ack_id <= 0 then
    raise exception 'ack_id required';
  end if;
  if p_reply_to_id is null or p_reply_to_id <= 0 then
    raise exception 'reply_to_id required';
  end if;
  if p_ack_id <> p_reply_to_id then
    raise exception 'ack_id must match reply_to_id';
  end if;
  if cid is null or cid = '' then
    raise exception 'conversation_id required';
  end if;
  if not exists (select 1 from public.users where username = from_u) then
    raise exception 'unknown from username';
  end if;
  if not exists (select 1 from public.users where username = to_u) then
    raise exception 'unknown to username';
  end if;

  select * into inbound
  from public.messages
  where id = p_reply_to_id;
  if not found then
    raise exception 'inbound message not found';
  end if;
  if inbound.to_username <> from_u then
    raise exception 'that message was not sent to you';
  end if;
  if inbound.from_username <> to_u then
    raise exception 'peer mismatch — refusing to mix threads';
  end if;
  if inbound.conversation_id <> cid then
    raise exception 'conversation mismatch — refusing to mix threads';
  end if;

  insert into public.messages (
    conversation_id, from_username, to_username, body, reply_to_id
  ) values (
    cid,
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
