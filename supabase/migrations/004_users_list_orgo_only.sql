-- Only list users who have linked an Orgo computer (reachable peers).

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
    where nullif(trim(u.orgo_computer_id), '') is not null
      and (
        q = ''
        or u.username like '%' || q || '%'
        or lower(u.display_name) like '%' || q || '%'
        or lower(u.bio) like '%' || q || '%'
      )
    limit lim
  ), '[]'::jsonb);
end;
$function$;
