-- List orgo_computer_id values linked to portal users (for stale VM cleanup).

create or replace function public.orgo_computer_ids_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_db_token(p_token);
  return coalesce((
    select jsonb_agg(distinct nullif(trim(u.orgo_computer_id), ''))
    from public.users u
    where nullif(trim(u.orgo_computer_id), '') is not null
  ), '[]'::jsonb);
end;
$function$;

grant execute on function public.orgo_computer_ids_list(text)
  to anon, authenticated, service_role;
