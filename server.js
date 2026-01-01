const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");

// Load local env if present (Cursor environment blocks editing .env sometimes)
try {
  // eslint-disable-next-line global-require
  const localEnv = path.join(__dirname, "local.env");
  const dotEnv = path.join(__dirname, ".env");
  if (fs.existsSync(localEnv)) {
    require("dotenv").config({ path: localEnv });
  } else {
    require("dotenv").config({ path: dotEnv });
  }
} catch {
  // ignore
}

const PORT = Number(process.env.PORT || 4173);
const DEMO_KEY = process.env.DEMO_KEY ? String(process.env.DEMO_KEY) : "";
const DATABASE_PATH = process.env.DATABASE_PATH
  ? String(process.env.DATABASE_PATH)
  : "./data/calls.sqlite";

// Email (Resend) + SLA
const RESEND_API_KEY = process.env.RESEND_API_KEY ? String(process.env.RESEND_API_KEY) : "";
const OWNER_ALERT_EMAIL = process.env.OWNER_ALERT_EMAIL ? String(process.env.OWNER_ALERT_EMAIL) : "";
// For quick end-to-end plumbing tests, Resend supports using onboarding@resend.dev as the sender.
// Production should set FROM_EMAIL to a verified domain sender (e.g. Leads <alerts@yourdomain.com>).
const FROM_EMAIL = process.env.FROM_EMAIL
  ? String(process.env.FROM_EMAIL)
  : "onboarding@resend.dev";
const COMPANY_NAME = process.env.COMPANY_NAME ? String(process.env.COMPANY_NAME) : "HVAC Service";
const COMPANY_PHONE = process.env.COMPANY_PHONE ? String(process.env.COMPANY_PHONE) : "";
const DASHBOARD_URL = process.env.DASHBOARD_URL ? String(process.env.DASHBOARD_URL) : "";
const SLA_MINUTES = Number(process.env.SLA_MINUTES || 15);
const OWNER_OPTIONS = process.env.OWNER_OPTIONS ? String(process.env.OWNER_OPTIONS) : "";
const DEFAULT_OWNER_OPTIONS = ["Cody", "Sam", "Alex"];

function parseOwnerOptions(raw) {
  const s = String(raw || "");
  const parts = s
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

const OWNER_OPTIONS_LIST = (() => {
  const parsed = parseOwnerOptions(OWNER_OPTIONS);
  return parsed.length ? parsed : DEFAULT_OWNER_OPTIONS;
})();

// Customer-ready default: demo simulator tooling is disabled unless explicitly enabled.
const ENABLE_SIMULATOR =
  String(process.env.ENABLE_SIMULATOR || "").toLowerCase() === "true" ||
  String(process.env.ENABLE_SIMULATOR || "").toLowerCase() === "1";

// Twilio webhook verification + optional call forwarding
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
  ? String(process.env.TWILIO_AUTH_TOKEN)
  : "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
  ? String(process.env.TWILIO_ACCOUNT_SID)
  : "";
const TWILIO_NUMBER = process.env.TWILIO_NUMBER ? String(process.env.TWILIO_NUMBER) : "";
const TWILIO_FORWARD_TO = process.env.TWILIO_FORWARD_TO
  ? String(process.env.TWILIO_FORWARD_TO)
  : "";
const TWILIO_VALIDATE_SIGNATURE =
  String(process.env.TWILIO_VALIDATE_SIGNATURE || "1") !== "0";

// Lead-rescue automation (demo-safe defaults)
// Keep SLA aligned with Lead Truth Ledger unless explicitly overridden.
const SLA_DEFAULT_MINUTES = Number(process.env.SLA_DEFAULT_MINUTES || process.env.SLA_MINUTES || 15);
const ESCALATE_AFTER_MINUTES = Number(process.env.ESCALATE_AFTER_MINUTES || 10);
// "log" (default): record what would happen without sending anything.
// Future modes you can add: "email", "sms"
const AUTOMATION_MODE = String(process.env.AUTOMATION_MODE || "log").toLowerCase();

// Missed-call SMS rescue (optional; requires AUTOMATION_MODE="sms" + Twilio creds)
const RESCUE_FORM_PATH = process.env.RESCUE_FORM_PATH ? String(process.env.RESCUE_FORM_PATH) : "/#request";
const RESCUE_YES_KEYWORD = process.env.RESCUE_YES_KEYWORD
  ? String(process.env.RESCUE_YES_KEYWORD)
  : "YES";

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

function getTableColumns(db, tableName) {
  const t = String(tableName || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
    throw new Error("Invalid table name for PRAGMA");
  }
  const rows = db.prepare(`PRAGMA table_info(${t})`).all();
  const cols = new Set();
  for (const r of rows || []) {
    if (r?.name) cols.add(String(r.name));
  }
  return cols;
}

function addColumnIfMissing(db, tableName, colName, colTypeSql) {
  const t = String(tableName || "").trim();
  const c = String(colName || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw new Error("Invalid table name");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) throw new Error("Invalid column name");
  const cols = getTableColumns(db, t);
  if (cols.has(c)) return false;
  db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${colTypeSql}`);
  return true;
}

function ensureLeadTruthLedgerSchema(db) {
  // Add required columns to CallEvent if missing (safe for existing DBs).
  // NOTE: store timestamps as ISO TEXT where possible (SQLite is flexible about types).
  addColumnIfMissing(db, "CallEvent", "owner", "TEXT");
  addColumnIfMissing(db, "CallEvent", "first_action_at", "TEXT");
  addColumnIfMissing(db, "CallEvent", "next_step", "TEXT");
  addColumnIfMissing(db, "CallEvent", "handled_at", "TEXT");
  addColumnIfMissing(db, "CallEvent", "outcome_set_at", "TEXT");
  addColumnIfMissing(db, "CallEvent", "overdue_sent_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "CallEvent", "overdue_last_sent_at", "INTEGER");
  addColumnIfMissing(db, "CallEvent", "customer_email", "TEXT");
  addColumnIfMissing(db, "CallEvent", "customer_name", "TEXT");
  addColumnIfMissing(db, "CallEvent", "appointment_date", "TEXT");
  addColumnIfMissing(db, "CallEvent", "appointment_window", "TEXT");
  addColumnIfMissing(db, "CallEvent", "customer_booking_email_sent_at", "INTEGER");

  // Helpful indexes (safe).
  db.exec("CREATE INDEX IF NOT EXISTS idx_CallEvent_outcome ON CallEvent (outcome)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_CallEvent_createdAt_text ON CallEvent (createdAt DESC)");

  // Do NOT backfill first_action_at/handled_at here; migrations handle backfill deterministically.
}

function openDb() {
  ensureDir(path.dirname(resolvedDbPath));
  const db = new Database(resolvedDbPath);
  // WAL + NORMAL sync keeps demo writes snappy while staying safe enough for this use-case.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 3000");
  migrateDb(db);
  ensureLeadTruthLedgerSchema(db);
  return db;
}

const db = openDb();

const { sendResendEmail } = require("./server/email.js");
const {
  internalInboundSubject,
  internalOverdueSubject,
  internalEmailHtml,
  customerFormConfirmation,
  customerBookingConfirmation,
  formatDuration,
  formatMinutes,
} = require("./server/notify.js");

function isValidCallerNumber(raw) {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (s.length < 7 || s.length > 20) return false;
  return /^\+?\d+$/.test(s);
}

function normalizeCallerNumber(raw) {
  return String(raw || "").trim();
}

function digitsOnly(s) {
  return String(s || "").replace(/[^\d]/g, "");
}

function normalizeLeadPhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Already E.164-ish
  if (s.startsWith("+")) {
    const digits = digitsOnly(s);
    return digits ? `+${digits}` : "";
  }
  const digits = digitsOnly(s);
  if (!digits) return "";
  // US-friendly normalization (good enough for demo)
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Fallback: return raw digits; validator allows optional '+'
  return digits;
}

function isSamePhoneNumber(a, b) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  // Compare last 10 digits (US-centric; good enough for our demo/testing)
  const ta = da.length > 10 ? da.slice(-10) : da;
  const tb = db.length > 10 ? db.slice(-10) : db;
  return ta === tb;
}

function isValidStatus(s) {
  return s === "missed" || s === "answered";
}

function clampStr(val, maxLen) {
  const s = String(val ?? "").trim();
  if (!s) return "";
  const n = Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : 0;
  if (!n) return s;
  return s.length > n ? s.slice(0, n) : s;
}

function clientIp(req) {
  // trust proxy is enabled, so x-forwarded-for is meaningful behind Render
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return String(req.socket?.remoteAddress || "").trim();
}

// Super-lightweight in-memory throttle to reduce spam on the public form endpoint.
// (Good enough for demo; in production you'd use a proper WAF / captcha / rate limiter.)
const landingThrottle = new Map();
function isRateLimited(ip, windowMs = 60_000, max = 15) {
  const key = ip || "unknown";
  const now = Date.now();
  const entry = landingThrottle.get(key) || { ts: now, count: 0 };
  if (now - entry.ts > windowMs) {
    entry.ts = now;
    entry.count = 0;
  }
  entry.count += 1;
  landingThrottle.set(key, entry);
  return entry.count > max;
}

function escapeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isValidCallSid(s) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  // Twilio CallSid format: CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (34 chars total)
  return /^CA[a-f0-9]{32}$/i.test(trimmed);
}

function isLocalhostHost(hostname) {
  const h = String(hostname || "").toLowerCase().trim();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function shouldBypassDemoKey(req) {
  // Local/dev convenience: don't block the dashboard when DEMO_KEY isn't set.
  // Keep production locked down (Render sets process.env.RENDER).
  if (process.env.RENDER) return false;
  const host = req?.hostname || req?.headers?.host || "";
  return isLocalhostHost(host);
}

function isAuthed(req) {
  if (!DEMO_KEY) return shouldBypassDemoKey(req);
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

function requireSimulatorEnabled(req, res, next) {
  if (!ENABLE_SIMULATOR) {
    return res.status(404).json({ message: "Not found" });
  }
  return next();
}

function guardedPage(req, res, fileName) {
  if (!DEMO_KEY) {
    if (shouldBypassDemoKey(req)) {
      return res.sendFile(path.join(__dirname, fileName));
    }
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
  const hadQueryKey = !!(req.query && typeof req.query.key !== "undefined");
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
        const hadQueryKey = ${JSON.stringify(hadQueryKey)};
        const params = new URLSearchParams(window.location.search);

        // Escape hatch: /dashboard?reset=1 clears any saved key/cookie so you can re-enter cleanly.
        if (params.get("reset") === "1") {
          try { localStorage.removeItem("hvac_demo_key"); } catch {}
          try { document.cookie = "demo_key=; Max-Age=0; path=/; SameSite=Lax"; } catch {}
          params.delete("reset");
          params.delete("key");
          const clean = new URL(window.location.href);
          clean.search = params.toString() ? ("?" + params.toString()) : "";
          window.history.replaceState({}, "", clean.toString());
        }

        const fromUrl = (params.get("key") || "").trim();
        const fromStore = (localStorage.getItem("hvac_demo_key") || "").trim();
        const existing = fromUrl || fromStore || "";

        // IMPORTANT: if a key was already tried via ?key=, do NOT auto-redirect again (prevents loops).
        // We'll show the form and let the user enter a correct key.
        if (existing && !hadQueryKey) {
          const url = new URL(window.location.href);
          url.pathname = targetPath;
          url.searchParams.set("key", existing);
          window.location.replace(url.toString());
          return;
        }

        const form = document.getElementById("authForm");
        const input = document.getElementById("demoKey");
        const err = document.getElementById("authError");
        if (existing) input.value = existing;
        input.focus();

        if (hadQueryKey) {
          err.textContent = "That demo key didn't work. Please try again.";
        }

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
          url.searchParams.delete("reset");
          window.location.replace(url.toString());
        });
      })();
    </script>
  </body>
</html>`);
}

