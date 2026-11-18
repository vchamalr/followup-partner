// One-off: creates the Vapi structured output + assistant, prints the assistant id.
// Run: deno run --allow-net --allow-env --env-file=.env setup.ts
const key = Deno.env.get("VAPI_PRIVATE_KEY");
const fnUrl = Deno.env.get("FUNCTION_URL");
const secret = Deno.env.get("WEBHOOK_SECRET");
if (!key || !fnUrl || !secret) throw new Error("Set VAPI_PRIVATE_KEY, FUNCTION_URL and WEBHOOK_SECRET in .env first");

async function vapi(path: string, body: unknown) {
  const r = await fetch("https://api.vapi.ai" + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

import { LABELS } from "./supabase/functions/followup/apply.ts";

const PROMPT = `You are an accountability partner on a short voice check-in. The caller struggles to follow up with vendors, customers and people doing tasks for them. Your job: get every due follow-up decided in under three minutes. Be warm, brisk and direct. One question at a time. Never lecture.

Today is {{today}}. Follow-ups due:
{{tasks}}

For each due item, say the person and the thing in a few words, then ask "Did they reply?"
- Replied / sorted: mark it complete.
- Not yet: say you will draft a chase message, and ask when to check again (default: two days).
- They want to drop it: mark it complete.
After the list, ask once: "Anything new you are waiting on from someone?" For each new one get: who, what, and when to chase. If they say which project it is for (SUWA, Ceylon Wedding, WhatsCal, Moments, Impact, Montar, Ever After, Open Check, Pet Charity, Follow-up Partner), note it; do not ask.
Then read back a one-line summary ("2 chased, 1 done, 1 new"), tell them the WhatsApp drafts will be in Todoist in a minute, and say goodbye.

Names are often Sri Lankan (Kasun, Nimal, Dilani). If a name comes through as an ordinary English word, ask them to say the name again once.

Never read out ids. If they are busy, offer to push everything to tomorrow and end the call.`;

const output = await vapi("/structured-output", {
  name: "followup_actions",
  type: "ai",
  description:
    "Every decision made on the call. The system prompt lists due items as 'id=<id> | title | notes' and gives today's date. " +
    "Use those ids for task_id. Dates are YYYY-MM-DD, resolved from today's date. " +
    "draft: for reschedule and create items where the caller still needs to message the person, a short friendly WhatsApp message " +
    "in the caller's voice saying what was asked and asking for an update; firmer if the notes show Chases of 2 or more. No draft for complete.",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["complete", "reschedule", "create"] },
            task_id: { type: "string" },
            person: { type: "string" },
            what: { type: "string" },
            date: { type: "string", description: "Next chase date, YYYY-MM-DD" },
            draft: { type: "string" },
            // No enum here: one out-of-list value made Vapi return an empty result and the whole call was lost. apply.ts checks it.
            project: {
              type: "string",
              description: `Only for create, and only if the caller named a project. Exactly one of: ${LABELS.join(", ")}. ` +
                "Pick the closest match to what was heard (speech recognition garbles names, e.g. 'salon wedding' means ceylon-wedding). Omit if none fits.",
            },
          },
          required: ["action"],
        },
      },
    },
    required: ["items"],
  },
});

const assistant = await vapi("/assistant", {
  name: "Follow-up Partner",
  model: { provider: "anthropic", model: "claude-haiku-5-5", messages: [{ role: "system", content: PROMPT }] },
  voice: { provider: "vapi", voiceId: "Elliot" },
  transcriber: {
    provider: "deepgram",
    model: "nova-3",
    language: "en-IN",
    keyterm: ["Ceylon Wedding", "SUWA", "WhatsCal", "Montar", "Ever After", "Open Check", "Pet Charity", "Kasun", "Nimal", "chase"],
  },
  firstMessage: "Hi, check-in time. {{greeting}}",
  maxDurationSeconds: 480,
  server: { url: `${fnUrl}/done`, headers: { "X-Vapi-Secret": secret } },
  serverMessages: ["end-of-call-report"],
  artifactPlan: { structuredOutputIds: [output.id] },
});

const envFile = await Deno.readTextFile(".env");
await Deno.writeTextFile(".env", envFile.replace(/^VAPI_ASSISTANT_ID=.*$/m, `VAPI_ASSISTANT_ID=${assistant.id}`));
console.log(`Assistant created and saved to .env.\nIn the ntfy app, subscribe to this topic: ${Deno.env.get("NTFY_TOPIC")}`);
