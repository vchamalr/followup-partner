// Turns what was said on the call into Todoist operations. Pure: no network.

export type Item = {
  action: "complete" | "reschedule" | "create";
  task_id?: string;
  person?: string;
  what?: string;
  date?: string; // YYYY-MM-DD, next chase date
  draft?: string; // WhatsApp message to send
};

export type Task = { id: string; description: string };

export type Op =
  | { op: "close"; id: string }
  | { op: "update"; id: string; due_date: string; description: string }
  | { op: "create"; content: string; due_date: string; description: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function plusDays(today: string, n: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const waLine = (draft: string) =>
  `[Send on WhatsApp](https://wa.me/?text=${encodeURIComponent(draft)})`;

// Items come from an LLM, so every field is checked before use.
export function apply(
  items: Item[],
  tasks: Task[],
  today: string,
): { ops: Op[]; skipped: Item[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ops: Op[] = [];
  const skipped: Item[] = [];

  for (const it of items) {
    // ponytail: a missing or malformed date defaults to 2 days out; ask on the call if this bites.
    const due = it.date && DATE.test(it.date) ? it.date : plusDays(today, 2);
    const task = it.task_id ? byId.get(it.task_id) : undefined;

    if (it.action === "create" && it.person && it.what) {
      const lines = [`Asked: ${today} · Chases: 0`];
      if (it.draft) lines.push(waLine(it.draft));
      ops.push({
        op: "create",
        content: `Chase ${it.person}: ${it.what}`,
        due_date: due,
        description: lines.join("\n"),
      });
    } else if (it.action === "complete" && task) {
      ops.push({ op: "close", id: task.id });
    } else if (it.action === "reschedule" && task) {
      // Keep the context lines, bump the chase count, swap in the new draft.
      const kept = task.description
        .split("\n")
        .filter((l) => !l.startsWith("[Send on WhatsApp]"))
        .map((l) =>
          it.draft ? l.replace(/Chases: (\d+)/, (_, n) => `Chases: ${+n + 1}`) : l
        );
      if (it.draft) kept.push(waLine(it.draft));
      ops.push({ op: "update", id: task.id, due_date: due, description: kept.join("\n") });
    } else {
      skipped.push(it);
    }
  }
  return { ops, skipped };
}