function rowToJson(row) {
  if (!row) return null;
  const nowMs = Date.now();
  const createdMs = Date.parse(String(row.createdAt || ""));
  const firstActionIso = row.first_action_at ? String(row.first_action_at) : "";
  const firstActionMs = firstActionIso ? Date.parse(firstActionIso) : NaN;

  // Response time: time to first human action (owner or result).
  let responseSeconds = null;
  if (Number.isFinite(createdMs) && Number.isFinite(firstActionMs)) {
    responseSeconds = Math.max(0, Math.floor((firstActionMs - createdMs) / 1000));
  }

  const needsOutcome = !(row.outcome && String(row.outcome).trim());
  const slaMinRaw = typeof row.slaMinutes === "number" ? row.slaMinutes : Number(row.slaMinutes);
  const slaMin = Number.isFinite(slaMinRaw) ? Math.max(1, Math.floor(slaMinRaw)) : Math.max(1, Math.floor(SLA_MINUTES || 15));
  const dueMs = Number.isFinite(createdMs) ? createdMs + slaMin * 60_000 : NaN;
  const hasFirstAction = !!(firstActionIso && firstActionIso.trim());
  const overdue = !hasFirstAction && Number.isFinite(dueMs) && nowMs > dueMs;
  const overdueMinutes = overdue ? Math.max(0, Math.floor((nowMs - dueMs) / 60_000)) : null;
  const openLabel = !needsOutcome ? "Closed" : overdue ? `Overdue ${overdueMinutes}m` : "Open";

  // Type label: clarify inbound call answer/miss for calls.
  let typeLabel = "";
  if (String(row.source) === "twilio") {
    const dur =
      typeof row.dialCallDurationSec === "number"
        ? row.dialCallDurationSec
        : typeof row.callDurationSec === "number"
          ? row.callDurationSec
          : null;
    const tw = String(row.twilioStatus || "").toLowerCase().trim();
    const isAnswered = String(row.status) === "answered" && typeof dur === "number" && dur > 0;
    const isMissed =
      String(row.status) === "missed" ||
      tw === "no-answer" ||
      tw === "busy" ||
      tw === "failed" ||
      tw === "canceled" ||
      (String(row.status) !== "answered" && !(typeof dur === "number" && dur > 0));
    typeLabel = isAnswered ? "Inbound call (Answered)" : isMissed ? "Inbound call (Missed)" : "Inbound call";
  } else if (String(row.source) === "landing_form") {
    typeLabel = "Form submit";
  } else if (String(row.source) === "landing_call_click") {
    typeLabel = "Call click";
  } else {
    typeLabel = row.source ? String(row.source) : "Unknown";
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
    callSid: row.callSid ?? null,
    toNumber: row.toNumber ?? null,
    twilioStatus: row.twilioStatus ?? null,
    direction: row.direction ?? null,
    callDurationSec:
      typeof row.callDurationSec === "number" ? row.callDurationSec : row.callDurationSec ?? null,
    dialCallDurationSec:
      typeof row.dialCallDurationSec === "number"
        ? row.dialCallDurationSec
        : row.dialCallDurationSec ?? null,
    assignedTo: row.assignedTo ?? null,
    owner: row.owner ?? null,
    first_action_at: firstActionIso || null,
    next_step: row.next_step ? String(row.next_step) : null,
    handled_at: row.handled_at ? String(row.handled_at) : null,
    outcome_set_at: row.outcome_set_at ? String(row.outcome_set_at) : null,
    overdue_sent_count:
      typeof row.overdue_sent_count === "number"
        ? row.overdue_sent_count
        : row.overdue_sent_count ?? 0,
    overdue_last_sent_at:
      typeof row.overdue_last_sent_at === "number"
        ? row.overdue_last_sent_at
        : row.overdue_last_sent_at ?? null,
    customer_email: row.customer_email ?? null,
    customer_name: row.customer_name ?? null,
    appointment_date: row.appointment_date ?? null,
    appointment_window: row.appointment_window ?? null,
    customer_booking_email_sent_at:
      typeof row.customer_booking_email_sent_at === "number"
        ? row.customer_booking_email_sent_at
        : row.customer_booking_email_sent_at ?? null,
    followup_count:
      typeof row.followup_count === "number" ? row.followup_count : row.followup_count ?? 0,
    slaMinutes: typeof row.slaMinutes === "number" ? row.slaMinutes : row.slaMinutes ?? null,
    slaDueAt: row.slaDueAt ?? null,
    slaBreachedAt: row.slaBreachedAt ?? null,
    escalatedAt: row.escalatedAt ?? null,
    responseSeconds,
    overdue,
    needs_outcome: needsOutcome,
    open_label: openLabel,
    overdue_minutes: overdueMinutes,
    type_label: typeLabel,
  };
}

const app = express();
// Behind Render (or any proxy), this enables correct req.protocol from X-Forwarded-Proto.
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
// Twilio webhooks POST x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

// Pages
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/demo", (req, res) => {
  if (!ENABLE_SIMULATOR) return res.status(404).send("Not found");
  return guardedPage(req, res, "demo.html");
});
app.get("/dashboard", (req, res) => guardedPage(req, res, "dashboard.html"));

// Health check (safe to expose publicly; no secrets)
app.get("/_health", (req, res) => {
  return res.json({
    ok: true,
    service: "hvac-demo-landing",
    node: process.version,
    hasDemoKey: !!DEMO_KEY,
    twilio: {
      validateSignature: !!TWILIO_VALIDATE_SIGNATURE,
      hasAuthToken: !!TWILIO_AUTH_TOKEN,
      hasAccountSid: !!TWILIO_ACCOUNT_SID,
      hasNumber: !!TWILIO_NUMBER,
      forwardEnabled: !!TWILIO_FORWARD_TO,
    },
  });
});

