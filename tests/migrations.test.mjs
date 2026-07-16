import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createD1 } from "./helpers/d1.mjs";

test("D1 migrations 可顺序应用、外键完整且无破坏性语句", async () => {
  const root = new URL("../drizzle/", import.meta.url);
  const names = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(names.length >= 3);
  for (const name of names) {
    const sql = await readFile(new URL(name, root), "utf8");
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, `${name} 不得 DROP TABLE`);
    assert.doesNotMatch(
      sql,
      /(?:^|;)\s*DELETE\s+FROM\s+[^;]+(?:;|$)/i,
      `${name} 不得包含无条件 DELETE`,
    );
  }

  const { database, close } = await createD1();
  try {
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    assert.deepEqual(violations, []);
    const tables = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((row) => row.name);
    for (const table of [
      "sources",
      "source_items",
      "events",
      "event_items",
      "users",
      "interests",
      "feedback",
      "subscriptions",
      "subscription_rate_limits",
      "deliveries",
      "pipeline_runs",
    ]) {
      assert.ok(tables.includes(table), `缺少 ${table}`);
    }
    const subscriptionIndexes = database
      .prepare(`PRAGMA index_list('subscriptions')`)
      .all()
      .map((row) => row.name);
    assert.ok(
      subscriptionIndexes.includes("subscriptions_email_uq"),
      "同一规范化邮箱必须只能拥有一条订阅",
    );
  } finally {
    close();
  }
});
