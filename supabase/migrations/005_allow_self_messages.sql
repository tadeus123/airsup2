-- Allow messaging yourself (useful for solo testing via Orgo relay).

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