function computeTwilioSignature(url, params, authToken) {
  const body = params && typeof params === "object" ? params : {};
  const keys = Object.keys(body).sort();
  let data = String(url || "");
  for (const k of keys) {
    const v = body[k];
    // Twilio treats multi-value params as repeated keys; our usage is simple (single values).
    data += k + (Array.isArray(v) ? v.join("") : String(v ?? ""));
  }
  return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function timingSafeEqualStr(a, b) {
  try {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function validateTwilioRequest(req) {
  // If auth token is not set, we can't validate. Allow but log a warning.
  if (!TWILIO_VALIDATE_SIGNATURE) return true;
  if (!TWILIO_AUTH_TOKEN) return true;
  const sig = req.headers["x-twilio-signature"]
    ? String(req.headers["x-twilio-signature"])
    : "";
  if (!sig) return false;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const expected = computeTwilioSignature(url, req.body, TWILIO_AUTH_TOKEN);
  return timingSafeEqualStr(sig, expected);
}

function requireTwilioAuth(req, res, next) {
  if (!TWILIO_VALIDATE_SIGNATURE) return next();
  if (!TWILIO_AUTH_TOKEN) {
    if (!requireTwilioAuth._warned) {
      // eslint-disable-next-line no-console
      console.log("⚠️  TWILIO_AUTH_TOKEN not set; skipping Twilio signature verification.");
      requireTwilioAuth._warned = true;
    }
    return next();
  }
  if (validateTwilioRequest(req)) return next();
  return res.status(403).type("text/plain").send("Forbidden");
}

function normalizeTwilioCallStatus({
  callStatus,
  dialCallStatus,
  hasForwarding,
  callDurationSec,
  dialCallDurationSec,
}) {
  const cs = String(callStatus || "").toLowerCase().trim();
  const dcs = String(dialCallStatus || "").toLowerCase().trim();

  // If we are NOT forwarding, Twilio "completed" just means it finished our TwiML.
  // That does NOT indicate a real human answered, so treat as missed/unhandled.
  if (!hasForwarding) return "missed";

  // Most reliable: if Twilio reports a connected leg duration, it was answered.
  // When forwarding via <Dial>, DialCallDuration represents the forwarded leg.
  if (typeof dialCallDurationSec === "number" && dialCallDurationSec > 0) return "answered";
  // For completeness, if Twilio reports overall call duration > 0, treat as answered.
  // (This helps when DialCallStatus/DialCallDuration aren't present in a callback.)
  if (typeof callDurationSec === "number" && callDurationSec > 0) return "answered";

  // When forwarding via <Dial>, trust DialCallStatus if present.
  // Twilio DialCallStatus values: completed | busy | no-answer | failed | canceled
  if (dcs) {
    if (dcs === "completed") return "answered";
    return "missed";
  }

  // Fallback: interpret call status.
  // "in-progress" implies connected; treat as answered. "completed" is ambiguous; treat as missed.
  if (cs === "in-progress") return "answered";
  return "missed";
}

function safeNumberOrNull(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function normalizeSlaMinutes(raw) {
  const n = safeNumberOrNull(raw);
  const fallback = Number.isFinite(SLA_DEFAULT_MINUTES) ? SLA_DEFAULT_MINUTES : 5;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < 1) return 1;
  if (i > 120) return 120;
  return i;
}

function computeDueAtIso(createdAtIso, minutes) {
  const ms = Date.parse(String(createdAtIso));
  const mins = Number.isFinite(minutes) ? minutes : SLA_DEFAULT_MINUTES;
  if (!Number.isFinite(ms) || !Number.isFinite(mins)) return null;
  const dueMs = ms + Math.max(0, Math.floor(mins)) * 60_000;
  return new Date(dueMs).toISOString();
}

function getCallEventById(id) {
  return db.prepare("SELECT * FROM CallEvent WHERE id = ?").get(id);
}

function getCallEventByCallSid(callSid) {
  if (!callSid) return null;
  return db.prepare("SELECT * FROM CallEvent WHERE callSid = ?").get(callSid);
}

function getCallEventWithFollowupCountById(id) {
  return db
    .prepare(
      `
      SELECT
        ce.*,
        COALESCE(f.cnt, 0) AS followup_count
      FROM CallEvent ce
      LEFT JOIN (
        SELECT event_id, COUNT(*) AS cnt
        FROM followups
        GROUP BY event_id
      ) f ON f.event_id = ce.id
      WHERE ce.id = ?
    `.trim()
    )
    .get(id);
}

function listEventsWithFollowupCount(limit = 50) {
  const rawLimit = Number(limit);
  const lim = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 50;
  return db
    .prepare(
      `
      SELECT
        ce.*,
        COALESCE(f.cnt, 0) AS followup_count
      FROM CallEvent ce
      LEFT JOIN (
        SELECT event_id, COUNT(*) AS cnt
        FROM followups
        GROUP BY event_id
      ) f ON f.event_id = ce.id
      ORDER BY ce.createdAt DESC
      LIMIT ?
    `.trim()
    )
    .all(lim);
}

function parseCreatedAtMs(row) {
  const ms = Date.parse(String(row?.createdAt || ""));
  return Number.isFinite(ms) ? ms : null;
}

function getDashboardUrlForEvent(req, id) {
  // Prefer explicit DASHBOARD_URL env. Fallback to current host /dashboard.
  if (DASHBOARD_URL && String(DASHBOARD_URL).trim()) return String(DASHBOARD_URL).trim();
  try {
    const base = `${req.protocol}://${req.get("host")}`;
    return `${base}/dashboard`;
  } catch {
    return "";
  }
}

function normalizeEmail(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Very light validation; Resend will enforce deliverability anyway.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "";
  return s;
}

function hasEmailLog({ eventId, emailType }) {
  const row = db
    .prepare(
      "SELECT 1 FROM email_logs WHERE event_id IS ? AND email_type = ? ORDER BY id DESC LIMIT 1"
    )
    .get(eventId ?? null, String(emailType));
  return !!row;
}

function insertEmailLog({
  eventId,
  emailType,
  toEmail,
  status,
  providerMessageId,
  errorText,
}) {
  const now = Date.now();
  db.prepare(
    `
      INSERT INTO email_logs (
        event_id, email_type, to_email, status, provider, provider_message_id, error_text, created_at
      ) VALUES (?, ?, ?, ?, 'resend', ?, ?, ?)
    `.trim()
  ).run(
    eventId ?? null,
    String(emailType),
    String(toEmail || ""),
    String(status),
    providerMessageId || null,
    errorText || null,
    now
  );
  return now;
}

async function sendAndLogEmail({ req, eventId, emailType, toEmail, subject, html, text }) {
  const to = String(toEmail || "").trim();
  try {
    const result = await sendResendEmail({
      apiKey: RESEND_API_KEY,
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
    });
    insertEmailLog({
      eventId,
      emailType,
      toEmail: to,
      status: "sent",
      providerMessageId: result?.id || null,
      errorText: null,
    });
    return { ok: true, provider_message_id: result?.id || null, dashboard_url: getDashboardUrlForEvent(req, eventId) };
  } catch (e) {
    insertEmailLog({
      eventId,
      emailType,
      toEmail: to,
      status: "failed",
      providerMessageId: null,
      errorText: String(e?.message || e || "Unknown error"),
    });
    return { ok: false, error: e?.message || "Email failed" };
  }
}

async function maybeSendInternalInboundEmail({ req, eventId, allowNonFinalTwilioMissed } = {}) {
  if (!OWNER_ALERT_EMAIL || !String(OWNER_ALERT_EMAIL).trim()) return;
  if (hasEmailLog({ eventId, emailType: "internal_inbound" })) return;

  const row = getCallEventById(eventId);
  if (!row) return;

  // Rule:
  // - Missed Twilio call: send immediately once Twilio definitively classifies it as missed.
  // - Answered Twilio call: may be delayed (we wait for completed to avoid premature classification).
  // - Forms: send immediately.
  const isForm = row.source === "landing_form";
  const twilioFinalish = String(row.twilioStatus || "").toLowerCase().trim() === "completed";
  if (!isForm && row.source === "twilio" && row.status !== "missed" && !twilioFinalish) return;
  if (!isForm && row.source === "twilio" && row.status === "missed" && !twilioFinalish && !allowNonFinalTwilioMissed) {
    return;
  }

  const subject = internalInboundSubject({
    status: row.status,
    callerNumber: row.callerNumber,
    callDurationSec: typeof row.dialCallDurationSec === "number" ? row.dialCallDurationSec : row.callDurationSec,
    source: row.source,
    customerName: row.customer_name || null,
  });

  const lines = [
    `Type: ${row.source || "unknown"}`,
    `Status: ${row.status || "unknown"}`,
    `Caller: ${row.callerNumber || "unknown"}`,
    row.callSid ? `CallSid: ${row.callSid}` : null,
  ].filter(Boolean);

  const html = internalEmailHtml({
    title: subject,
    lines,
    dashboardUrl: getDashboardUrlForEvent(req, eventId),
  });

  await sendAndLogEmail({
    req,
    eventId,
    emailType: "internal_inbound",
    toEmail: OWNER_ALERT_EMAIL,
    subject,
    html,
  });
}

function getMostRecentCallEventForCaller(callerNumber) {
  const n = normalizeCallerNumber(callerNumber);
  if (!isValidCallerNumber(n)) return null;
  return db
    .prepare("SELECT * FROM CallEvent WHERE callerNumber = ? ORDER BY createdAt DESC LIMIT 1")
    .get(n);
}

function updateRescueSmsSent({ callEventId, sentAtIso, smsSid, smsBody }) {
  db.prepare(
    "UPDATE CallEvent SET rescueSmsSentAt = COALESCE(rescueSmsSentAt, ?), rescueSmsSid = COALESCE(rescueSmsSid, ?), rescueSmsBody = COALESCE(rescueSmsBody, ?) WHERE id = ?"
  ).run(sentAtIso, smsSid || null, smsBody || null, callEventId);
}

function updateRescueInbound({ callEventId, inboundAtIso, inboundBody, yesAtIso }) {
  db.prepare(
    "UPDATE CallEvent SET rescueInboundSmsAt = COALESCE(rescueInboundSmsAt, ?), rescueInboundSmsBody = COALESCE(rescueInboundSmsBody, ?), rescueYesAt = COALESCE(rescueYesAt, ?) WHERE id = ?"
  ).run(inboundAtIso, inboundBody || null, yesAtIso || null, callEventId);
}

function updateRescueCallbackPlaced({ callEventId, placedAtIso, callSid }) {
  db.prepare(
    "UPDATE CallEvent SET rescueCallbackPlacedAt = COALESCE(rescueCallbackPlacedAt, ?), rescueCallbackCallSid = COALESCE(rescueCallbackCallSid, ?) WHERE id = ?"
  ).run(placedAtIso, callSid || null, callEventId);
}

function ensureSlaDefaultsForEventId(callEventId) {
  const row = getCallEventById(callEventId);
  if (!row) return;
  const minutes = normalizeSlaMinutes(row.slaMinutes);
  const dueAt = row.slaDueAt || computeDueAtIso(row.createdAt, minutes);
  db.prepare(
    "UPDATE CallEvent SET slaMinutes = COALESCE(slaMinutes, ?), slaDueAt = COALESCE(slaDueAt, ?) WHERE id = ?"
  ).run(minutes, dueAt, callEventId);
}

function insertAutomationEvent({ callEventId, kind, dedupeKey, payload }) {
  const now = new Date().toISOString();
  const safePayload = payload ? JSON.stringify(payload) : null;
  try {
    db.prepare(
      "INSERT INTO AutomationEvent (createdAt, callEventId, kind, status, dedupeKey, payload) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      now,
      callEventId ?? null,
      String(kind),
      AUTOMATION_MODE || "log",
      String(dedupeKey),
      safePayload
    );
  } catch (e) {
    // Unique constraint → already logged; ignore
    if (String(e?.message || "").toLowerCase().includes("unique")) return;
    throw e;
  }
}

function isHandledRow(row) {
  // Product rule used by the dashboard copy: "Setting a Result marks the lead handled."
  return !!row?.outcome;
}

function runAutomationPass() {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const rows = db.prepare("SELECT * FROM CallEvent ORDER BY createdAt DESC LIMIT 200").all();
  let logged = 0;

  for (const row of rows) {
    if (!row) continue;
    if (isHandledRow(row)) continue;

    const minutes = normalizeSlaMinutes(row.slaMinutes);
    const dueAt = row.slaDueAt || computeDueAtIso(row.createdAt, minutes);
    if (dueAt && (!row.slaMinutes || !row.slaDueAt)) {
      db.prepare("UPDATE CallEvent SET slaMinutes = ?, slaDueAt = ? WHERE id = ?").run(
        minutes,
        dueAt,
        row.id
      );
    }

    const dueMs = dueAt ? Date.parse(dueAt) : null;
    if (!Number.isFinite(dueMs)) continue;

    if (!row.slaBreachedAt && nowMs > dueMs) {
      db.prepare("UPDATE CallEvent SET slaBreachedAt = ? WHERE id = ?").run(nowIso, row.id);
      insertAutomationEvent({
        callEventId: row.id,
        kind: "sla_breached",
        dedupeKey: `sla_breached:${row.id}`,
        payload: {
          assignedTo: row.assignedTo || null,
          dueAt,
          source: row.source,
          callerNumber: row.callerNumber,
        },
      });
      logged += 1;
    }

    const escAfterMin = normalizeSlaMinutes(ESCALATE_AFTER_MINUTES);
    const escAfterMs = escAfterMin * 60_000;
    if (!row.escalatedAt && nowMs > dueMs + escAfterMs) {
      db.prepare("UPDATE CallEvent SET escalatedAt = ? WHERE id = ?").run(nowIso, row.id);
      insertAutomationEvent({
        callEventId: row.id,
        kind: "escalated",
        dedupeKey: `escalated:${row.id}`,
        payload: {
          assignedTo: row.assignedTo || null,
          dueAt,
          escalateAfterMinutes: escAfterMin,
          mode: AUTOMATION_MODE,
        },
      });
      logged += 1;
    }
  }

  return { ok: true, logged };
}

async function runOverdueEmailPass() {
  // Overdue: no human action yet (first_action_at is NULL) AND age > SLA_MINUTES.
  // Send at most 2 emails per lead (first at SLA, second at 60m).
  if (!OWNER_ALERT_EMAIL || !String(OWNER_ALERT_EMAIL).trim()) return { ok: true, sent: 0, skipped: "no_owner_email" };
  if (!RESEND_API_KEY || !String(RESEND_API_KEY).trim()) return { ok: true, sent: 0, skipped: "no_resend_key" };
  if (!FROM_EMAIL || !String(FROM_EMAIL).trim()) return { ok: true, sent: 0, skipped: "no_from_email" };

  const nowMs = Date.now();
  const slaMin = Number.isFinite(SLA_MINUTES) ? Math.max(1, Math.floor(SLA_MINUTES)) : 15;
  const slaMs = slaMin * 60_000;
  const secondMs = 60 * 60_000;

  const rows = db
    .prepare(
      `
      SELECT
        id,
        createdAt,
        callerNumber,
        source,
        status,
        outcome,
        first_action_at,
        overdue_sent_count,
        overdue_last_sent_at
      FROM CallEvent
      WHERE (outcome IS NULL OR TRIM(outcome) = '')
        AND (first_action_at IS NULL OR TRIM(first_action_at) = '')
      ORDER BY createdAt ASC
      LIMIT 200
    `.trim()
    )
    .all();

  let sent = 0;
  for (const r of rows || []) {
    const createdMs = Date.parse(String(r.createdAt || ""));
    if (!Number.isFinite(createdMs)) continue;
    const ageMs = nowMs - createdMs;
    if (ageMs <= slaMs) continue;

    const count = Number(r.overdue_sent_count || 0);
    const last = typeof r.overdue_last_sent_at === "number" ? r.overdue_last_sent_at : null;
    const tooSoon = Number.isFinite(last) && nowMs - last < 5 * 60_000;
    if (tooSoon) continue;

    const shouldSend =
      (count <= 0 && ageMs > slaMs) ||
      (count === 1 && ageMs > secondMs);
    if (!shouldSend) continue;
    if (count >= 2) continue;

    // Mark before sending so we don't spam on repeated failures.
    db.prepare(
      "UPDATE CallEvent SET overdue_sent_count = COALESCE(overdue_sent_count, 0) + 1, overdue_last_sent_at = ? WHERE id = ?"
    ).run(nowMs, r.id);

    const minsOver = formatMinutes(ageMs);
    const subject = internalOverdueSubject({ minutesOver: minsOver, callerNumber: r.callerNumber });
    const html = internalEmailHtml({
      title: subject,
      lines: [
        `Open for: ${minsOver != null ? `${minsOver} minutes` : "—"}`,
        `Type: ${r.source || "unknown"}`,
        `Caller: ${r.callerNumber || "unknown"}`,
        `Status: ${r.status || "unknown"}`,
      ],
      dashboardUrl: DASHBOARD_URL,
    });

    // Use req-less send; receipt still logged.
    // We pass a fake minimal req for dashboard link fallback.
    // eslint-disable-next-line no-unused-vars
    const fakeReq = { protocol: "https", get: () => "", headers: {} };
    await sendAndLogEmail({
      req: fakeReq,
      eventId: r.id,
      emailType: "internal_overdue",
      toEmail: OWNER_ALERT_EMAIL,
      subject,
      html,
    });
    sent += 1;
  }

  return { ok: true, sent };
}

function upsertTwilioEvent({
  callSid,
  from,
  to,
  callStatus,
  dialCallStatus,
  direction,
  callDurationSec,
  dialCallDurationSec,
}) {
  const now = new Date().toISOString();
  const callerNumber = normalizeCallerNumber(from);
  const status = normalizeTwilioCallStatus({
    callStatus,
    dialCallStatus,
    hasForwarding: !!TWILIO_FORWARD_TO,
    callDurationSec,
    dialCallDurationSec,
  });
  const twilioStatus = String(dialCallStatus || callStatus || "").trim();
  const createdMsNow = (() => {
    const ms = Date.parse(now);
    return Number.isFinite(ms) ? ms : Date.now();
  })();

  if (callSid && isValidCallSid(callSid)) {
    const existing = db
      .prepare("SELECT * FROM CallEvent WHERE callSid = ?")
      .get(callSid);

    if (existing) {
      db.prepare(
        "UPDATE CallEvent SET callerNumber = COALESCE(?, callerNumber), status = ?, source = 'twilio', toNumber = COALESCE(?, toNumber), twilioStatus = COALESCE(?, twilioStatus), direction = COALESCE(?, direction), callDurationSec = COALESCE(?, callDurationSec), dialCallDurationSec = COALESCE(?, dialCallDurationSec) WHERE callSid = ?"
      ).run(
        callerNumber || null,
        status,
        to || null,
        twilioStatus || null,
        direction || null,
        callDurationSec ?? null,
        dialCallDurationSec ?? null,
        callSid
      );
      try {
        const updated = getCallEventByCallSid(callSid);
        if (updated?.id) ensureSlaDefaultsForEventId(updated.id);
      } catch { }
      return;
    }

    db.prepare(
      "INSERT INTO CallEvent (createdAt, callerNumber, status, source, followedUp, callSid, toNumber, twilioStatus, direction, callDurationSec, dialCallDurationSec) VALUES (?, ?, ?, 'twilio', 0, ?, ?, ?, ?, ?, ?)"
    ).run(
      now,
      callerNumber || "+10000000000",
      status,
      callSid,
      to || null,
      twilioStatus || null,
      direction || null,
      callDurationSec ?? null,
      dialCallDurationSec ?? null
    );
    try {
      const inserted = getCallEventByCallSid(callSid);
      if (inserted?.id) {
        ensureSlaDefaultsForEventId(inserted.id);
        insertAutomationEvent({
          callEventId: inserted.id,
          kind: "lead_created",
          dedupeKey: `lead_created:${inserted.id}`,
          payload: { source: "twilio", status },
        });
      }
    } catch { }
    return;
  }

  // Fallback if CallSid missing/invalid: insert as a best-effort event.
  db.prepare(
    "INSERT INTO CallEvent (createdAt, callerNumber, status, source, followedUp, toNumber, twilioStatus, direction, callDurationSec, dialCallDurationSec) VALUES (?, ?, ?, 'twilio', 0, ?, ?, ?, ?, ?)"
  ).run(
    now,
    callerNumber || "+10000000000",
    status,
    to || null,
    twilioStatus || null,
    direction || null,
    callDurationSec ?? null,
    dialCallDurationSec ?? null
  );
}

function twiml(xmlInner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${xmlInner || ""}</Response>`;
}

function parseTwilioSeconds(val) {
  if (val === null || typeof val === "undefined") return null;
  const n = Number(String(val).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return null;
  return i;
}

// Twilio: outbound test TwiML (for one-phone testing via Twilio API)
app.post("/twilio/outbound", requireTwilioAuth, (req, res) => {
  return res
    .type("text/xml")
    .send(
      twiml(
        "<Say>Thanks for calling. Please hold while we connect you.</Say><Pause length=\"10\"/><Hangup/>"
      )
    );
});

function canUseTwilioApi() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_NUMBER);
}

async function sendTwilioSms({ toNumber, body }) {
  if (!canUseTwilioApi()) {
    const e = new Error(
      "Twilio SMS not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER)."
    );
    e.code = "TWILIO_NOT_CONFIGURED";
    throw e;
  }
  const to = String(toNumber || "").trim();
  if (!isValidCallerNumber(to)) {
    const e = new Error("Invalid SMS toNumber");
    e.code = "INVALID_TO";
    throw e;
  }
  const msg = String(body || "").trim();
  if (!msg) {
    const e = new Error("Empty SMS body");
    e.code = "EMPTY_BODY";
    throw e;
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const form = new URLSearchParams();
  form.set("From", TWILIO_NUMBER);
  form.set("To", to);
  form.set("Body", msg);

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text };
  }
  if (!resp.ok) {
    const msg2 = json?.message || json?.error_message || `Twilio API error (${resp.status})`;
    const e = new Error(msg2);
    e.status = resp.status;
    e.details = json;
    throw e;
  }
  return json;
}

async function createTwilioRescueCallbackCall({ toNumber, leadNumber, baseUrl }) {
  if (!canUseTwilioApi()) {
    const e = new Error(
      "Twilio callback not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER)."
    );
    e.code = "TWILIO_NOT_CONFIGURED";
    throw e;
  }
  const to = String(toNumber || "").trim();
  const lead = normalizeCallerNumber(leadNumber);
  if (!isValidCallerNumber(to)) {
    const e = new Error("Invalid callback toNumber");
    e.code = "INVALID_TO";
    throw e;
  }
  if (!isValidCallerNumber(lead)) {
    const e = new Error("Invalid leadNumber");
    e.code = "INVALID_LEAD";
    throw e;
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const body = new URLSearchParams();
  body.set("From", TWILIO_NUMBER);
  body.set("To", to);
  body.set("Url", `${baseUrl}/twilio/rescue-callback?lead=${encodeURIComponent(lead)}`);
  body.set("Method", "POST");

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text };
  }
  if (!resp.ok) {
    const msg = json?.message || json?.error_message || `Twilio API error (${resp.status})`;
    const e = new Error(msg);
    e.status = resp.status;
    e.details = json;
    throw e;
  }
  return json;
}

async function createTwilioTestCall({ toNumber, statusCallbackUrl, twimlUrl }) {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const body = new URLSearchParams();
  body.set("From", TWILIO_NUMBER);
  body.set("To", toNumber);
  body.set("Url", twimlUrl);
  body.set("Method", "POST");
  body.set("StatusCallback", statusCallbackUrl);
  body.set("StatusCallbackMethod", "POST");
  body.set("StatusCallbackEvent", "initiated ringing answered completed");

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text };
  }
  if (!resp.ok) {
    const msg = json?.message || json?.error_message || `Twilio API error (${resp.status})`;
    const e = new Error(msg);
    e.status = resp.status;
    e.details = json;
    throw e;
  }
  return json;
}

// One-phone testing: trigger Twilio to call your phone from the Twilio number.
// This simulates a "customer call event pipeline" without needing a second device.
app.post("/api/twilio/test-call", requireDemoAuth, async (req, res) => {
  if (!canUseTwilioApi()) {
    return res.status(400).json({
      error: "Twilio test-call not configured",
      message:
        "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_NUMBER to use /api/twilio/test-call.",
    });
  }

  const toNumber = req.body?.to ? String(req.body.to).trim() : "";
  if (!isValidCallerNumber(toNumber)) {
    return res.status(400).json({
      error: "Invalid to",
      message: "Body must include { to: '+1XXXXXXXXXX' } (digits and optional leading +).",
    });
  }

  const base = `${req.protocol}://${req.get("host")}`;
  const statusCb = `${base}/twilio/status`;
  const twimlUrl = `${base}/twilio/outbound`;

  try {
    const result = await createTwilioTestCall({
      toNumber,
      statusCallbackUrl: statusCb,
      twimlUrl,
    });
    return res.json({
      ok: true,
      callSid: result?.sid || null,
      status: result?.status || null,
      to: result?.to || null,
      from: result?.from || null,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to create test call",
      message: e?.message || "Unknown error",
    });
  }
});

// Twilio: voice webhook (A call comes in)
app.post("/twilio/voice", requireTwilioAuth, (req, res) => {
  const callSid = req.body?.CallSid ? String(req.body.CallSid).trim() : "";
  const from = req.body?.From ? String(req.body.From).trim() : "";
  const to = req.body?.To ? String(req.body.To).trim() : "";
  const callStatus = req.body?.CallStatus ? String(req.body.CallStatus).trim() : "";
  const direction = req.body?.Direction ? String(req.body.Direction).trim() : "";

  try {
    // Initial voice webhook doesn't tell us if a human answered a forwarded call yet.
    // We'll refine on /twilio/status if forwarding is enabled.
    upsertTwilioEvent({
      callSid,
      from,
      to,
      callStatus,
      dialCallStatus: "",
      direction,
      callDurationSec: parseTwilioSeconds(req.body?.CallDuration),
      dialCallDurationSec: parseTwilioSeconds(req.body?.DialCallDuration),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Twilio voice webhook DB write failed:", e);
  }

  // If you want a “real” demo: forward the call to a real phone number.
  if (TWILIO_FORWARD_TO) {
    // Avoid the confusing test case where you call the Twilio number from the same phone you're forwarding to.
    // In that scenario the forward leg usually goes to voicemail and you hear a PIN prompt.
    if (isSamePhoneNumber(from, TWILIO_FORWARD_TO)) {
      return res
        .type("text/xml")
        .send(
          twiml(
            "<Say>Please call from a different phone to test forwarding. Goodbye.</Say><Hangup/>"
          )
        );
    }

    // Provide a status callback so we can update answered/missed based on final status.
    const statusCb = `${req.protocol}://${req.get("host")}/twilio/status`;
    return res
      .type("text/xml")
      .send(
        twiml(
          `<Dial answerOnBridge="true" timeout="20" action="${escapeXml(
            statusCb
          )}" method="POST" statusCallback="${escapeXml(
            statusCb
          )}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${escapeXml(
            TWILIO_FORWARD_TO
          )}</Dial>`
        )
      );
  }

  // Default: speak a short message and hang up (useful when testing without forwarding).
  return res
    .type("text/xml")
    .send(twiml("<Say>Thanks for calling. Goodbye.</Say><Hangup/>"));
});

// Twilio: call status callback (Call status changes)
app.post("/twilio/status", requireTwilioAuth, (req, res) => {
  const callSid = req.body?.CallSid ? String(req.body.CallSid).trim() : "";
  const from = req.body?.From ? String(req.body.From).trim() : "";
  const to = req.body?.To ? String(req.body.To).trim() : "";
  const callStatus = req.body?.CallStatus ? String(req.body.CallStatus).trim() : "";
  const dialCallStatus = req.body?.DialCallStatus
    ? String(req.body.DialCallStatus).trim()
    : "";
  const direction = req.body?.Direction ? String(req.body.Direction).trim() : "";

  try {
    upsertTwilioEvent({
      callSid,
      from,
      to,
      callStatus,
      dialCallStatus,
      direction,
      callDurationSec: parseTwilioSeconds(req.body?.CallDuration),
      dialCallDurationSec: parseTwilioSeconds(req.body?.DialCallDuration),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Twilio status webhook DB write failed:", e);
  }

  // Internal inbound email timing (hardened):
  // - If Twilio definitively classifies the call as MISSED, send immediately (exactly once).
  // - Answered call alerts are allowed to be delayed; we wait for completed to avoid early misclassification.
  try {
    const cs = String(callStatus || "").toLowerCase().trim();
    const dcs = String(dialCallStatus || "").toLowerCase().trim();
    const missedDefinitiveStatuses = new Set(["busy", "no-answer", "failed", "canceled"]);
    const definitiveMissedSignal = missedDefinitiveStatuses.has(dcs) || cs === "completed";

    if (callSid && isValidCallSid(callSid)) {
      const row = getCallEventByCallSid(callSid);
      if (row?.id) {
        if (row.source === "twilio" && row.status === "missed" && definitiveMissedSignal) {
          maybeSendInternalInboundEmail({
            req,
            eventId: row.id,
            allowNonFinalTwilioMissed: true,
          }).catch(() => { });
        } else if (row.source === "twilio" && row.status === "answered" && (cs === "completed" || dcs === "completed")) {
          maybeSendInternalInboundEmail({ req, eventId: row.id }).catch(() => { });
        }
      }
    }
  } catch { }

  // Missed-call text-back: send only on final status ("completed") and only once.
  try {
    const cs = String(callStatus || "").toLowerCase().trim();
    if (cs === "completed" && callSid && isValidCallSid(callSid)) {
      const row = getCallEventByCallSid(callSid);
      if (
        row &&
        row.source === "twilio" &&
        row.status === "missed" &&
        !row.rescueSmsSentAt &&
        isValidCallerNumber(row.callerNumber)
      ) {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const formUrl = `${baseUrl}${RESCUE_FORM_PATH.startsWith("/") ? "" : "/"}${RESCUE_FORM_PATH}`;
        const keyword = String(RESCUE_YES_KEYWORD || "YES").trim().toUpperCase();
        const smsBody = `Sorry we missed your call. Reply ${keyword} for a call back, or request here: ${formUrl} Reply STOP to opt out.`;

        if (AUTOMATION_MODE === "sms") {
          sendTwilioSms({ toNumber: row.callerNumber, body: smsBody })
            .then((msg) => {
              try {
                updateRescueSmsSent({
                  callEventId: row.id,
                  sentAtIso: new Date().toISOString(),
                  smsSid: msg?.sid || null,
                  smsBody,
                });
              } catch { }
            })
            .catch((e) => {
              // eslint-disable-next-line no-console
              console.warn("Missed-call SMS send failed:", e?.message || e);
            });
        } else {
          insertAutomationEvent({
            callEventId: row.id,
            kind: "sms_rescue_scheduled",
            dedupeKey: `sms_rescue_scheduled:${row.id}`,
            payload: { to: row.callerNumber, body: smsBody, mode: AUTOMATION_MODE },
          });
        }
      }
    }
  } catch { }

  return res.status(204).end();
});

// Twilio: inbound SMS webhook (Messaging)
// Configure: Twilio Console → Phone Numbers → (your number) → Messaging → "A message comes in"
app.post("/twilio/sms", requireTwilioAuth, (req, res) => {
  const from = req.body?.From ? String(req.body.From).trim() : "";
  const to = req.body?.To ? String(req.body.To).trim() : "";
  const body = req.body?.Body ? String(req.body.Body) : "";

  const fromNorm = normalizeCallerNumber(from);
  const msgBody = String(body || "").trim();
  const keyword = String(RESCUE_YES_KEYWORD || "YES").trim().toUpperCase();
  const upper = msgBody.toUpperCase();
  const isYes = upper === keyword || upper === "Y";

  try {
    const row = getMostRecentCallEventForCaller(fromNorm);
    if (row?.id) {
      updateRescueInbound({
        callEventId: row.id,
        inboundAtIso: new Date().toISOString(),
        inboundBody: msgBody,
        yesAtIso: isYes ? new Date().toISOString() : null,
      });

      if (isYes) {
        if (AUTOMATION_MODE === "sms") {
          if (TWILIO_FORWARD_TO) {
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            createTwilioRescueCallbackCall({
              toNumber: TWILIO_FORWARD_TO,
              leadNumber: fromNorm,
              baseUrl,
            })
              .then((call) => {
                try {
                  updateRescueCallbackPlaced({
                    callEventId: row.id,
                    placedAtIso: new Date().toISOString(),
                    callSid: call?.sid || null,
                  });
                } catch { }
              })
              .catch((e) => {
                // eslint-disable-next-line no-console
                console.warn("Rescue callback call failed:", e?.message || e);
              });
          } else {
            insertAutomationEvent({
              callEventId: row.id,
              kind: "rescue_yes_received_no_forward_to",
              dedupeKey: `rescue_yes_received_no_forward_to:${row.id}`,
              payload: { from: fromNorm, to, body: msgBody },
            });
          }
        } else {
          insertAutomationEvent({
            callEventId: row.id,
            kind: "rescue_yes_received",
            dedupeKey: `rescue_yes_received:${row.id}`,
            payload: { from: fromNorm, to, body: msgBody, mode: AUTOMATION_MODE },
          });
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Inbound SMS processing failed:", e?.message || e);
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const formUrl = `${baseUrl}${RESCUE_FORM_PATH.startsWith("/") ? "" : "/"}${RESCUE_FORM_PATH}`;
  const reply = isYes
    ? "Got it. We’re calling you back now."
    : `Thanks—reply ${keyword} for a call back, or request here: ${formUrl}`;

  return res.type("text/xml").send(twiml(`<Message>${escapeXml(reply)}</Message>`));
});

// Twilio: callback bridge TwiML (used by createTwilioRescueCallbackCall)
app.post("/twilio/rescue-callback", requireTwilioAuth, (req, res) => {
  const leadRaw = req.query?.lead ? String(req.query.lead).trim() : "";
  const lead = normalizeCallerNumber(leadRaw);
  if (!isValidCallerNumber(lead)) {
    return res.type("text/xml").send(twiml("<Say>Invalid lead number.</Say><Hangup/>"));
  }
  return res
    .type("text/xml")
    .send(
      twiml(
        `<Say>Connecting you to a missed call lead.</Say><Dial answerOnBridge="true" timeout="20"><Number>${escapeXml(
          lead
        )}</Number></Dial>`
      )
    );
});

// API: create event (webhook simulator)
app.post("/api/webhooks/call", requireDemoAuth, requireSimulatorEnabled, (req, res) => {
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

  try {
    ensureSlaDefaultsForEventId(insert.lastInsertRowid);
    insertAutomationEvent({
      callEventId: insert.lastInsertRowid,
      kind: "lead_created",
      dedupeKey: `lead_created:${insert.lastInsertRowid}`,
      payload: { source, status },
    });
  } catch { }

  const row = db
    .prepare("SELECT * FROM CallEvent WHERE id = ?")
    .get(insert.lastInsertRowid);

  return res.json(rowToJson(row));
});

// Landing: store form submissions so they appear on the dashboard.
// This is not Twilio; it's "someone filled the form instead of calling".
app.post("/api/landing/form", (req, res) => {
  const ip = clientIp(req);
  if (isRateLimited(ip)) return res.status(429).json({ error: "Too many requests" });

  // Honeypot: bots often fill a "website" field. If present, silently drop.
  const honeypot = String(req.body?.website ?? "").trim();
  if (honeypot) return res.status(204).end();

  const phoneRaw = normalizeLeadPhone(req.body?.phone);
  if (!isValidCallerNumber(phoneRaw)) {
    return res.status(400).json({
      error: "Invalid phone",
      message:
        "phone is required. Accepts formats like (443) 555-1234 or +14435551234. Must be 7-20 digits after normalization.",
    });
  }

  const createdAt = new Date().toISOString();
  const firstName = clampStr(req.body?.firstName, 60);
  const email = normalizeEmail(req.body?.email);
  const cityOrZip = clampStr(req.body?.cityOrZip, 80);
  const issue = clampStr(req.body?.issue, 80);
  const timeframe = clampStr(req.body?.timeframe, 80);

  const noteParts = [];
  if (firstName) noteParts.push(`First: ${firstName}`);
  if (email) noteParts.push(`Email: ${email}`);
  if (cityOrZip) noteParts.push(`City/ZIP: ${cityOrZip}`);
  if (issue) noteParts.push(`Issue: ${issue}`);
  if (timeframe) noteParts.push(`Timeframe: ${timeframe}`);
  const note = clampStr(noteParts.join(" • "), 500);

  const insert = db
    .prepare(
      "INSERT INTO CallEvent (createdAt, callerNumber, status, source, followedUp, note, customer_email, customer_name) VALUES (?, ?, 'missed', 'landing_form', 0, ?, ?, ?)"
    )
    .run(createdAt, phoneRaw, note || null, email || null, firstName || null);

  try {
    ensureSlaDefaultsForEventId(insert.lastInsertRowid);
    insertAutomationEvent({
      callEventId: insert.lastInsertRowid,
      kind: "lead_created",
      dedupeKey: `lead_created:${insert.lastInsertRowid}`,
      payload: { source: "landing_form", status: "missed" },
    });
  } catch { }

  const row = db
    .prepare("SELECT * FROM CallEvent WHERE id = ?")
    .get(insert.lastInsertRowid);

  // Internal alert email for every form submission.
  maybeSendInternalInboundEmail({ req, eventId: insert.lastInsertRowid }).catch(() => { });

  // Customer confirmation email (auto) if customer_email was provided.
  if (email) {
    const tpl = customerFormConfirmation({ companyName: COMPANY_NAME, companyPhone: COMPANY_PHONE });
    sendAndLogEmail({
      req,
      eventId: insert.lastInsertRowid,
      emailType: "customer_form_confirmation",
      toEmail: email,
      subject: tpl.subject,
      html: tpl.html,
    }).catch(() => { });
  }

  return res.json(rowToJson(row));
});

// API: list recent calls
app.get("/api/calls", requireDemoAuth, (req, res) => {
  const rawLimit = req.query?.limit ? Number(req.query.limit) : 50;
  const rows = listEventsWithFollowupCount(rawLimit);
  return res.json(rows.map(rowToJson));
});

// API: list recent events (Lead Truth Ledger)
app.get("/api/events", requireDemoAuth, (req, res) => {
  const rawLimit = req.query?.limit ? Number(req.query.limit) : 50;
  const rows = listEventsWithFollowupCount(rawLimit);
  return res.json(rows.map(rowToJson));
});

// API: dashboard config (operator UX)
app.get("/api/config", requireDemoAuth, (_req, res) => {
  return res.json({
    ownerOptions: OWNER_OPTIONS_LIST,
  });
});

// API: followups list
app.get("/api/followups", requireDemoAuth, (req, res) => {
  const eventId = Number(req.query?.event_id);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: "Invalid event_id" });
  const rows = db
    .prepare("SELECT * FROM followups WHERE event_id = ? ORDER BY created_at ASC")
    .all(eventId);
  return res.json(
    rows.map((r) => ({
      id: r.id,
      event_id: r.event_id,
      action_type: r.action_type,
      note: r.note ?? null,
      created_at: r.created_at,
    }))
  );
});

function isValidFollowupType(t) {
  return (
    t === "call_attempt" ||
    t === "voicemail_left" ||
    t === "text_sent" ||
    t === "spoke_to_customer" ||
    t === "note"
  );
}

function followupSetsHandledAt(actionType) {
  const t = String(actionType || "").trim();
  return t === "call_attempt" || t === "voicemail_left" || t === "text_sent" || t === "spoke_to_customer";
}

// API: create followup
app.post("/api/followups", requireDemoAuth, (req, res) => {
  const eventId = Number(req.body?.event_id);
  const actionType = req.body?.action_type ? String(req.body.action_type).trim() : "";
  const note = clampStr(req.body?.note, 800) || null;
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: "Invalid event_id" });
  if (!isValidFollowupType(actionType)) {
    return res.status(400).json({
      error: "Invalid action_type",
      message: "action_type must be one of: call_attempt, voicemail_left, text_sent, spoke_to_customer, note",
    });
  }

  const now = Date.now();
  const row = getCallEventById(eventId);
  if (!row) return res.status(404).json({ error: "Not found" });

  db.exec("BEGIN");
  try {
    // Double-click dedupe: if last followup was < 10s ago, reject (server-side guard).
    const last = db
      .prepare("SELECT created_at FROM followups WHERE event_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(eventId);
    const lastMs = last && typeof last.created_at === "number" ? last.created_at : null;
    if (Number.isFinite(lastMs) && now - lastMs < 10_000) {
      db.exec("ROLLBACK");
      return res.status(409).json({
        error: "Duplicate follow-up prevented",
        message: "A follow-up was already recorded moments ago. Please wait a few seconds and try again.",
      });
    }

    const ins = db
      .prepare("INSERT INTO followups (event_id, action_type, note, created_at) VALUES (?, ?, ?, ?)")
      .run(eventId, actionType, note, now);

    // Follow-ups no longer mark the lead as handled; handled_at is set only when Result is set.

    db.exec("COMMIT");

    const countRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM followups WHERE event_id = ?")
      .get(eventId);

    return res.json({
      ok: true,
      followup: {
        id: ins.lastInsertRowid,
        event_id: eventId,
        action_type: actionType,
        note,
        created_at: now,
      },
      followup_count: Number(countRow?.cnt || 0),
    });
  } catch (e) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to create followup", message: e?.message || "Unknown error" });
  }
});

// API: set owner (new canonical field)
app.post("/api/owner", requireDemoAuth, (req, res) => {
  const eventId = Number(req.body?.event_id);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: "Invalid event_id" });
  const ownerRaw = req.body?.owner;
  const owner = ownerRaw === null ? null : clampStr(ownerRaw, 80) || null;

  const nowIso = new Date().toISOString();
  const shouldSetFirstAction = !!(owner && String(owner).trim());
  const result = db
    .prepare(
      `
      UPDATE CallEvent
      SET owner = ?,
          first_action_at = CASE
            WHEN first_action_at IS NULL AND ? = 1 THEN ?
            ELSE first_action_at
          END
      WHERE id = ?
    `.trim()
    )
    .run(owner, shouldSetFirstAction ? 1 : 0, nowIso, eventId);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true, event: rowToJson(getCallEventWithFollowupCountById(eventId)) });
});

function isValidNextStep(v) {
  const s = String(v || "").trim();
  // Keep this aligned with the dropdown in dashboard.js.
  return (
    s === "call_attempt" ||
    s === "voicemail_left" ||
    s === "text_sent" ||
    s === "spoke_to_customer" ||
    s === "note"
  );
}

// API: set next step (operator workflow)
app.post("/api/next_step", requireDemoAuth, (req, res) => {
  const eventId = Number(req.body?.event_id);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: "Invalid event_id" });
  const raw = req.body?.next_step;
  const nextStep = raw === null ? null : clampStr(raw, 40) || null;
  if (nextStep !== null && !isValidNextStep(nextStep)) {
    return res.status(400).json({
      error: "Invalid next_step",
      message: "next_step must be one of: call_attempt, voicemail_left, text_sent, spoke_to_customer, note",
    });
  }

  const nowIso = new Date().toISOString();
  const shouldSetFirstAction = !!(nextStep && String(nextStep).trim());
  const result = db
    .prepare(
      `
      UPDATE CallEvent
      SET next_step = ?,
          first_action_at = CASE
            WHEN first_action_at IS NULL AND ? = 1 THEN ?
            ELSE first_action_at
          END
      WHERE id = ?
    `.trim()
    )
    .run(nextStep, shouldSetFirstAction ? 1 : 0, nowIso, eventId);

  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true, event: rowToJson(getCallEventWithFollowupCountById(eventId)) });
});

