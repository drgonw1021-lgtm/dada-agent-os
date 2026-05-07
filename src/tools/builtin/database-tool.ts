import { readFile, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface DatabaseInput {
  action: "query" | "execute" | "list" | "tables" | "schema" | "backup";
  sql?: string;
  connection?: string;
  dbname?: string;
}

export interface DatabaseOutput {
  success: boolean;
  result?: unknown;
  error?: string;
}

const SAFE_DBNAME = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/;

// ── sql.js singleton ─────────────────────────────────────────────────────────

type SqlJsModule = Awaited<ReturnType<typeof import("sql.js").default>>;

let _sqlPromise: Promise<SqlJsModule> | null = null;
let SQL: SqlJsModule | null = null;

async function getSqlJs(): Promise<SqlJsModule> {
  if (SQL) return SQL;
  if (!_sqlPromise) {
    _sqlPromise = (async () => {
      const initSqlJs = (await import("sql.js")).default;
      SQL = await initSqlJs();
      return SQL;
    })();
  }
  return _sqlPromise;
}

// ── SQLite via sql.js (zero system deps) ──────────────────────────────────────

async function sqliteOp(
  action: string,
  sql: string | undefined,
  dbPath: string,
): Promise<DatabaseOutput> {
  const Sql = await getSqlJs();
  let buffer: Buffer | null = null;
  try {
    buffer = await readFile(dbPath);
  } catch {
    // DB doesn't exist yet — will be created
  }

  const db = new Sql.Database(buffer);
  try {
    switch (action) {
      case "query": {
        const results = db.exec(sql!);
        const result = resultsToObjects(results);
        return { success: true, result };
      }
      case "execute": {
        db.run(sql!);
        const data = db.export();
        await writeFile(dbPath, Buffer.from(data));
        return { success: true, result: "Statement executed" };
      }
      case "tables": {
        const results = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        const tables = results.flatMap(r => r.values.map(v => v[0]));
        return { success: true, result: tables };
      }
      case "schema": {
        const results = db.exec("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name");
        const schemas = results.flatMap(r => r.values.map(v => v[0]));
        return { success: true, result: schemas.join(";\n") };
      }
      case "backup": {
        const data = db.export();
        const timestamp = new Date().toISOString().replace(/:/g, "-");
        const backupPath = dbPath.replace(/\.(db|sqlite)$/, "") + `_backup_${timestamp}.db`;
        await writeFile(backupPath, Buffer.from(data));
        return { success: true, result: `Backup saved to ${backupPath}` };
      }
      default:
        return { success: false, error: `Unknown SQLite action: ${action}` };
    }
  } finally {
    db.close();
  }
}

function resultsToObjects(results: { columns: string[]; values: unknown[][] }[]): Record<string, unknown>[] {
  if (!results || results.length === 0) return [];
  const rows: Record<string, unknown>[] = [];
  for (const result of results) {
    for (const row of result.values) {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => { obj[col] = row[i]; });
      rows.push(obj);
    }
  }
  return rows;
}

// ── SQLite file discovery ────────────────────────────────────────────────────

async function listDatabases(): Promise<DatabaseOutput> {
  try {
    const files = await readdir(".");
    const dbs = files.filter(f => f.endsWith(".db") || f.endsWith(".sqlite") || f.endsWith(".sqlite3"));
    return { success: true, result: dbs };
  } catch {
    return { success: false, error: "No SQLite databases found in current directory" };
  }
}

// ── PostgreSQL / MySQL (CLI-based, server DBs) ────────────────────────────────

function remoteSQL(type: string, action: string, sql: string | undefined, dbname: string | undefined): Promise<DatabaseOutput> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[] = [];
    let useStdin = false;

    if (type === "postgres" || type === "postgresql") {
      const user = process.env.POSTGRES_USER || "postgres";
      const host = process.env.POSTGRES_HOST || "localhost";
      const db = dbname || user;
      cmd = "psql";
      args = ["-U", user, "-h", host, "-d", db];
      if (action === "query" || action === "execute") {
        args.push("-c", sql!);
      } else if (action === "tables") {
        args.push("-c", "\\dt");
      } else if (action === "schema") {
        args.push("-c", "\\d");
      } else if (action === "backup") {
        cmd = "pg_dump";
        args = ["-U", user, db];
      }
    } else if (type === "mysql" || type === "mariadb") {
      const user = process.env.MYSQL_USER || "root";
      const host = process.env.MYSQL_HOST || "localhost";
      const db = dbname || "mysql";
      const pass = process.env.MYSQL_PASSWORD;
      cmd = "mysql";
      args = ["-u", user, "-h", host, db];
      if (pass) args.unshift(`-p${pass}`);
      if (action === "query" || action === "execute") {
        args.push("-e", sql!);
      } else if (action === "tables") {
        args.push("-e", "SHOW TABLES");
      } else if (action === "schema") {
        args.push("-e", `SHOW CREATE DATABASE ${db}`);
      } else if (action === "backup") {
        cmd = "mysqldump";
        args = ["-u", user, db];
        if (pass) args.unshift(`-p${pass}`);
      }
    } else {
      resolve({ success: false, error: `Unsupported database type: ${type}` });
      return;
    }

    const child = spawn(cmd, args, { shell: false, timeout: 30000, stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    if (useStdin && sql) {
      child.stdin!.write(sql + "\n");
      child.stdin!.end();
    }

    child.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, result: stdout });
      else resolve({ success: false, error: stderr || stdout || `exited ${code}` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

// ── Assert helpers ───────────────────────────────────────────────────────────

function assertSafeDbName(name: string, label: string): void {
  if (!SAFE_DBNAME.test(name)) {
    throw new Error(`Invalid ${label}: "${name}"`);
  }
}

// ── Main tool ────────────────────────────────────────────────────────────────

export function createDatabaseTool(): ToolDefinition<DatabaseInput, DatabaseOutput> {
  return {
    id: "database",
    description: "Database tool: execute SQL, query, list tables, backup. SQLite via built-in WASM engine, PostgreSQL/MySQL via native CLI",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["query", "execute", "list", "tables", "schema", "backup"], description: "Database action to perform" },
        sql: { type: "string" as const, description: "SQL query or statement to execute" },
        connection: { type: "string" as const, enum: ["sqlite", "postgres", "postgresql", "mysql", "mariadb"], description: "Database type (default: sqlite)" },
        dbname: { type: "string" as const, description: "Database name or file path" }
      },
      required: ["action"]
    },
    async execute(input: DatabaseInput, _context: ToolContext): Promise<DatabaseOutput> {
      const conn = (input.connection || "sqlite").toLowerCase();

      try {
        // SQLite: use built-in sql.js WASM engine
        if (conn === "sqlite") {
          const dbPath = input.dbname || "database.db";
          assertSafeDbName(dbPath, "dbname");

          if (input.action === "list") {
            return listDatabases();
          }
          if (input.action === "query" || input.action === "execute") {
            if (!input.sql) return { success: false, error: "SQL required" };
          }
          return sqliteOp(input.action, input.sql, dbPath);
        }

        // PostgreSQL / MySQL: use native CLI (server DBs)
        return remoteSQL(conn, input.action, input.sql, input.dbname);
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

export default createDatabaseTool;

// ── Capability check (SQLite always available via sql.js) ─────────────────────

export async function checkDatabaseCapability(): Promise<{ available: boolean; reason?: string }> {
  try {
    await getSqlJs();
    return { available: true };
  } catch {
    return { available: false, reason: "sql.js WASM engine failed to initialize" };
  }
}
