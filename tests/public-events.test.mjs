import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltRuntime } from "./helpers/worker.mjs";

test("公开事件页服务端渲染中文解读、证据、canonical 与结构化数据", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const response = await runtime.fetch("/events/deepseek-r1", {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /DeepSeek-R1 发布/);
    assert.match(html, /历史公开样例/);
    assert.match(html, /为什么重要/);
    assert.match(html, /来源证据/);
    assert.match(html, /https:\/\/github\.com\/deepseek-ai\/DeepSeek-R1/);
    assert.match(html, /rel="canonical"[^>]+events\/deepseek-r1/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /NewsArticle/);
    assert.match(html, /分享事件/);
  } finally {
    await runtime.dispose();
  }
});

test("未知或不可公开的事件 slug 返回 404", async () => {
  const runtime = await createBuiltRuntime();
  try {
    const response = await runtime.fetch("/events/not-a-public-signal", {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 404);
  } finally {
    await runtime.dispose();
  }
});