// API: set result/outcome (ledger-stamped)
app.post("/api/result", requireDemoAuth, (req, res) => {
  const eventId = Number(req.body?.event_id);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: "Invalid event_id" });
  const outcome = normalizeOutcome(req.body?.result);
  if (typeof outcome === "undefined") {
    return res.status(400).json({ error: "Invalid result", message: "Body must include { event_id, result }" });
  }
  if (outcome !== null && !isValidOutcome(outcome)) {
    return res.status(400).json({ error: "Invalid result", message: "result is not an allowed outcome" });
  }

  const row = getCallEventById(eventId);
  if (!row) return res.status(404).json({ error: "Not found" });

  const nowIso = new Date().toISOString();

  if (outcome === null) {
    db.prepare(
      "UPDATE CallEvent SET outcome = NULL, outcomeAt = NULL, outcome_set_at = NULL, handled_at = NULL WHERE id = ?"
    ).run(eventId);
  } else {
    db.prepare(
      `
      UPDATE CallEvent
      SET outcome = ?,
          outcomeAt = ?,
          outcome_set_at = COALESCE(outcome_set_at, ?),
          handled_at = ?,
          first_action_at = COALESCE(first_action_at, ?)
      WHERE id = ?
    `.trim()
    ).run(outcome, nowIso, nowIso, nowIso, nowIso, eventId);
  }

  return res.json({ ok: true, event: rowToJson(getCallEventWithFollowupCountById(eventId)) });
});

