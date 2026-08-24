-- Display connected count as real users; claim still issues monotonic numbers.

create or replace function public.ainet_member_count(p_token text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  users_n bigint;
begin
  perform public.assert_db_token(p_token);
  select count(*)::bigint into users_n from public.users;
  return coalesce(users_n, 0);
end;
$function$;

create or replace function public.ainet_claim_member_number(p_token text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n bigint;
  users_n bigint;
begin
  perform public.assert_db_token(p_token);
  select count(*)::bigint into users_n from public.users;
  insert into public.ainet_meta (key, value)
  values ('member_count', 0)
  on conflict (key) do nothing;

  update public.ainet_meta
  set value = greatest(coalesce(value, 0), coalesce(users_n, 0)) + 1
  where key = 'member_count'
  returning value into n;

  return n;
end;
$function$;
