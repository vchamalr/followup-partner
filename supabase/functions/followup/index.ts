// Follow-up Partner: three routes on one function.
//   POST /notify  (cron)          -> push "N to chase" with a tap-to-talk link
//   GET  /start   (call page)     -> assistant id + today's chase list
//   POST /done    (Vapi webhook)  -> apply what was said to Todoist
import { timingSafeEqual } from "node:crypto";
import { apply, type Item, type Op, type Task } from "./apply.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const TZ = env("TZ_NAME") || "Asia/Colombo";
const TODOIST = "https://api.todoist.com/api/v1";
const VAPI = "https://api.vapi.ai";

const same = (a: string, b: string) =>
  a.length > 0 && a.length === b.length && timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function todoist(path: string, body?: unknown) {
  const r = await fetch(TODOIST + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${env("TODOIST_TOKEN")}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Todoist ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

type TodoistTask = { id: string; content: string; description: string; due: { date: string } | null };

// ponytail: first 200 tasks only; follow next_cursor if the section ever grows past that.
async function sectionTasks(): Promise<TodoistTask[]> {
  return (await todoist(`/tasks?section_id=${env("SECTION_ID")}&limit=200`)).results;
}

const isDue = (t: TodoistTask, day: string) => !t.due || t.due.date.slice(0, 10) <= day;

async function notify(url: URL) {
  const due = (await sectionTasks()).filter((t) => isDue(t, today()));
  // Morning call only when something is due; afternoon always (to catch new follow-ups).
  if (url.searchParams.get("slot") === "am" && due.length === 0) return json({ sent: false, why: "nothing due" });
  if (url.searchParams.get("retry")) {
    const since = new Date(Date.now() - 20 * 60_000).toISOString();
    const r = await fetch(`${VAPI}/call?assistantId=${env("VAPI_ASSISTANT_ID")}&createdAtGt=${since}&limit=1`, {
      headers: { Authorization: `Bearer ${env("VAPI_PRIVATE_KEY")}` },
    });
    if (r.ok && (await r.json()).length > 0) return json({ sent: false, why: "already answered" });
  }
  // No names in the push: it passes through ntfy's servers.
  const r = await fetch(`https://ntfy.sh/${env("NTFY_TOPIC")}`, {
    method: "POST",
    headers: {
      Title: url.searchParams.get("retry") ? "Still waiting: follow-up check-in" : "Follow-up check-in",
      Priority: "urgent",
      Click: `${env("PAGE_URL")}#k=${env("APP_KEY")}`,
    },
    body: due.length ? `${due.length} to chase. Tap to talk.` : "Anything new to chase? Tap to talk.",
  });
  return json({ sent: r.ok, due: due.length });
}

async function start() {
  const day = today();
  const due = (await sectionTasks()).filter((t) => isDue(t, day));
  const tasks = due.map((t) =>
    `id=${t.id} | ${t.content} | ${t.description.split("\n").filter((l) => !l.startsWith("[Send on WhatsApp]")).join(" ")}`
  ).join("\n") || "(nothing due)";
  return json({
    publicKey: env("VAPI_PUBLIC_KEY"),
    assistantId: env("VAPI_ASSISTANT_ID"),
    variableValues: { today: day, count: String(due.length), tasks },
  });
}

async function run(op: Op) {
  if (op.op === "close") return todoist(`/tasks/${op.id}/close`, {});
  if (op.op === "update") return todoist(`/tasks/${op.id}`, { due_date: op.due_date, description: op.description });
  return todoist("/tasks", {
    content: op.content,
    description: op.description,
    due_date: op.due_date,
    project_id: env("PROJECT_ID"),
    section_id: env("SECTION_ID"),
  });
}

async function done(req: Request) {
  const { message } = await req.json();
  if (message?.type !== "end-of-call-report") return json({ ignored: true });
  const outputs = Object.values(message.artifact?.structuredOutputs ?? {}) as { result?: { items?: Item[] } }[];
  const items = outputs.flatMap((o) => o.result?.items ?? []);
  const all = await sectionTasks();
  // The extractor may not echo ids; fall back to matching the person's name in the task title.
  for (const it of items) {
    if (it.action !== "create" && !all.some((t) => t.id === it.task_id) && it.person) {
      it.task_id = all.find((t) => t.content.toLowerCase().includes(it.person!.toLowerCase()))?.id;
    }
  }
  const tasks: Task[] = all.map((t) => ({ id: t.id, description: t.description }));
  const { ops, skipped } = apply(items, tasks, today());
  for (const op of ops) await run(op);
  if (skipped.length) console.warn("skipped", JSON.stringify(skipped));
  return json({ applied: ops.length, skipped: skipped.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith("/done")) {
      if (!same(req.headers.get("x-vapi-secret") ?? "", env("WEBHOOK_SECRET"))) return json({ error: "unauthorized" }, 401);
      return await done(req);
    }
    const key = req.headers.get("x-key") ?? url.searchParams.get("k") ?? "";
    // The scheduler has its own key that can only trigger a push.
    if (url.pathname.endsWith("/notify") && (same(key, env("CRON_KEY")) || same(key, env("APP_KEY")))) return await notify(url);
    if (!same(key, env("APP_KEY"))) return json({ error: "unauthorized" }, 401);
    if (url.pathname.endsWith("/start")) return await start();
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
