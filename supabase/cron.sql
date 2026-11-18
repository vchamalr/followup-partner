-- Run once in the Supabase SQL editor. Replace <CRON_KEY> with the value from .env first.
-- Asks the edge function whether to push, then sends the push from the database's own IP
-- (ntfy rate-limits Supabase's shared edge IP).
create extension if not exists http with schema extensions;
create schema if not exists private;
create or replace function private.followup_push(qs text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb; r extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  select content::jsonb into p from extensions.http((
    'POST', 'https://acnkxzqquggxkntogcut.supabase.co/functions/v1/followup/notify?' || qs,
    array[extensions.http_header('x-key', '<CRON_KEY>')], 'application/json', '{}'
  )::extensions.http_request);
  if not coalesce((p->>'send')::boolean, false) then return p - 'click'; end if;
  select * into r from extensions.http((
    'POST', p->>'url',
    array[extensions.http_header('Title', p->>'title'), extensions.http_header('Priority', 'urgent'), extensions.http_header('Click', p->>'click')],
    'text/plain', p->>'body'
  )::extensions.http_request);
  if r.status <> 200 then raise warning 'ntfy %: %', r.status, left(r.content, 200); end if;
  return jsonb_build_object('sent', r.status = 200, 'ntfy', r.status);
end $$;
revoke all on function private.followup_push(text) from public, anon, authenticated;

-- Times are UTC. Sri Lanka = UTC+5:30, so 03:30 = 9:00 and 11:00 = 16:30.
select cron.schedule('followup-am', '30 3 * * 1-5', $$select private.followup_push('slot=am')$$);
select cron.schedule('followup-am-retry', '45 3 * * 1-5', $$select private.followup_push('slot=am&retry=1')$$);
select cron.schedule('followup-pm', '0 11 * * 1-5', $$select private.followup_push('slot=pm')$$);
select cron.schedule('followup-pm-retry', '15 11 * * 1-5', $$select private.followup_push('slot=pm&retry=1')$$);
