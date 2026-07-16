import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

export const TEST_SIGNING_KEY = "pulse-test-signing-key-32-characters-minimum";

function splitDrizzleMigration(sql) {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function createBuiltRuntime() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const serverRoot = fileURLToPath(new URL("../../dist/server/", import.meta.url));
  const discoveredModules = (await readdir(serverRoot, { recursive: true }))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `dist/server/${name}`)
    .filter((name) => name !== "dist/server/index.js")
    .sort();
  const siteModules = ["dist/server/index.js", ...discoveredModules].map((path) => ({
    type: "ESModule",
    path,
  }));
  const miniflare = new Miniflare({
    workers: [
      {
        name: "pulse-site",
        modules: siteModules,
        modulesRoot: projectRoot,
        compatibilityDate: "2026-05-15",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { AUTH_SIGNING_KEY: TEST_SIGNING_KEY },
        d1Databases: ["DB"],
        r2Buckets: ["RAW_BUCKET"],
        serviceBindings: { ASSETS: "pulse-assets" },
      },
      {
        name: "pulse-assets",
        modules: true,
        script: `export default { async fetch() { return new Response("Not found", { status: 404 }); } };`,
        compatibilityDate: "2026-05-15",
      },
    ],
  });
  try {
    const db = await miniflare.getD1Database("DB", "pulse-site");
    const migrationsRoot = new URL("../../drizzle/", import.meta.url);
    const migrationFiles = (await readdir(migrationsRoot))
      .filter((name) => name.endsWith(".sql"))
    .sort();
    for (const name of migrationFiles) {
      const sql = await readFile(new URL(name, migrationsRoot), "utf8");
      for (const statement of splitDrizzleMigration(sql)) {
        await db.prepare(statement).run();
      }
    }
    return {
      db,
      fetch(path, init) {
        const url = /^https?:\/\//.test(path) ? path : `http://localhost${path}`;
        return miniflare.dispatchFetch(url, init);
      },
      dispose() {
        return miniflare.dispose();
      },
    };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}
