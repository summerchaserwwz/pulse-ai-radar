import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { signSubscriptionAction } from "../services/radar/src/auth.ts";
import { createBuiltRuntime, TEST_SIGNING_KEY } from "./helpers/worker.mjs";

test("服务端渲染完整 PULSE/AI 产品界面且不残留 starter", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const response = await runtime.fetch("/", { headers: { accept: "text/html" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();

    assert.match(html, /<html[^>]+lang="zh-CN"/i);
    assert.match(html, /<title>今日信号 · PULSE\/AI<\/title>/i);
    assert.doesNotMatch(html, /PULSE\/AI · PULSE\/AI/i);
    for (const label of ["今日", "雷达", "追踪", "速报", "设置"]) {
      assert.match(html, new RegExp(`>${label}<`));
    }
    assert.match(html, /事件详情/);
    assert.match(html, /演示数据/);
    assert.match(html, /历史公开样例/);
    assert.match(html, /搜索事件、公司、人物或关键词/);
    assert.doesNotMatch(
      html,
      /Codex is working|Your site is taking shape|codex-preview|react-loading-skeleton|sites-skeleton/i,
    );
  } finally {
    await runtime.dispose();
  }
});

test("首次无 cookie 保存偏好后身份保持一致并可读回", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const update = await runtime.fetch(
      "/api/preferences",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interests: ["Anthropic", "AI Coding"],
          bookmarks: ["mcp"],
          tracked: ["deepseek-r1"],
          hidden: ["gpt-4o"],
          autoTranslate: true,
          verifiedOnly: true,
          denseMode: false,
          instantAlerts: false,
        }),
      },
    );
    assert.equal(update.status, 200);
    const updateBody = await update.json();
    assert.deepEqual(updateBody.profile.interests, ["Anthropic", "AI Coding"]);
    assert.deepEqual(updateBody.profile.bookmarks, ["mcp"]);
    assert.deepEqual(updateBody.profile.tracked, ["deepseek-r1"]);
    assert.deepEqual(updateBody.profile.hidden, ["gpt-4o"]);
    assert.equal(updateBody.profile.verifiedOnly, true);
    assert.equal(updateBody.profile.denseMode, false);

    const setCookie = update.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^pulse_uid=/);
    assert.match(setCookie, /HttpOnly/i);
    const cookie = setCookie.split(";")[0];
    const read = await runtime.fetch(
      "/api/preferences",
      { headers: { cookie } },
    );
    assert.equal(read.status, 200);
    const readBody = await read.json();
    assert.deepEqual(readBody.profile.interests, ["Anthropic", "AI Coding"]);
    assert.deepEqual(readBody.profile.bookmarks, ["mcp"]);
    assert.deepEqual(readBody.profile.tracked, ["deepseek-r1"]);
    assert.deepEqual(readBody.profile.hidden, ["gpt-4o"]);
  } finally {
    await runtime.dispose();
  }
});

test("身份 Cookie 拒绝裸值与签名篡改且合法会话仍可复用", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const forged = await runtime.fetch("/api/preferences", {
      headers: { cookie: "pulse_uid=anon%3A00000000-0000-4000-8000-000000000000" },
    });
    assert.equal(forged.status, 200);
    assert.match(
      forged.headers.get("set-cookie") ?? "",
      /^pulse_uid=/,
      "裸身份值必须被拒绝并轮换为新的签名 Cookie",
    );

    const update = await runtime.fetch("https://pulse.test/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interests: ["Cookie security regression"] }),
    });
    assert.equal(update.status, 200);
    const setCookie = update.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Secure/i);
    const validCookie = setCookie.split(";")[0];
    assert.match(validCookie, /^pulse_uid=/);

    const valid = await runtime.fetch("/api/preferences", {
      headers: { cookie: validCookie },
    });
    assert.equal(valid.status, 200);
    assert.deepEqual((await valid.json()).profile.interests, ["Cookie security regression"]);

    const signatureStart = validCookie.lastIndexOf(".") + 1;
    assert.ok(signatureStart > "pulse_uid=".length);
    const signatureCharacter = validCookie[signatureStart];
    const tamperedCookie = `${validCookie.slice(0, signatureStart)}${
      signatureCharacter === "a" ? "b" : "a"
    }${validCookie.slice(signatureStart + 1)}`;
    const tampered = await runtime.fetch("/api/preferences", {
      headers: { cookie: tamperedCookie },
    });
    assert.equal(tampered.status, 200);
    assert.deepEqual((await tampered.json()).profile.interests, [
      "基础模型",
      "Agent",
      "AI Coding",
      "开源模型",
    ]);
    assert.match(
      tampered.headers.get("set-cookie") ?? "",
      /^pulse_uid=/,
      "篡改签名后必须建立全新的匿名身份",
    );
  } finally {
    await runtime.dispose();
  }
});

