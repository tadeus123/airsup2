-- Allow updating display_name after OAuth name-page prewarm creates a provisional user.
create or replace function public.user_set_display_name(
  p_token text,
  p_token_hash text,
  p_display_name text
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
  update public.users
  set display_name = left(nullif(trim(p_display_name), ''), 80),
      updated_at = now()
  where token_hash = trim(p_token_hash)
  returning * into u;
  if not found then raise exception 'user not found'; end if;
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

grant execute on function public.user_set_display_name(text, text, text)
  to anon, authenticated, service_role;
