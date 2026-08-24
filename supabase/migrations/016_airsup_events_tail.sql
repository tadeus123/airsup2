-- Tail recent ops events for live monitoring during demos.

create or replace function public.airsup_events_tail(
  p_token text,
  p_after_id bigint default 0,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  after_id bigint := greatest(0, coalesce(p_after_id, 0));
begin
  perform public.assert_db_token(p_token);

  return coalesce(
    (
      select jsonb_agg(row_to_json(x)::jsonb order by x.id asc)
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
          e.summary
        from public.airsup_events e
        where e.id > after_id
        order by e.id asc
        limit lim
      ) x
    ),
    '[]'::jsonb
  );
end;
$function$;

grant execute on function public.airsup_events_tail(text, bigint, int)
  to anon, authenticated, service_role;