test("订阅接口拒绝无效时区并生成待确认私有 RSS 令牌", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const invalid = await runtime.fetch(
      "/api/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "qa@example.invalid", timezone: "Mars/Olympus" }),
      },
    );
    assert.equal(invalid.status, 400);

    const valid = await runtime.fetch(
      "/api/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "qa@example.invalid",
          timezone: "Asia/Shanghai",
          digestHour: 8,
        }),
      },
    );
    assert.equal(valid.status, 201);
    const body = await valid.json();
    assert.equal(body.subscription.status, "pending");
    assert.match(body.subscription.rssPath, /^\/rss\.xml\?token=[a-f0-9]{64}$/);

    const privateFeed = await runtime.fetch(body.subscription.rssPath);
    assert.equal(privateFeed.status, 401, "邮箱确认前私有 RSS 不得读取");
  } finally {
    await runtime.dispose();
  }
});

test("无需邮箱即可生成可读取的私有 RSS", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const created = await runtime.fetch("/api/rss", { method: "POST" });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.rss.status, "active");
    assert.match(body.rss.rssPath, /^\/rss\.xml\?token=[a-f0-9]{64}$/);

    const feed = await runtime.fetch(body.rss.rssPath);
    assert.equal(feed.status, 200);
    assert.match(feed.headers.get("content-type") ?? "", /^application\/rss\+xml/i);

    const subscription = await runtime.db
      .prepare(`SELECT status, email FROM subscriptions LIMIT 1`)
      .first();
    assert.equal(subscription.status, "rss_only");
    assert.match(subscription.email, /^rss-[a-f0-9]{32}@pulse\.invalid$/);
  } finally {
    await runtime.dispose();
  }
});

test("确认链接建立跨设备会话、轮换 RSS 且同一邮箱不会重复订阅", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const created = await runtime.fetch(
      "/api/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "sync@example.invalid",
          timezone: "Asia/Shanghai",
          digestHour: 8,
        }),
      },
    );
    assert.equal(created.status, 201);

    const subscription = await runtime.db
      .prepare(`SELECT id, user_id, updated_at FROM subscriptions WHERE email = ?`)
      .bind("sync@example.invalid")
      .first();
    assert.ok(subscription);
    const token = await signSubscriptionAction(
      { AUTH_SIGNING_KEY: TEST_SIGNING_KEY },
      {
        subscriptionId: subscription.id,
        action: "confirm",
        revision: subscription.updated_at,
      },
    );

    const confirmed = await runtime.fetch(
      `/api/subscriptions/confirm?token=${encodeURIComponent(token)}`,
      { method: "POST", redirect: "manual" },
    );
    assert.equal(confirmed.status, 303);
    assert.match(confirmed.headers.get("location") ?? "", /subscription=confirmed/);
    const setCookie = confirmed.headers.get("set-cookie") ?? "";
    const userCookie = setCookie.match(/pulse_uid=([^;,]+)/)?.[1];
    const rssCookie = setCookie.match(/pulse_rss=([^;,]+)/)?.[1];
    assert.ok(userCookie, "确认动作应签发用户会话 Cookie");
    assert.ok(rssCookie, "确认动作应签发可用的私有 RSS Cookie");
    const cookie = `pulse_uid=${userCookie}; pulse_rss=${rssCookie}`;

    const profileResponse = await runtime.fetch("/api/preferences", {
      headers: { cookie },
    });
    assert.equal(profileResponse.status, 200);
    const profileBody = await profileResponse.json();
    assert.equal(profileBody.profile.subscriptionEmail, "sync@example.invalid");
    assert.equal(profileBody.profile.subscriptionStatus, "active");
    assert.match(profileBody.profile.rssPath, /^\/rss\.xml\?token=/);

    const authenticatedProfile = await runtime.fetch("/api/preferences", {
      headers: { "oai-authenticated-user-email": "sync@example.invalid" },
    });
    assert.equal(authenticatedProfile.status, 200);
    const authenticatedBody = await authenticatedProfile.json();
    assert.equal(authenticatedBody.profile.subscriptionStatus, "active");
    assert.deepEqual(authenticatedBody.profile.interests, profileBody.profile.interests);

    const privateFeed = await runtime.fetch(profileBody.profile.rssPath);
    assert.equal(privateFeed.status, 200);

    const repeated = await runtime.fetch(
      "/api/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "sync@example.invalid", timezone: "Asia/Shanghai" }),
      },
    );
    assert.equal(repeated.status, 201);
    const count = await runtime.db
      .prepare(`SELECT COUNT(*) AS count FROM subscriptions WHERE email = ?`)
      .bind("sync@example.invalid")
      .first("count");
    assert.equal(count, 1);

    const throttled = await runtime.fetch(
      "/api/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "sync@example.invalid", timezone: "Asia/Shanghai" }),
      },
    );
    assert.equal(throttled.status, 429);
  } finally {
    await runtime.dispose();
  }
});

test("演示 RSS 可被标准 XML 解析器读取且每条事件含原始来源", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const response = await runtime.fetch("/rss.xml?token=preview");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/rss\+xml/i);
    const xml = await response.text();
    const parsed = spawnSync("xmllint", ["--noout", "-"], {
      input: xml,
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    assert.ok(items.length >= 5);
    for (const item of items) {
      assert.match(item, /<guid isPermaLink="false">pulse:/);
      assert.match(item, /<a href="https:\/\//, "每条 RSS 事件都必须含原始来源链接");
      assert.match(item, /历史公开样例/);
    }
  } finally {
    await runtime.dispose();
  }
});
