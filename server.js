const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");

// Load .env if present
try {
  // eslint-disable-next-line global-require
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch {
  // ignore
}

const PORT = Number(process.env.PORT || 4173);
const DEMO_KEY = process.env.DEMO_KEY ? String(process.env.DEMO_KEY) : "";
const DATABASE_PATH = process.env.DATABASE_PATH
  ? String(process.env.DATABASE_PATH)
  : "./data/calls.sqlite";

const resolvedDbPath = path.isAbsolute(DATABASE_PATH)
  ? DATABASE_PATH
  : path.join(__dirname, DATABASE_PATH);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function migrateDb(db) {
  const migrationsDir = path.join(__dirname, "db", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort();

  // Track applied migrations so ALTER TABLE migrations don't rerun every time.
  db.exec(`
    CREATE TABLE IF NOT EXISTS SchemaMigration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      appliedAt TEXT NOT NULL
    );
  `);

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
  }
}

function openDb() {
  ensureDir(path.dirname(resolvedDbPath));
  const db = new Database(resolvedDbPath);
  // WAL + NORMAL sync keeps demo writes snappy while staying safe enough for this use-case.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 3000");
  migrateDb(db);
  return db;
}

const db = openDb();

function isValidCallerNumber(raw) {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (s.length < 7 || s.length > 20) return false;
  return /^\+?\d+$/.test(s);
}

function normalizeCallerNumber(raw) {
  return String(raw || "").trim();
}

function isValidStatus(s) {
  return s === "missed" || s === "answered";
}

function isAuthed(req) {
  if (!DEMO_KEY) return false;
  const q = req.query?.key ? String(req.query.key) : "";
  const h = req.headers["x-demo-key"] ? String(req.headers["x-demo-key"]) : "";
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)demo_key=([^;]+)/);
  const c = match ? decodeURIComponent(match[1]) : "";
  return q === DEMO_KEY || h === DEMO_KEY || c === DEMO_KEY;
}

function requireDemoAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({
    error: "Unauthorized",
    message:
      "Demo access requires DEMO_KEY. Provide ?key=... or header x-demo-key.",
  });
}

