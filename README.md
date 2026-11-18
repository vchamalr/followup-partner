# Follow-up Partner

A voice check-in twice a day about who you are waiting on. Chases live in Todoist (**Other Projects → Follow-ups**), the call runs on Vapi in the browser, and each chase gets a tap-to-send WhatsApp draft.

## Parts

- `supabase/functions/followup/` — one Edge Function on Supabase project `acnkxzqquggxkntogcut`
  - `POST /notify` decides whether to push and returns it; the database sends it to ntfy
  - `GET /start` the call page fetches today's chase list
  - `POST /done` Vapi reports the call; `apply.ts` turns it into Todoist changes
- `docs/index.html` — the tap-to-talk page (GitHub Pages)
- `setup.ts` — one-off: creates the Vapi assistant
- `.env` — all keys. Never commit it. The same contents go into Supabase → Edge Functions → Secrets, either one secret per line or one secret (any name) holding the whole file.
- `supabase/cron.sql` — the database function and four cron jobs that send the push. The database sends it because ntfy rate-limits (429) the shared address Edge Functions call from. No ntfy account needed.

## Change things

- **Call times:** Supabase → Integrations → Cron. Times are UTC (Sri Lanka = UTC+5:30). Jobs: `followup-am`, `followup-am-retry`, `followup-pm`, `followup-pm-retry`.
- **Pause:** disable those four cron jobs.
- **Send a test push:** run `select private.followup_push('slot=pm');` in the Supabase SQL editor.
- **Project labels:** say the project when adding a chase ("for Ceylon Wedding") and the task gets that Todoist label. The list is `LABELS` in `apply.ts`; after changing it, redeploy the function and update the `project` enum on the Vapi structured output.
- **What it says:** edit `PROMPT` in `setup.ts`, delete the old assistant in Vapi, run setup again, update `VAPI_ASSISTANT_ID` in Supabase secrets.
- **Rotate a key:** change it in `.env` and in Supabase secrets. `CRON_KEY` also lives inside `private.followup_push` (re-run `supabase/cron.sql` with the new key).

## Test

```bash
deno test supabase/functions/followup/
```

## Known limits

- Vapi sometimes ends a call with an empty result. The server re-runs the extraction once (up to a minute); if that also fails, a task "Check-in was not saved: say it again" appears in Follow-ups.
- Reads at most 200 tasks from the section.
- It cannot see WhatsApp, so it asks you whether someone replied.
- A push notification can be swiped away. Upgrade path: WhatsApp Business Calling for a real ring.
