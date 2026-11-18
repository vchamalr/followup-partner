# Follow-up Partner

A voice check-in twice a day about who you are waiting on. Chases live in Todoist (**Other Projects → Follow-ups**), the call runs on Vapi in the browser, and each chase gets a tap-to-send WhatsApp draft.

## Parts

- `supabase/functions/followup/` — one Edge Function on Supabase project `acnkxzqquggxkntogcut`
  - `POST /notify` scheduler sends the push (ntfy)
  - `GET /start` the call page fetches today's chase list
  - `POST /done` Vapi reports the call; `apply.ts` turns it into Todoist changes
- `docs/index.html` — the tap-to-talk page (GitHub Pages)
- `setup.ts` — one-off: creates the Vapi assistant
- `.env` — all keys. Never commit it. The same contents go into Supabase → Edge Functions → Secrets.

## Change things

- **Call times:** Supabase → Integrations → Cron. Times are UTC (Sri Lanka = UTC+5:30). Jobs: `followup-am`, `followup-am-retry`, `followup-pm`, `followup-pm-retry`.
- **Pause:** disable those four cron jobs.
- **What it says:** edit `PROMPT` in `setup.ts`, delete the old assistant in Vapi, run setup again, update `VAPI_ASSISTANT_ID` in Supabase secrets.
- **Rotate a key:** change it in `.env` and in Supabase secrets. `CRON_KEY` also lives inside the four cron jobs.

## Test

```bash
deno test supabase/functions/followup/
```

## Known limits

- Reads at most 200 tasks from the section.
- It cannot see WhatsApp, so it asks you whether someone replied.
- A push notification can be swiped away. Upgrade path: WhatsApp Business Calling for a real ring.