function guardedPage(req, res, fileName) {
  if (!DEMO_KEY) {
    return res
      .status(503)
      .type("html")
      .send(
        `<html><head><meta charset="utf-8"><title>Demo disabled</title></head><body style="font-family:system-ui;padding:24px"><h2>Demo disabled</h2><p>Set <code>DEMO_KEY</code> in <code>hvac-demo-landing/.env</code> and restart the server.</p></body></html>`
      );
  }

  if (isAuthed(req)) {
    return res.sendFile(path.join(__dirname, fileName));
  }

  // Simple password prompt → stores in localStorage + cookie, then redirects with ?key=
  const target = req.path;
  return res
    .status(401)
    .type("html")
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo Access</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <header class="topbar" role="banner">
      <div class="container topbar__inner">
        <div class="brand" aria-label="Local HVAC service demo">
          <div class="brand__logo" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2l2.2 6.1L21 9l-5 3.8 1.9 6.2L12 15.9 6.1 19l1.9-6.2L3 9l6.8-.9L12 2z" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </div>
          <div class="brand__text">
            <div class="brand__name">Missed Call Visibility Demo</div>
            <div class="brand__tag">Enter demo key to continue</div>
          </div>
        </div>
      </div>
    </header>

    <main class="section">
      <div class="container">
        <div class="form-card" style="max-width:520px;margin:0 auto;">
          <div class="form-card__head">
            <h2 class="form-card__title">Demo access</h2>
            <p class="form-card__subtitle">This is protected to prevent spam.</p>
          </div>
          <form id="authForm" novalidate>
            <div class="field field--full">
              <label for="demoKey">Demo key</label>
              <input id="demoKey" name="demoKey" placeholder="Enter demo key..." autocomplete="off" />
              <p class="error" id="authError" aria-live="polite"></p>
            </div>
            <button class="btn btn--primary btn--block" type="submit">Continue</button>
            <p class="form-footnote muted" style="margin-top:10px;">
              Tip: the key is stored locally on this device.
            </p>
          </form>
        </div>
      </div>
    </main>

    <script>
      (function(){
        const targetPath = ${JSON.stringify(target)};
        const params = new URLSearchParams(window.location.search);
        const existing = params.get("key") || localStorage.getItem("hvac_demo_key") || "";
        if (existing) {
          // Try redirect immediately with existing key
          const url = new URL(window.location.href);
          url.pathname = targetPath;
          url.searchParams.set("key", existing);
          window.location.replace(url.toString());
          return;
        }

        const form = document.getElementById("authForm");
        const input = document.getElementById("demoKey");
        const err = document.getElementById("authError");
        input.focus();

        form.addEventListener("submit", function(e){
          e.preventDefault();
          const key = (input.value || "").trim();
          if (!key) {
            err.textContent = "Please enter the demo key.";
            return;
          }
          localStorage.setItem("hvac_demo_key", key);
          document.cookie = "demo_key=" + encodeURIComponent(key) + "; path=/; SameSite=Lax";
          const url = new URL(window.location.href);
          url.pathname = targetPath;
          url.searchParams.set("key", key);
          window.location.replace(url.toString());
        });
      })();
    </script>
  </body>
</html>`);
}

function rowToJson(row) {
  if (!row) return null;
  let responseSeconds = null;
  try {
    if (row.followedUpAt) {
      const created = new Date(row.createdAt).getTime();
      const followed = new Date(row.followedUpAt).getTime();
      if (Number.isFinite(created) && Number.isFinite(followed)) {
        responseSeconds = Math.max(0, Math.floor((followed - created) / 1000));
      }
    }
  } catch {
    responseSeconds = null;
  }
  return {
    id: row.id,
    createdAt: row.createdAt,
    callerNumber: row.callerNumber,
    status: row.status,
    source: row.source,
    followedUp: !!row.followedUp,
    followedUpAt: row.followedUpAt,
    note: row.note,
    outcome: row.outcome ?? null,
    outcomeAt: row.outcomeAt ?? null,
    responseSeconds,
  };
}

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(__dirname));

// Pages
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/demo", (req, res) => guardedPage(req, res, "demo.html"));
app.get("/dashboard", (req, res) => guardedPage(req, res, "dashboard.html"));

// API: create event (webhook simulator)
app.post("/api/webhooks/call", requireDemoAuth, (req, res) => {
  const callerNumber = normalizeCallerNumber(req.body?.callerNumber);
  const status = req.body?.status;
  const source = req.body?.source ? String(req.body.source) : "simulator";

  if (!isValidCallerNumber(callerNumber)) {
    return res.status(400).json({
      error: "Invalid callerNumber",
      message:
        "callerNumber is required, length 7-20, and must contain only '+' and digits.",
    });
  }
  if (!isValidStatus(status)) {
    return res.status(400).json({
      error: "Invalid status",
      message: "status must be 'missed' or 'answered'.",
    });
  }

  const createdAt = new Date().toISOString();
  const insert = db
    .prepare(
      "INSERT INTO CallEvent (createdAt, callerNumber, status, source, followedUp) VALUES (?, ?, ?, ?, 0)"
    )
    .run(createdAt, callerNumber, status, source);

  const row = db
    .prepare("SELECT * FROM CallEvent WHERE id = ?")
    .get(insert.lastInsertRowid);

  return res.json(rowToJson(row));
});

// API: list recent calls
app.get("/api/calls", requireDemoAuth, (req, res) => {
  const rawLimit = req.query?.limit ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(200, Math.floor(rawLimit)))
    : 50;

  const rows = db
    .prepare("SELECT * FROM CallEvent ORDER BY createdAt DESC LIMIT ?")
    .all(limit);

  return res.json(rows.map(rowToJson));
});

function normalizeOutcome(raw) {
  if (raw === null) return null;
  if (typeof raw === "undefined") return undefined;
  return String(raw).trim();
}

function isValidOutcome(o) {
  return (
    o === "booked" ||
    o === "reached_no_booking" ||
    o === "no_answer" ||
    o === "already_hired" ||
    o === "wrong_number" ||
    o === "call_back_later"
  );
}

// API: follow-up
app.post("/api/calls/:id/follow-up", requireDemoAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE CallEvent SET followedUp = 1, followedUpAt = COALESCE(followedUpAt, ?) WHERE id = ?"
    )
    .run(now, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  const row = db.prepare("SELECT * FROM CallEvent WHERE id = ?").get(id);
  return res.json(rowToJson(row));
});

// API: set/clear outcome
app.post("/api/calls/:id/outcome", requireDemoAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const outcome = normalizeOutcome(req.body?.outcome);
  if (typeof outcome === "undefined") {
    return res.status(400).json({
      error: "Invalid outcome",
      message: "Body must include { outcome: <allowed string> | null }",
    });
  }

  if (outcome !== null && !isValidOutcome(outcome)) {
    return res.status(400).json({
      error: "Invalid outcome",
      message:
        "outcome must be one of: booked, reached_no_booking, no_answer, already_hired, wrong_number, call_back_later, or null.",
    });
  }

  if (outcome === null) {
    const result = db
      .prepare("UPDATE CallEvent SET outcome = NULL, outcomeAt = NULL WHERE id = ?")
      .run(id);
    if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  } else {
    const now = new Date().toISOString();
    const result = db
      .prepare("UPDATE CallEvent SET outcome = ?, outcomeAt = ? WHERE id = ?")
      .run(outcome, now, id);
    if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  }

  const row = db.prepare("SELECT * FROM CallEvent WHERE id = ?").get(id);
  return res.json(rowToJson(row));
});

// API: delete single call event
app.delete("/api/calls/:id", requireDemoAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const result = db.prepare("DELETE FROM CallEvent WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

// API: clear all call events (demo cleanup)
app.post("/api/calls/clear", requireDemoAuth, (req, res) => {
  db.exec("DELETE FROM CallEvent");
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ HVAC demo server running: http://127.0.0.1:${PORT}`);
  if (!DEMO_KEY) {
    // eslint-disable-next-line no-console
    console.log(
      "⚠️  DEMO_KEY is not set. /demo and /dashboard will be disabled until you set it."
    );
  }
});


