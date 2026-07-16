import assert from "node:assert/strict";
import test from "node:test";
import { createD1 } from "../../../tests/helpers/d1.mjs";
import {
  claimEnrichmentAttempt,
  claimDelivery,
  deliveryKey,
  finishDelivery,
  getEvent,
  listRadarEventDetails,
  listRadarEvents,
  markSourceItem,
  recordEnrichmentFailure,
  saveEvent,
  upsertSourceItem,
} from "../src/repository.ts";
import {
  processItemEnrichment,
  QueueRetryError,
  queueRetryDelay,
} from "../src/pipeline.ts";

function insertUserAndSubscription(database) {
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO users
        (id, email, auto_translate, verified_only, dense_mode, instant_alerts, created_at, updated_at)
       VALUES (?, ?, 1, 0, 1, 1, ?, ?)`,
    )
    .run("user:1", "qa@example.invalid", now, now);
  database
    .prepare(
      `INSERT INTO subscriptions
        (id, user_id, email, timezone, digest_hour, status, rss_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'Asia/Shanghai', 8, 'active', ?, ?, ?)`,
    )
    .run("sub:1", "user:1", "qa@example.invalid", "rss-hash", now, now);
  return {
    id: "sub:1",
    user_id: "user:1",
    email: "qa@example.invalid",
    timezone: "Asia/Shanghai",
    digest_hour: 8,
    status: "active",
    updated_at: now,
  };
}

function insertSource(database, id, official = true) {
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO sources
        (id, name, kind, feed_url, homepage_url, region, language, authority, official, enabled, created_at, updated_at)
       VALUES (?, ?, 'rss', ?, ?, '全球', 'en', ?, ?, 1, ?, ?)`,
    )
    .run(
      id,
      `Source ${id}`,
      `https://${id}.example/feed.xml`,
      `https://${id}.example/`,
      official ? 95 : 80,
      official ? 1 : 0,
      now,
      now,
    );
}

function storedItem(id, sourceId, url) {
  return {
    id,
    sourceId,
    externalId: id,
    canonicalUrl: url,
    title: `Original ${id}`,
    summary: `Original summary ${id}`,
    publishedAt: Date.now(),
    sourceName: `Source ${sourceId}`,
    sourceHomepage: `https://${sourceId}.example/`,
    sourceAuthority: 95,
    sourceOfficial: true,
    language: "en",
    contentHash: `hash-${id}`,
  };
}

