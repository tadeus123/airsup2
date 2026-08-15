-- Look up who sent a message (for talk_to_user follow-up vs answer detection).
create or replace function public.message_from_username(
  p_token text,
  p_message_id bigint
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  author text;
begin
  perform public.assert_db_token(p_token);
  if p_message_id is null or p_message_id <= 0 then
    return null;
  end if;
  select from_username into author
  from public.messages
  where id = p_message_id;
  return author;
end;
$function$;

grant execute on function public.message_from_username(text, bigint) to anon, authenticated, service_role;