// API: email logs for timeline
app.get("/api/email_logs", requireDemoAuth, (req, res) => {
  const eventId = req.query?.event_id ? Number(req.query.event_id) : null;
  const rows = eventId
    ? db
      .prepare("SELECT * FROM email_logs WHERE event_id = ? ORDER BY created_at ASC")
      .all(eventId)
    : db.prepare("SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 100").all();
  return res.json(
    rows.map((r) => ({
      id: r.id,
      event_id: r.event_id ?? null,
      email_type: r.email_type,
      to_email: r.to_email,
      status: r.status,
      provider: r.provider,
      provider_message_id: r.provider_message_id ?? null,
      error_text: r.error_text ?? null,
      created_at: r.created_at,
    }))
  );
});

// API: booking confirmation email intentionally disabled (feature removed from UI).
app.post("/api/send_booking_confirmation", requireDemoAuth, async (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: "Disabled",
    message: "Booking confirmation email has been removed.",
  });
});

// API: test email (logs receipt)
app.post("/api/test_email", requireDemoAuth, async (req, res) => {
  if (!OWNER_ALERT_EMAIL || !String(OWNER_ALERT_EMAIL).trim()) {
    return res.status(400).json({ error: "OWNER_ALERT_EMAIL not set" });
  }
  const subject = "Lead Truth Ledger test email";
  const html = internalEmailHtml({
    title: subject,
    lines: ["This is a test email from the HVAC Lead Truth Ledger."],
    dashboardUrl: DASHBOARD_URL,
  });
  const result = await sendAndLogEmail({
    req,
    eventId: null,
    emailType: "test",
    toEmail: OWNER_ALERT_EMAIL,
    subject,
    html,
  });
  return res.json({ ok: result.ok, receipt: result });
});

