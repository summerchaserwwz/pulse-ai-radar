import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";

function normalizeValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

class PreparedStatement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new PreparedStatement(
      this.database,
      this.query,
      values.map(normalizeValue),
    );
  }

  async first(column) {
    const row = this.database.prepare(this.query).get(...this.values);
    if (!row) return null;
    return typeof column === "string" ? row[column] ?? null : row;
  }

  async all() {
    const rows = this.database.prepare(this.query).all(...this.values);
    return { success: true, meta: {}, results: rows };
  }

  async run() {
    const result = this.database.prepare(this.query).run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
      results: [],
    };
  }

  async raw() {
    const statement = this.database.prepare(this.query);
    const columns = statement.columns().map((column) => column.name);
    return statement
      .all(...this.values)
      .map((row) => columns.map((column) => row[column]));
  }
}

export async function createD1() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationsRoot = new URL("../../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationsRoot))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrationFiles) {
    database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
  }

  const d1 = {
    prepare(query) {
      return new PreparedStatement(database, query);
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    d1,
    database,
    close() {
      database.close();
    },
  };
}
