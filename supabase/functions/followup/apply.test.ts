import assert from "node:assert/strict";
import { apply } from "./apply.ts";

const today = "2026-11-18";
const tasks = [{ id: "1", description: "Flower quote\nAsked: 2026-11-16 · Chases: 1\n[Send on WhatsApp](https://wa.me/?text=old)" }];

Deno.test("complete closes the task", () => {
  assert.deepEqual(apply([{ action: "complete", task_id: "1" }], tasks, today).ops, [{ op: "close", id: "1" }]);
});

Deno.test("reschedule bumps chase count and swaps the draft", () => {
  const { ops } = apply([{ action: "reschedule", task_id: "1", date: "2026-11-20", draft: "Hi Nimal, any news?" }], tasks, today);
  assert.deepEqual(ops, [{
    op: "update",
    id: "1",
    due_date: "2026-11-20",
    description: "Flower quote\nAsked: 2026-11-16 · Chases: 2\n[Send on WhatsApp](https://wa.me/?text=Hi%20Nimal%2C%20any%20news%3F)",
  }]);
});

Deno.test("reschedule without a draft keeps the count and drops the stale link", () => {
  const { ops } = apply([{ action: "reschedule", task_id: "1", date: "2026-11-20" }], tasks, today);
  assert.equal((ops[0] as { description: string }).description, "Flower quote\nAsked: 2026-11-16 · Chases: 1");
});

Deno.test("create builds the task; bad date falls back to +2 days", () => {
  const { ops } = apply([{ action: "create", person: "Kasun", what: "venue contract", date: "Thursday" }], tasks, today);
  assert.deepEqual(ops, [{ op: "create", content: "Chase Kasun: venue contract", due_date: "2026-11-20", description: "Asked: 2026-11-18 · Chases: 0" }]);
});

Deno.test("unknown task id and incomplete create are skipped, not applied", () => {
  const { ops, skipped } = apply([{ action: "complete", task_id: "999" }, { action: "create", person: "Kasun" }], tasks, today);
  assert.equal(ops.length, 0);
  assert.equal(skipped.length, 2);
});

Deno.test("create carries a known project label and drops an unknown one", () => {
  const mk = (project: string) => apply([{ action: "create", person: "Kasun", what: "venue contract", project }], tasks, today).ops[0];
  assert.deepEqual((mk("ceylon-wedding") as { labels?: string[] }).labels, ["ceylon-wedding"]);
  assert.equal("labels" in mk("made-up"), false);
});