// API: assign owner
app.post("/api/calls/:id/assign", requireDemoAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const assignedToRaw = req.body?.assignedTo;
  const assignedTo =
    assignedToRaw === null ? null : clampStr(assignedToRaw, 60) || null;

  const result = db.prepare("UPDATE CallEvent SET assignedTo = ? WHERE id = ?").run(assignedTo, id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  const row = getCallEventById(id);
  return res.json(rowToJson(row));
});

// API: run automation pass (demo-safe; logs events instead of sending)
app.post("/api/automation/run", requireDemoAuth, (req, res) => {
  try {
    const result = runAutomationPass();
    return res.json(result);
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Automation failed", message: e?.message || "Unknown error" });
  }
});

// API: recent automation events
app.get("/api/automation/events", requireDemoAuth, (req, res) => {
  const rawLimit = req.query?.limit ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(200, Math.floor(rawLimit)))
    : 50;

  const rows = db
    .prepare("SELECT * FROM AutomationEvent ORDER BY createdAt DESC LIMIT ?")
    .all(limit);
  const json = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    callEventId: r.callEventId ?? null,
    kind: r.kind,
    status: r.status,
    payload: (() => {
      try {
        return r.payload ? JSON.parse(r.payload) : null;
      } catch {
        return r.payload ?? null;
      }
    })(),
  }));
  return res.json(json);
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

  const row = getCallEventById(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const confirmUnresolved = String(req.query?.confirm_unresolved || "").trim() === "true";
  const unresolved = !row.outcome;
  if (unresolved && !confirmUnresolved) {
    return res.status(400).json({
      error: "Unresolved lead",
      message: "This lead has no Result. Pass ?confirm_unresolved=true to delete anyway.",
    });
  }

  const result = db.prepare("DELETE FROM CallEvent WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

// API: delete single event (alias)
app.delete("/api/events/:id", requireDemoAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const row = getCallEventById(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const confirmUnresolved = String(req.query?.confirm_unresolved || "").trim() === "true";
  if (!row.outcome && !confirmUnresolved) {
    return res.status(400).json({
      error: "Unresolved lead",
      message: "This lead has no Result. Pass ?confirm_unresolved=true to delete anyway.",
    });
  }
  db.prepare("DELETE FROM CallEvent WHERE id = ?").run(id);
  return res.json({ ok: true });
});

// API: clear all call events (demo cleanup)
app.post("/api/calls/clear", requireDemoAuth, (req, res) => {
  const confirmUnresolved = String(req.query?.confirm_unresolved || "").trim() === "true";
  const unresolvedCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM CallEvent WHERE outcome IS NULL OR TRIM(outcome) = ''")
    .get()?.cnt;
  if (!confirmUnresolved && Number(unresolvedCount || 0) > 0) {
    return res.status(400).json({
      error: "Unresolved leads exist",
      message: "Pass ?confirm_unresolved=true to clear anyway.",
      unresolved_count: Number(unresolvedCount || 0),
    });
  }
  db.exec("DELETE FROM CallEvent");
  return res.json({ ok: true });
});

// API: clear all events (alias)
app.post("/api/clear_all", requireDemoAuth, (req, res) => {
  const confirmUnresolved = String(req.query?.confirm_unresolved || "").trim() === "true";
  const unresolvedCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM CallEvent WHERE outcome IS NULL OR TRIM(outcome) = ''")
    .get()?.cnt;
  if (!confirmUnresolved && Number(unresolvedCount || 0) > 0) {
    return res.status(400).json({
      error: "Unresolved leads exist",
      message: "Pass ?confirm_unresolved=true to clear anyway.",
      unresolved_count: Number(unresolvedCount || 0),
    });
  }
  db.exec("DELETE FROM CallEvent");
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ HVAC demo server running: http://127.0.0.1:${PORT}`);
  if (!DEMO_KEY) {
    // eslint-disable-next-line no-console
    console.log(
      "ℹ️  DEMO_KEY is not set. Localhost access is allowed, but public access is disabled until you set DEMO_KEY."
    );
  }
  if (!TWILIO_AUTH_TOKEN && TWILIO_VALIDATE_SIGNATURE) {
    // eslint-disable-next-line no-console
    console.log(
      "⚠️  TWILIO_AUTH_TOKEN is not set. /twilio/* webhooks will NOT be signature-verified."
    );
  }

  // Overdue escalation emails (Lead Truth Ledger)
  setInterval(() => {
    runOverdueEmailPass().catch(() => { });
  }, 60_000);
});


