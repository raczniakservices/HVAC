const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function resolveDbPath() {
  // Load env if present (dev convenience)
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    // eslint-disable-next-line global-require
    require("dotenv").config({ path: envPath });
  }

  const configured = process.env.DATABASE_PATH
    ? String(process.env.DATABASE_PATH)
    : "./data/calls.sqlite";

  // Interpret relative paths as relative to hvac-demo-landing/
  return path.isAbsolute(configured)
    ? configured
    : path.join(__dirname, "..", configured);
}

function migrate() {
  const dbPath = resolveDbPath();
  ensureDir(path.dirname(dbPath));

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 3000");

  // Track applied migrations so ALTER TABLE migrations don't rerun every time.
  db.exec(`
    CREATE TABLE IF NOT EXISTS SchemaMigration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      appliedAt TEXT NOT NULL
    );
  `);

  const migrationsDir = path.join(__dirname, "..", "db", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort();

  db.exec("BEGIN");
  try {
    for (const file of files) {
      const already = db
        .prepare("SELECT 1 FROM SchemaMigration WHERE name = ?")
        .get(file);
      if (already) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      db.exec(sql);
      db.prepare(
        "INSERT INTO SchemaMigration (name, appliedAt) VALUES (?, ?)"
      ).run(file, new Date().toISOString());
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }

  // eslint-disable-next-line no-console
  console.log(`✅ DB migrated: ${dbPath}`);
}

migrate();