function insertSourceItem(database, item) {
  database
    .prepare(
      `INSERT INTO source_items
        (id, source_id, external_id, canonical_url, title_original, summary_original,
         language, content_hash, processing_status, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      item.id,
      item.sourceId,
      item.externalId,
      item.canonicalUrl,
      item.title,
      item.summary,
      item.language,
      item.contentHash,
      item.publishedAt,
      Date.now(),
    );
}

const enriched = {
  titleZh: "可信中文标题",
  summaryZh: "这是经过结构化校验的可信中文摘要，包含事件的关键事实与边界。",
  whyItMatters: "这会影响模型选型和 AI 工程决策。",
  entities: ["Example"],
  topics: ["基础模型"],
  impact: "high",
  translationState: "translated",
  promptInjectionDetected: false,
};

test("投递 claim 对重复、失败重试和超时 lease 保持幂等", async () => {
  const { d1, database, close } = await createD1();
  try {
    const subscription = insertUserAndSubscription(database);
    const env = { DB: d1 };
    const first = await claimDelivery(env, subscription, "email", "2026-07-15");
    assert.equal(first, deliveryKey("user:1", "2026-07-15", "email"));
    assert.equal(await claimDelivery(env, subscription, "email", "2026-07-15"), null);

    await finishDelivery(env, first, { status: "failed", errorCode: "network" });
    assert.equal(await claimDelivery(env, subscription, "email", "2026-07-15"), first);
    await finishDelivery(env, first, { status: "sent", providerId: "email_123" });
    assert.equal(await claimDelivery(env, subscription, "email", "2026-07-15"), null);

    const leased = await claimDelivery(env, subscription, "email", "2026-07-16");
    database.prepare(`UPDATE deliveries SET updated_at = 0 WHERE id = ?`).run(leased);
    assert.equal(await claimDelivery(env, subscription, "email", "2026-07-16"), leased);
  } finally {
    close();
  }
});

test("事件与 evidence 原子写入，pending / 隔离输入不能改变公开聚合", async () => {
  const { d1, database, close } = await createD1();
  try {
    insertSource(database, "official-a");
    insertSource(database, "official-b");
    const itemA = storedItem("item-a", "official-a", "https://official-a.example/event");
    const itemB = storedItem("item-b", "official-b", "https://official-b.example/event");
    insertSourceItem(database, itemA);
    insertSourceItem(database, itemB);
    const env = { DB: d1 };

    await saveEvent(env, {
      id: "event:a",
      slug: "event-a",
      fingerprint: "example|release",
      sourceItem: itemA,
      enriched,
      status: "已确认",
      confidence: 90,
      trendScore: 88,
      region: "全球",
      quarantined: false,
    });

    const malicious = {
      ...enriched,
      titleZh: "恶意覆盖标题",
      summaryZh: "恶意覆盖摘要不应进入已经公开的可信事件正文。",
      whyItMatters: "恶意覆盖理由不应生效。",
      translationState: "pending",
      promptInjectionDetected: true,
    };
    await assert.rejects(
      saveEvent(env, {
        id: "event:a",
        slug: "event-a",
        fingerprint: "example|release",
        sourceItem: itemB,
        enriched: malicious,
        status: "已确认",
        confidence: 100,
        trendScore: 100,
        region: "全球",
        quarantined: true,
      }),
      /invalid-evidence-state/,
    );
    const row = database
      .prepare(
        `SELECT title_zh, summary_zh, why_it_matters, status, confidence,
                trend_score, quarantined FROM events WHERE id = ?`,
      )
      .get("event:a");
    assert.equal(row.title_zh, enriched.titleZh);
    assert.equal(row.summary_zh, enriched.summaryZh);
    assert.equal(row.why_it_matters, enriched.whyItMatters);
    assert.equal(row.status, "已确认");
    assert.equal(row.confidence, 90);
    assert.equal(row.trend_score, 88);
    assert.equal(row.quarantined, 0);
    assert.equal(
      database.prepare(`SELECT COUNT(*) AS count FROM event_items WHERE event_id = 'event:a'`).get()
        .count,
      1,
    );

    itemB.publishedAt = itemA.publishedAt - 7 * 24 * 60 * 60 * 1000;
    await saveEvent(env, {
      id: "event:a",
      slug: "event-a",
      fingerprint: "example|release",
      sourceItem: itemB,
      enriched: {
        ...enriched,
        titleZh: "低置信输入标题",
        summaryZh: "这是一条结构有效但证据不足的低置信输入，不得改变已公开事件。",
        whyItMatters: "隔离输入不参与公开聚合。",
        topics: ["隔离主题"],
      },
      status: "待核实",
      confidence: 100,
      trendScore: 100,
      region: "全球",
      quarantined: true,
    });
    const afterQuarantinedMerge = database
      .prepare(
        `SELECT title_zh, summary_zh, why_it_matters, status, confidence,
                trend_score, quarantined, published_at
         FROM events WHERE id = ?`,
      )
      .get("event:a");
    assert.equal(afterQuarantinedMerge.title_zh, enriched.titleZh);
    assert.equal(afterQuarantinedMerge.summary_zh, enriched.summaryZh);
    assert.equal(afterQuarantinedMerge.why_it_matters, enriched.whyItMatters);
    assert.equal(afterQuarantinedMerge.status, "已确认");
    assert.equal(afterQuarantinedMerge.confidence, 90);
    assert.equal(afterQuarantinedMerge.trend_score, 88);
    assert.equal(afterQuarantinedMerge.quarantined, 0);
    assert.equal(afterQuarantinedMerge.published_at, itemA.publishedAt);
    assert.equal(
      database.prepare(`SELECT processing_status FROM source_items WHERE id = ?`).get(itemB.id)
        .processing_status,
      "quarantined",
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) AS count FROM event_items WHERE event_id = 'event:a'`).get()
        .count,
      2,
      "隔离关联可供内部审计，但不得成为公开 evidence",
    );
    const publicDetail = await getEvent(env, "event:a");
    assert.equal(publicDetail.event.status, "已确认");
    assert.equal(publicDetail.event.confidence, 90);
    assert.equal(publicDetail.event.trend_score, 88);
    assert.equal(publicDetail.evidence.length, 1);
    assert.equal(publicDetail.evidence[0].canonical_url, itemA.canonicalUrl);
    assert.doesNotMatch(publicDetail.event.topic_text, /隔离主题/);

    await assert.rejects(
      saveEvent(env, {
        id: "event:orphan",
        slug: "event-orphan",
        fingerprint: "different|fingerprint",
        sourceItem: itemA,
        enriched,
        status: "已确认",
        confidence: 90,
        trendScore: 70,
        region: "全球",
        quarantined: false,
      }),
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) AS count FROM events WHERE id = 'event:orphan'`).get().count,
      0,
      "evidence 唯一约束失败时 event insert 必须回滚",
    );
  } finally {
    close();
  }
});

test("公开查询只接受 enriched 证据并衰减旧趋势", async () => {
  const { d1, database, close } = await createD1();
  try {
    insertSource(database, "official-a");
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    database
      .prepare(
        `INSERT INTO events
          (id, slug, fingerprint, title_zh, title_original, summary_zh, why_it_matters,
           status, confidence, trend_score, region, quarantined, published_at, created_at, updated_at)
         VALUES ('event:orphan', 'orphan', 'orphan', '标题', 'Title', '摘要', '重要',
                 '已确认', 90, 90, '全球', 0, ?, ?, ?)`,
      )
      .run(old, old, old);
    assert.deepEqual(await listRadarEvents({ DB: d1 }, 10), []);

    const item = storedItem("item-evidence", "official-a", "https://official-a.example/evidence");
    item.publishedAt = old;
    insertSourceItem(database, item);
    database
      .prepare(
        `INSERT INTO event_items (event_id, source_item_id, support_kind, created_at)
         VALUES ('event:orphan', 'item-evidence', 'supports', ?)`,
      )
      .run(Date.now());
    assert.deepEqual(await listRadarEvents({ DB: d1 }, 10), []);
    assert.equal(await getEvent({ DB: d1 }, "event:orphan"), null);

    await markSourceItem({ DB: d1 }, item.id, "enriched");
    const events = await listRadarEvents({ DB: d1 }, 10);
    assert.equal(events.length, 1);
    assert.equal(events[0].trend_score, 60, "10 天旧事件应按每天 3 分衰减");
    const detail = await getEvent({ DB: d1 }, "event:orphan");
    assert.equal(detail.evidence.length, 1);
    assert.equal(detail.evidence[0].canonical_url, "https://official-a.example/evidence");
  } finally {
    close();
  }
});

test("AI enrichment 使用有限 attempts、指数退避并最终隔离", async () => {
  const { d1, database, close } = await createD1();
  try {
    insertSource(database, "official-a");
    const definition = {
      id: "official-a",
      name: "Official A",
      kind: "rss",
      feedUrl: "https://official-a.example/feed.xml",
      homepageUrl: "https://official-a.example/",
      region: "全球",
      language: "en",
      authority: 95,
      official: true,
      snapshotAllowed: false,
      includeTerms: [],
    };
    const feedItem = {
      externalId: "retry-item",
      canonicalUrl: "https://official-a.example/retry",
      title: "Model update",
      summary: "Official source summary",
      publishedAt: Date.now(),
    };
    const created = await upsertSourceItem({ DB: d1 }, definition, feedItem, null);
    assert.equal(created.needsProcessing, true);
    let now = Date.now();
    const first = await claimEnrichmentAttempt({ DB: d1 }, created.id, now);
    assert.deepEqual(first, { state: "claimed", attempts: 1 });
    const firstFailure = await recordEnrichmentFailure(
      { DB: d1 },
      created.id,
      1,
      "provider-timeout",
      now,
    );
    assert.equal(firstFailure.delaySeconds, 60);
    assert.equal(firstFailure.terminal, false);
    const immediate = await upsertSourceItem({ DB: d1 }, definition, feedItem, null);
    assert.equal(immediate.needsProcessing, false, "退避期内 cron 不应重复烧 AI");
    assert.equal((await claimEnrichmentAttempt({ DB: d1 }, created.id, now + 1_000)).state, "deferred");

    now = firstFailure.nextRetryAt;
    const second = await claimEnrichmentAttempt({ DB: d1 }, created.id, now);
    assert.deepEqual(second, { state: "claimed", attempts: 2 });
    const secondFailure = await recordEnrichmentFailure(
      { DB: d1 },
      created.id,
      2,
      "invalid-output",
      now,
    );
    assert.equal(secondFailure.delaySeconds, 300);

    now = secondFailure.nextRetryAt;
    const third = await claimEnrichmentAttempt({ DB: d1 }, created.id, now);
    assert.deepEqual(third, { state: "claimed", attempts: 3 });
    const thirdFailure = await recordEnrichmentFailure(
      { DB: d1 },
      created.id,
      3,
      "invalid-output",
      now,
    );
    assert.equal(thirdFailure.delaySeconds, 1_800);

    now = thirdFailure.nextRetryAt;
    const fourth = await claimEnrichmentAttempt({ DB: d1 }, created.id, now);
    assert.deepEqual(fourth, { state: "claimed", attempts: 4 });
    const terminalFailure = await recordEnrichmentFailure(
      { DB: d1 },
      created.id,
      4,
      "invalid-output",
      now,
    );
    assert.equal(terminalFailure.terminal, true);
    const terminal = await upsertSourceItem({ DB: d1 }, definition, feedItem, null);
    assert.equal(terminal.needsProcessing, false);
    assert.deepEqual(
      { ...database
        .prepare(
          `SELECT processing_status, enrichment_attempts, next_retry_at, last_error_code
           FROM source_items WHERE id = ?`,
        )
        .get(created.id) },
      {
        processing_status: "quarantined",
        enrichment_attempts: 4,
        next_retry_at: null,
        last_error_code: "invalid-output",
      },
    );

    const changed = await upsertSourceItem(
      { DB: d1 },
      definition,
      { ...feedItem, summary: "Updated official source summary" },
      null,
    );
    assert.equal(changed.needsProcessing, true);
    assert.deepEqual(
      { ...database
        .prepare(
          `SELECT processing_status, enrichment_attempts, next_retry_at
           FROM source_items WHERE id = ?`,
        )
        .get(created.id) },
      { processing_status: "pending", enrichment_attempts: 0, next_retry_at: null },
    );
  } finally {
    close();
  }
});

test("AI provider 瞬时异常走 Queue 指数退避，第四次失败后 ack 隔离", async () => {
  const { d1, database, close } = await createD1();
  try {
    insertSource(database, "official-a");
    const item = storedItem(
      "item-provider-retry",
      "official-a",
      "https://official-a.example/provider-retry",
    );
    insertSourceItem(database, item);
    const env = {
      DB: d1,
      AI: {
        async run() {
          throw new Error("temporary provider outage");
        },
      },
      EVENT_CLUSTER_QUEUE: {
        async send() {
          throw new Error("不应在 enrichment 失败时投递 cluster");
        },
      },
    };

    for (const [attempt, expectedDelay] of [
      [1, 60],
      [2, 300],
      [3, 1_800],
    ]) {
      let retryError;
      try {
        await processItemEnrichment(env, item.id);
      } catch (error) {
        retryError = error;
      }
      assert.ok(retryError instanceof QueueRetryError);
      assert.equal(queueRetryDelay(retryError), expectedDelay);
      const row = database
        .prepare(
          `SELECT processing_status, enrichment_attempts, next_retry_at
           FROM source_items WHERE id = ?`,
        )
        .get(item.id);
      assert.equal(row.processing_status, "failed");
      assert.equal(row.enrichment_attempts, attempt);
      assert.ok(row.next_retry_at > Date.now());
      database.prepare(`UPDATE source_items SET next_retry_at = 0 WHERE id = ?`).run(item.id);
    }

    const terminal = await processItemEnrichment(env, item.id);
    assert.deepEqual(terminal, { queued: false, quarantined: true, attempts: 4 });
    assert.deepEqual(
      { ...database
        .prepare(
          `SELECT processing_status, enrichment_attempts, next_retry_at
           FROM source_items WHERE id = ?`,
        )
        .get(item.id) },
      { processing_status: "quarantined", enrichment_attempts: 4, next_retry_at: null },
    );
  } finally {
    close();
  }
});

test("主题按 NFKC、空白和大小写去重，冲突不回滚事件事务", async () => {
  const { d1, database, close } = await createD1();
  try {
    insertSource(database, "official-a");
    const item = storedItem("item-topic", "official-a", "https://official-a.example/topic");
    insertSourceItem(database, item);
    await saveEvent({ DB: d1 }, {
      id: "event:topic",
      slug: "event-topic",
      fingerprint: "topic-normalization",
      sourceItem: item,
      enriched: {
        ...enriched,
        topics: ["AI Coding", "ai coding", "  AI   Coding  ", "ＡＩ Coding"],
      },
      status: "已确认",
      confidence: 90,
      trendScore: 80,
      region: "全球",
      quarantined: false,
    });
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM topics`).get().count, 1);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM event_topics`).get().count, 1);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM events`).get().count, 1);
  } finally {
    close();
  }
});

test("日报/公开雷达批量读取 evidence，不按事件产生 N+1 查询", async () => {
  const { d1, database, close } = await createD1();
  try {
    insertSource(database, "official-a");
    for (let index = 0; index < 3; index += 1) {
      const item = storedItem(
        `item-batch-${index}`,
        "official-a",
        `https://official-a.example/batch/${index}`,
      );
      insertSourceItem(database, item);
      await saveEvent({ DB: d1 }, {
        id: `event:batch:${index}`,
        slug: `event-batch-${index}`,
        fingerprint: `batch-${index}`,
        sourceItem: item,
        enriched,
        status: "已确认",
        confidence: 90,
        trendScore: 80 - index,
        region: "全球",
        quarantined: false,
      });
    }
    let prepareCount = 0;
    const countedD1 = {
      prepare(query) {
        prepareCount += 1;
        return d1.prepare(query);
      },
    };
    const details = await listRadarEventDetails({ DB: countedD1 }, 10);
    assert.equal(details.length, 3);
    assert.ok(details.every((detail) => detail.evidence.length === 1));
    assert.equal(prepareCount, 2, "事件列表与全部 evidence 应分别只执行一次查询");
  } finally {
    close();
  }
});
