function $(sel, root = document) {
  return root.querySelector(sel);
}

function showToast(message, type = "ok") {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.hidden = true;
  }, 2500);
}

function getKey() {
  const url = new URL(window.location.href);
  const q = url.searchParams.get("key");
  return q || localStorage.getItem("hvac_demo_key") || "";
}

function withKey(urlPath) {
  const key = getKey();
  const url = new URL(urlPath, window.location.origin);
  if (key) url.searchParams.set("key", key);
  return url.toString();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(iso) {
  // Keep the table compact (video-friendly). Put full timestamp in the cell title.
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(iso || "");
  }
}

function formatTimeFull(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso || "");
  }
}

function formatTimeShort(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return "";
  }
}

function formatSource(source) {
  const sourceMap = {
    simulator: { label: "Demo", color: "#6366f1" },
    landing_call_click: { label: "Call click", color: "#8b5cf6" },
    landing_form: { label: "Form submit", color: "#0ea5e9" },
    twilio: { label: "Inbound call", color: "#10b981" },
  };
  return sourceMap[source] || { label: source || "Unknown", color: "#94a3b8" };
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s)) return "—";
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const rem = total % 60;
  if (m <= 0) return `${rem}s`;
  if (rem === 0) return `${m}m`;
  return `${m}m ${rem}s`;
}

function formatLocalDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso || "");
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Escape if it contains characters that would break CSV
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function buildCsv(rows, headers) {
  const headerLine = headers.map((h) => csvEscape(h.label)).join(",");
  const lines = rows.map((r) =>
    headers.map((h) => csvEscape(h.get(r))).join(",")
  );
  return [headerLine, ...lines].join("\r\n") + "\r\n";
}

function downloadTextFile({ filename, text, mimeType }) {
  const blob = new Blob([text], { type: mimeType || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick to avoid revoking before download starts in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function filenameTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}${min}`;
}

function formatCallerForExcel(raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";

  // If it's basically a phone number, force Excel to treat it as text to avoid 1.44E+10 formatting.
  // Using a formula returning a string is the most reliable: ="+14435551234"
  const digits = s.replace(/[^\d+]/g, "");
  if (/^\+?\d{7,20}$/.test(digits)) {
    const e164ish = digits.startsWith("+") ? digits : `+${digits}`;
    return `="${e164ish}"`;
  }

  return s;
}

const OUTCOME_OPTIONS = [
  { value: "", label: "Set result…", displayLabel: "Set result…", color: "#94a3b8" },
  { value: "booked", label: "Booked", displayLabel: "Booked", color: "#16a34a" },
  { value: "reached_no_booking", label: "Contacted (no booking)", displayLabel: "Contacted (no booking)", color: "#f59e0b" },
  { value: "no_answer", label: "No answer", displayLabel: "No answer", color: "#94a3b8" },
  { value: "already_hired", label: "Already hired", displayLabel: "Already hired", color: "#dc2626" },
  { value: "wrong_number", label: "Wrong number/spam", displayLabel: "Wrong number/spam", color: "#dc2626" },
  { value: "call_back_later", label: "Call back later", displayLabel: "Call back later", color: "#f59e0b" },
];

const NEXT_STEP_OPTIONS = [
  { value: "", label: "Set next step…" },
  { value: "call_attempt", label: "Call attempt" },
  { value: "voicemail_left", label: "Leave voicemail" },
  { value: "text_sent", label: "Send text" },
  { value: "spoke_to_customer", label: "Spoke to customer" },
  { value: "note", label: "Note" },
];

let autoRefreshIntervalId = null;
let resumeTimerId = null;
let inFlight = false;
let pausedUntil = 0;
let eventsCache = [];
let lastFetchAtMs = 0;
let agoTickerId = null;
let mutationEpoch = 0;
const mutatingIds = new Set();
let isInteracting = false;
const editingOutcomeIds = new Set();
let ownerOptions = null;
const DEFAULT_OWNER_OPTIONS = ["Cody", "Sam", "Alex"];
const expandedDetailsIds = new Set();

function getCallerDetailsText(ev) {
  // Keep the main grid compact. Details are accessible via an expandable sub-row.
  if (String(ev?.source || "") !== "landing_form") return "";
  return ev?.note ? String(ev.note) : "";
}

function nextStepLabel(value) {
  const v = String(value || "").trim();
  const opt = NEXT_STEP_OPTIONS.find((o) => o.value === v);
  return opt ? opt.label : v || "—";
}

function formatOutcomeResponse(ev) {
  const ms = computeOutcomeResponseMs(ev);
  if (!Number.isFinite(ms)) return null;
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;

  // <48h => "3h 12m"
  if (totalHours < 48) {
    return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  }

  // >=48h => "2d 1h"
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

// Follow-up UI intentionally removed.
let followupModalEventId = null;
let timelineEventId = null;

function applyDemoFilter(events) {
  const rows = Array.isArray(events) ? events : [];
  // Client-ready: never show demo/simulator-generated rows in the customer dashboard/export.
  return rows.filter((e) => e?.source !== "simulator");
}

function parseIsoMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : null;
}

function computeResponseSeconds(ev) {
  if (typeof ev?.responseSeconds === "number" && Number.isFinite(ev.responseSeconds)) {
    return ev.responseSeconds;
  }
  return null;
}

function computeOutcomeResponseMs(ev) {
  // Response time (truth ledger) = time-to-outcome (outcome_set_at - createdAt).
  // Only meaningful when outcome exists.
  const hasOutcome = !!(ev?.outcome && String(ev.outcome).trim());
  if (!hasOutcome) return null;
  const createdMs = getCreatedAtMs(ev);
  const outcomeIso = ev?.outcome_set_at
    ? String(ev.outcome_set_at).trim()
    : ev?.outcomeAt
      ? String(ev.outcomeAt).trim()
      : "";
  const outcomeMs = outcomeIso ? parseIsoMs(outcomeIso) : null;
  if (!Number.isFinite(createdMs) || !Number.isFinite(outcomeMs)) return null;
  return Math.max(0, Number(outcomeMs) - Number(createdMs));
}

function getCallLengthSeconds(ev) {
  if (typeof ev?.dialCallDurationSec === "number") return ev.dialCallDurationSec;
  if (typeof ev?.callDurationSec === "number") return ev.callDurationSec;
  return null;
}

function getOutcomeOption(outcomeValue) {
  const v = outcomeValue ? String(outcomeValue) : "";
  return OUTCOME_OPTIONS.find((o) => o.value === v) || OUTCOME_OPTIONS[0];
}

function getDisplayStatus(ev) {
  const state = getLeadState(ev);
  return {
    statusClass: state?.state || "",
    statusLabel: state?.label || "",
  };
}

function setLastFetch(date) {
  if (!date) {
    lastFetchAtMs = 0;
    return;
  }
  lastFetchAtMs = date.getTime();
}

function setUpdatedAgoText() {
  const el = $("#updatedAgo");
  if (!el) return;
  if (!lastFetchAtMs) {
    el.textContent = "—";
    return;
  }
  const s = Math.max(0, Math.floor((Date.now() - lastFetchAtMs) / 1000));
  if (s < 5) {
    el.textContent = "just now";
    return;
  }
  if (s < 60) {
    el.textContent = `${s}s ago`;
    return;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    el.textContent = `${m} min ago`;
    return;
  }
  const h = Math.floor(m / 60);
  el.textContent = `${h} hr ago`;
}

function startAgoTicker() {
  if (agoTickerId) clearInterval(agoTickerId);
  agoTickerId = setInterval(setUpdatedAgoText, 1000);
  setUpdatedAgoText();
}

function stopAutoRefresh() {
  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = null;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (document.visibilityState !== "visible") return;

  autoRefreshIntervalId = setInterval(() => {
    // Avoid spamming if tab gets hidden without firing visibilitychange yet
    if (document.visibilityState !== "visible") return;
    // Respect temporary pause (e.g. during follow-up)
    if (Date.now() < pausedUntil) return;
    // Avoid overwriting UI while a mutation is being saved.
    if (mutatingIds.size > 0) return;
    // Avoid overwriting UI while user is interacting with controls
    if (isInteracting) return;
    loadCalls({ silent: true });
  }, 10_000);
}

function pauseAutoRefresh(ms) {
  const until = Date.now() + Number(ms || 0);
  pausedUntil = Math.max(pausedUntil, until);

  // Stop interval while paused to ensure no mid-action refresh; resume after delay if visible.
  stopAutoRefresh();
  if (resumeTimerId) clearTimeout(resumeTimerId);
  resumeTimerId = setTimeout(() => {
    resumeTimerId = null;
    if (document.visibilityState === "visible") startAutoRefresh();
  }, ms);
}

async function fetchCalls() {
  const key = getKey();
  const res = await fetch(withKey("/api/events?limit=50"), {
    headers: { ...(key ? { "x-demo-key": key } : {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }

  if (!res.ok) throw new Error(json.message || "Failed to load calls");
  return json;
}

async function fetchDashboardConfig() {
  const key = getKey();
  const res = await fetch(withKey("/api/config"), {
    headers: { ...(key ? { "x-demo-key": key } : {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to load config");
  return json;
}

async function setResult(id, result) {
  const key = getKey();
  const res = await fetch(withKey(`/api/result`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-demo-key": key } : {}),
    },
    body: JSON.stringify({ event_id: Number(id), result }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to set result");
  return json;
}

async function deleteCall(id, { confirmUnresolved } = {}) {
  const key = getKey();
  const url = new URL(withKey(`/api/events/${encodeURIComponent(id)}`));
  if (confirmUnresolved) url.searchParams.set("confirm_unresolved", "true");
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { ...(key ? { "x-demo-key": key } : {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to delete");
  return json;
}

async function clearAll({ confirmUnresolved } = {}) {
  const key = getKey();
  const url = new URL(withKey("/api/clear_all"));
  if (confirmUnresolved) url.searchParams.set("confirm_unresolved", "true");
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { ...(key ? { "x-demo-key": key } : {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to clear");
  return json;
}

// Follow-up API UI intentionally removed.

async function apiSetOwner({ eventId, owner }) {
  const key = getKey();
  const res = await fetch(withKey("/api/owner"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-demo-key": key } : {}),
    },
    body: JSON.stringify({ event_id: Number(eventId), owner }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to set owner");
  return json;
}

async function apiSetNextStep({ eventId, nextStep }) {
  const key = getKey();
  const res = await fetch(withKey("/api/next_step"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-demo-key": key } : {}),
    },
    body: JSON.stringify({ event_id: Number(eventId), next_step: nextStep }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to set next step");
  return json;
}

async function apiGetEmailLogs(eventId) {
  const key = getKey();
  const url = new URL(withKey("/api/email_logs"));
  url.searchParams.set("event_id", String(eventId));
  const res = await fetch(url.toString(), { headers: { ...(key ? { "x-demo-key": key } : {}) } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to load email logs");
  return json;
}

// Booking confirmation email intentionally removed.

function exportVisibleRowsToCsv() {
  const visible = applyDemoFilter(eventsCache);
  if (!Array.isArray(visible) || visible.length === 0) {
    showToast("Nothing to export (no rows match the current filter)", "bad");
    return;
  }

  const headers = [
    { label: "Created At (ISO)", get: (ev) => ev?.createdAt || "" },
    { label: "Created At (Local)", get: (ev) => formatLocalDateTime(ev?.createdAt) },
    { label: "Caller", get: (ev) => formatCallerForExcel(ev?.callerNumber) },
    { label: "Details / Note", get: (ev) => ev?.note || "" },
    { label: "Status", get: (ev) => getDisplayStatus(ev).statusLabel || "" },
    { label: "Call Length (sec)", get: (ev) => {
        const s = getCallLengthSeconds(ev);
        return typeof s === "number" && Number.isFinite(s) ? String(Math.max(0, Math.floor(s))) : "";
      }
    },
    { label: "Call Length", get: (ev) => {
        const s = getCallLengthSeconds(ev);
        return typeof s === "number" && Number.isFinite(s) ? formatDuration(s) : "";
      }
    },
    { label: "Type", get: (ev) => formatSource(ev?.source).label },
    { label: "Response Time (sec)", get: (ev) => {
        const rs = computeResponseSeconds(ev);
        return typeof rs === "number" && Number.isFinite(rs) ? String(rs) : "";
      }
    },
    { label: "Response Time", get: (ev) => {
        const rs = computeResponseSeconds(ev);
        return typeof rs === "number" && Number.isFinite(rs) ? formatDuration(rs) : "";
      }
    },
    { label: "Result", get: (ev) => getOutcomeOption(ev?.outcome).label || "" },
    { label: "Result At (ISO)", get: (ev) => ev?.outcomeAt || "" },
    { label: "Result At (Local)", get: (ev) => formatLocalDateTime(ev?.outcomeAt) },
    { label: "Followed Up", get: (ev) => (ev?.followedUp ? "yes" : "no") },
    { label: "Followed Up At (ISO)", get: (ev) => ev?.followedUpAt || "" },
    { label: "Source (raw)", get: (ev) => ev?.source || "" },
    { label: "Status (raw)", get: (ev) => ev?.status || "" },
    { label: "Outcome (raw)", get: (ev) => ev?.outcome || "" },
  ];

  // Add UTF-8 BOM so Excel reliably opens as UTF-8 (helps with symbols like "≤").
  const csv = "\ufeff" + buildCsv(visible, headers);
  const filename = `opportunity-visibility_${filenameTimestamp(new Date())}.csv`;
  downloadTextFile({ filename, text: csv, mimeType: "text/csv;charset=utf-8" });
  showToast(`Exported ${visible.length} row(s)`, "ok");
}

function setSummary(events) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  // Lead Truth Ledger
  // Unhandled = no outcome AND no first action yet (owner/next step/result).
  const unhandled = events.filter((e) => !e?.outcome && !(e?.first_action_at && String(e.first_action_at).trim())).length;
  // Followed up (aka "in progress") = no outcome AND has first action.
  const followedUp = events.filter((e) => !e?.outcome && (e?.first_action_at && String(e.first_action_at).trim())).length;
  const booked = events.filter((e) => e.outcome === "booked").length;
  const lost = events.filter((e) => {
    if (e.outcome === "already_hired" || e.outcome === "wrong_number") return true;
    if (e.outcome === "no_answer" && typeof e?.handled_at === "number") return true;
    return false;
  }).length;

  set("sumMissed", unhandled);
  set("sumFollowedUp", followedUp);
  set("sumBooked", booked);
  set("sumLost", lost);
}

function formatAutomationKind(kind) {
  const k = String(kind || "").trim();
  if (k === "escalated") {
    return { title: "Escalated", pill: "Escalated", pillClass: "automation-item__pill--danger" };
  }
  if (k === "lead_created") {
    return { title: "Lead created", pill: "New", pillClass: "" };
  }
  return { title: k || "Event", pill: "Event", pillClass: "" };
}

// Automation log UI removed (keeps backend behavior unchanged; just not shown).

function minutesBetweenMs(a, b) {
  const d = Number(b) - Number(a);
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.floor(d / 60000));
}

function getCreatedAtMs(ev) {
  const ms = parseIsoMs(ev?.createdAt);
  return Number.isFinite(ms) ? ms : null;
}

function getLeadState(ev) {
  // 3-state owner-friendly truth ledger:
  // - Unhandled (RED): outcome is null AND first_action_at is null
  // - In progress (YELLOW): outcome is null AND first_action_at exists
  // - Closed (GREEN): outcome exists
  const hasOutcome = !!(ev?.outcome && String(ev.outcome).trim());
  if (hasOutcome) return { state: "closed", label: "Closed", cls: "pill pill--ok", overdue: false };

  const hasFirstAction = !!(ev?.first_action_at && String(ev.first_action_at).trim());
  if (hasFirstAction) return { state: "in_progress", label: "In progress", cls: "pill pill--warn", overdue: false };

  const isOverdue = !!ev?.overdue;
  return { state: "unhandled", label: "Unhandled", cls: "pill pill--danger", overdue: isOverdue };
}

function buildStatusCell(ev) {
  const state = getLeadState(ev);
  const overdueMinutes =
    typeof ev?.overdue_minutes === "number" && Number.isFinite(ev.overdue_minutes)
      ? Math.max(0, Math.floor(ev.overdue_minutes))
      : null;
  const overdueBadge =
    state.state === "unhandled" && state.overdue
      ? `<span class="overdue-badge" aria-label="Overdue" title="${escapeHtml(
          overdueMinutes === null ? "Overdue" : `Overdue: ${overdueMinutes}m`
        )}">Overdue</span>`
      : "";
  return `<div class="status-stack"><span class="${escapeHtml(state.cls)}">${escapeHtml(
    state.label
  )}</span>${overdueBadge}</div>`;
}

function buildOwnerCell(ev) {
  const current = ev?.owner ? String(ev.owner) : "";
  const opts = Array.isArray(ownerOptions) && ownerOptions.length ? ownerOptions : DEFAULT_OWNER_OPTIONS;

  const normalized = opts
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const unique = Array.from(new Set(normalized));
  const hasCurrentInList = current && unique.includes(current);
  const all = hasCurrentInList || !current ? unique : [current, ...unique];

  const optionsHtml = [
    `<option value="">${escapeHtml("Owner…")}</option>`,
    ...all.map((name) => {
      const selected = name === current ? "selected" : "";
      return `<option value="${escapeHtml(name)}" ${selected}>${escapeHtml(name)}</option>`;
    }),
  ].join("");

  return `<select class="owner-select js-owner-select" aria-label="Owner">${optionsHtml}</select>`;
}

function showOverlay(overlayId) {
  const el = document.getElementById(overlayId);
  if (!el) return;
  el.hidden = false;
}

function hideOverlay(overlayId) {
  const el = document.getElementById(overlayId);
  if (!el) return;
  el.hidden = true;
}

function fmtEpoch(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return String(ms);
  }
}

function buildTimelineItem({ title, time, body, className }) {
  const t = title ? String(title) : "Event";
  const tm = time ? String(time) : "";
  const b = body ? String(body) : "";
  const cls = className ? `timeline-item ${String(className)}` : "timeline-item";
  return `
    <div class="${escapeHtml(cls)}">
      <div class="timeline-item__top">
        <div class="timeline-item__title">${escapeHtml(t)}</div>
        <div class="timeline-item__time">${escapeHtml(tm)}</div>
      </div>
      ${b ? `<div class="timeline-item__body">${escapeHtml(b)}</div>` : ""}
    </div>
  `;
}

// Follow-up modal intentionally removed.
// Timeline modal intentionally removed.

function renderRows(events) {
  const tbody = $("#rows");
  if (!tbody) return;
  const cards = $("#cards");
  if (cards) cards.hidden = false;

  if (!Array.isArray(events) || events.length === 0) {
    const hasAny = Array.isArray(eventsCache) && eventsCache.length > 0;
    const onlyDemo = hasAny && eventsCache.every((e) => e?.source === "simulator");
    const msg = onlyDemo ? `No customer events yet.` : `No events yet.`;
    tbody.innerHTML = `<tr><td colspan="9" class="muted">${escapeHtml(msg)}</td></tr>`;
    if (cards) {
      cards.innerHTML = `<div class="muted" style="padding:10px 2px;">${escapeHtml(msg)}</div>`;
    }
    return;
  }

  const tableHtml = events
    .map((ev) => {
      const sourceInfo = formatSource(ev.source);

      const callLenSec =
        typeof ev?.dialCallDurationSec === "number"
          ? ev.dialCallDurationSec
          : typeof ev?.callDurationSec === "number"
            ? ev.callDurationSec
            : null;

      const typeLabel = ev?.type_label ? String(ev.type_label) : sourceInfo.label;
      const isInboundCall = String(ev?.source || "") === "twilio";
      // Hard rule: MISSED only when inbound_call (twilio) AND call_status (status) === missed
      const isMissedInbound = isInboundCall && String(ev?.status || "") === "missed";

      const leadState = getLeadState(ev);
      const isClosed = leadState?.state === "closed";
      const hasFirstAction = !!(ev?.first_action_at && String(ev.first_action_at).trim());

      const callLenHtml = (() => {
        if (isMissedInbound) {
          const badgeClass = isClosed
            ? "call-length-badge call-length-badge--missed-handled"
            : "call-length-badge call-length-badge--missed";
          const meta = isClosed
            ? `<div class="call-length-meta muted">Handled</div>`
            : hasFirstAction
              ? `<div class="call-length-meta muted">Follow-up started</div>`
              : `<div class="call-length-meta call-length-meta--danger">Needs callback</div>`;
          return `<div class="call-length-stack"><span class="${badgeClass}">Missed</span>${meta}</div>`;
        }
        if (typeof callLenSec === "number") {
          return `<span class="call-length-mono">${escapeHtml(formatDuration(callLenSec))}</span>`;
        }
        return "—";
      })();

      const detailsText = getCallerDetailsText(ev);
      const hasDetails = !!detailsText;
      const isExpanded = expandedDetailsIds.has(String(ev.id));
      const detailsToggle = hasDetails
        ? `<button type="button" class="details-toggle js-toggle-details" aria-expanded="${isExpanded ? "true" : "false"}" aria-label="Toggle details">${isExpanded ? "Hide" : "View"}</button>`
        : "";

      const currentOutcome = ev.outcome ? String(ev.outcome) : "";
      const outcomeOption = OUTCOME_OPTIONS.find((o) => o.value === currentOutcome) || OUTCOME_OPTIONS[0];
      
      const outcomeOptionsHtml = OUTCOME_OPTIONS.map((o) => {
        const selected = o.value === currentOutcome ? "selected" : "";
        return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.displayLabel)}</option>`;
      }).join("");

      // Result UI: show a clean badge when set, and only show the dropdown when editing.
      const isEditingOutcome = editingOutcomeIds.has(String(ev.id));
      const hasOutcome = !!(currentOutcome && String(currentOutcome).trim());

      const outcomeBadgeClass = (() => {
        if (!hasOutcome) return "result-badge result-badge--muted";
        if (currentOutcome === "booked") return "result-badge result-badge--success";
        if (currentOutcome === "already_hired" || currentOutcome === "wrong_number") return "result-badge result-badge--danger";
        if (currentOutcome === "call_back_later" || currentOutcome === "reached_no_booking") return "result-badge result-badge--warning";
        if (currentOutcome === "no_answer") return "result-badge result-badge--muted";
        return "result-badge";
      })();

      const selectClass = (() => {
        let cls = "outcome-select js-outcome";
        if (currentOutcome === "booked") cls += " outcome-select--success";
        else if (currentOutcome === "already_hired" || currentOutcome === "wrong_number") cls += " outcome-select--danger";
        else if (currentOutcome === "call_back_later" || currentOutcome === "reached_no_booking") cls += " outcome-select--warning";
        else if (currentOutcome === "no_answer") cls += " outcome-select--muted";
        return cls;
      })();

      const resultControl = (() => {
        // No outcome yet: keep it calm (button) until user clicks to set.
        if (!hasOutcome && !isEditingOutcome) {
          return `<button type="button" class="result-badge result-badge--warning js-edit-outcome" aria-label="Set result">Set result</button>`;
        }

        if (isEditingOutcome) {
          return `
            <div class="result-edit">
              <select class="${escapeHtml(selectClass)}" aria-label="Set Result">
                ${outcomeOptionsHtml}
              </select>
              <a href="#" class="mini-link js-cancel-outcome" aria-label="Cancel result editing">Cancel</a>
            </div>
          `;
        }

        // Outcome set (non-editing): show a clickable badge.
        return `<button type="button" class="${escapeHtml(outcomeBadgeClass)} js-edit-outcome" aria-label="Edit result">${escapeHtml(outcomeOption.label || "Result")}</button>`;
      })();

      const statusHtml = buildStatusCell(ev);
      const ownerHtml = buildOwnerCell(ev);
      const nextStepValue = ev?.next_step ? String(ev.next_step) : "";
      const nextStepOptionsHtml = NEXT_STEP_OPTIONS.map((o) => {
        const selected = o.value === nextStepValue ? "selected" : "";
        return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
      }).join("");
      const nextStepControl = (() => {
        if (isClosed) {
          return `<span class="field-readonly muted">${escapeHtml(
            nextStepValue ? nextStepLabel(nextStepValue) : "—"
          )}</span>`;
        }
        const emptyClass = nextStepValue ? "" : " next-step-select--empty";
        const hint = nextStepValue
          ? ""
          : `<div class="next-step-hint" aria-label="Next step required">Next step required</div>`;
        return `
          <div class="next-step-stack">
            <select class="next-step-select js-next-step${emptyClass}" aria-label="Next step">${nextStepOptionsHtml}</select>
            ${hint}
            <span class="save-indicator" aria-live="polite" hidden></span>
          </div>
        `;
      })();

      const rowClass = (() => {
        if (!isMissedInbound) return "";
        if (isClosed) return "row--missed-handled";
        if (hasFirstAction) return "row--missed-followedup";
        return "row--missed-open";
      })();
      const typeHtml = `
        <div class="type-main" style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:${sourceInfo.color}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(isInboundCall ? "Inbound call" : typeLabel)}
        </div>
      `;

      const responseLabel = currentOutcome ? formatOutcomeResponse(ev) : null;
      const responseMeta = responseLabel ? `<div class="result-meta muted">Response: ${escapeHtml(responseLabel)}</div>` : "";

      const mainRow = `
        <tr data-id="${escapeHtml(ev.id)}" class="${escapeHtml(rowClass)}">
          <td title="${escapeHtml(formatTimeFull(ev.createdAt))}">${escapeHtml(formatTime(ev.createdAt))}</td>
          <td class="caller-cell">
            <a class="caller-cell__num caller-link" href="tel:${escapeHtml(String(ev.callerNumber || '').replaceAll(' ', ''))}">${escapeHtml(ev.callerNumber)}</a>
            <div class="caller-cell__meta muted">${detailsToggle}</div>
          </td>
          <td class="status-cell">${statusHtml}</td>
          <td class="call-length-cell">${callLenHtml}</td>
          <td>
            <div class="type-cell">${typeHtml}</div>
          </td>
          <td style="white-space:nowrap;">${ownerHtml}</td>
          <td class="next-step-cell" style="overflow:hidden;">
            ${nextStepControl}
          </td>
          <td style="overflow:visible;">
            ${resultControl}
            ${responseMeta}
          </td>
          <td class="actions-td" style="overflow:visible;">
            <button class="icon-btn icon-btn--danger js-delete" type="button" title="Delete" aria-label="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 3h6l1 2h5v2H3V5h5l1-2z" fill="currentColor"/>
                <path d="M6 9h12l-1 12H7L6 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M10 12v6M14 12v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </td>
        </tr>
      `;

      const detailsRow = hasDetails
        ? `
          <tr class="details-row ${isExpanded ? "" : "details-row--hidden"}" data-details-for="${escapeHtml(ev.id)}">
            <td colspan="9">
              <div class="details-panel">
                <div class="details-panel__title">Details</div>
                <div class="details-panel__body">${escapeHtml(detailsText)}</div>
              </div>
            </td>
          </tr>
        `
        : "";

      return mainRow + detailsRow;
    })
    .join("");

  tbody.innerHTML = tableHtml;

  if (cards) {
    cards.innerHTML = events
      .map((ev) => {
        const sourceInfo = formatSource(ev.source);

        const callLenSec =
          typeof ev?.dialCallDurationSec === "number"
            ? ev.dialCallDurationSec
            : typeof ev?.callDurationSec === "number"
              ? ev.callDurationSec
              : null;
        const typeLabel = ev?.type_label ? String(ev.type_label) : sourceInfo.label;
        const isInboundCall = String(ev?.source || "") === "twilio";
        const isMissedInbound = isInboundCall && String(ev?.status || "") === "missed";
        const state = getLeadState(ev);
        const isClosed = state?.state === "closed";
        const hasFirstAction = !!(ev?.first_action_at && String(ev.first_action_at).trim());
        const callLenDisplay = (() => {
          if (isMissedInbound) {
            const badgeClass = isClosed
              ? "call-length-badge call-length-badge--missed-handled"
              : "call-length-badge call-length-badge--missed";
            const meta = isClosed
              ? `<div class="call-length-meta muted">Handled</div>`
              : hasFirstAction
                ? `<div class="call-length-meta muted">Follow-up started</div>`
                : `<div class="call-length-meta call-length-meta--danger">Needs callback</div>`;
            return `<div class="call-length-stack"><span class="${badgeClass}">Missed</span>${meta}</div>`;
          }
          if (typeof callLenSec === "number") return escapeHtml(formatDuration(callLenSec));
          return "—";
        })();

        const isFormLead = ev?.source === "landing_form";
        const detailsText = isFormLead && ev.note ? String(ev.note) : "";
        const statusLabel = state?.label || "";

        const currentOutcome = ev.outcome ? String(ev.outcome) : "";
        const outcomeOption =
          OUTCOME_OPTIONS.find((o) => o.value === currentOutcome) || OUTCOME_OPTIONS[0];

        const outcomeOptionsHtml = OUTCOME_OPTIONS.map((o) => {
          const selected = o.value === currentOutcome ? "selected" : "";
          return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
        }).join("");

        const owner = ev?.owner ? String(ev.owner) : "";
        const nextStepValue = ev?.next_step ? String(ev.next_step) : "";

        const isEditingOutcome = editingOutcomeIds.has(String(ev.id));
        const hasOutcome = !!(currentOutcome && String(currentOutcome).trim());
        const outcomeBadgeClass = (() => {
          if (!hasOutcome) return "result-badge result-badge--muted";
          if (currentOutcome === "booked") return "result-badge result-badge--success";
          if (currentOutcome === "already_hired" || currentOutcome === "wrong_number") return "result-badge result-badge--danger";
          if (currentOutcome === "call_back_later" || currentOutcome === "reached_no_booking") return "result-badge result-badge--warning";
          if (currentOutcome === "no_answer") return "result-badge result-badge--muted";
          return "result-badge";
        })();

        const selectClass = (() => {
          let cls = "outcome-select js-outcome";
          if (currentOutcome === "booked") cls += " outcome-select--success";
          else if (currentOutcome === "already_hired" || currentOutcome === "wrong_number") cls += " outcome-select--danger";
          else if (currentOutcome === "call_back_later" || currentOutcome === "reached_no_booking") cls += " outcome-select--warning";
          else if (currentOutcome === "no_answer") cls += " outcome-select--muted";
          return cls;
        })();

        const resultControl = (() => {
          if (!hasOutcome && !isEditingOutcome) {
            return `<button type="button" class="result-badge result-badge--warning js-edit-outcome" aria-label="Set result">Set result</button>`;
          }
          if (isEditingOutcome) {
            return `
              <div class="result-edit">
                <select class="${escapeHtml(selectClass)}" aria-label="Set Result">
                  ${outcomeOptionsHtml}
                </select>
                <a href="#" class="mini-link js-cancel-outcome" aria-label="Cancel result editing">Cancel</a>
              </div>
            `;
          }
          return `<button type="button" class="${escapeHtml(outcomeBadgeClass)} js-edit-outcome" aria-label="Edit result">${escapeHtml(outcomeOption.label || "Result")}</button>`;
        })();

        const nextStepOptionsHtml = NEXT_STEP_OPTIONS.map((o) => {
          const selected = o.value === nextStepValue ? "selected" : "";
          return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
        }).join("");
        const nextStepSelect = (() => {
          if (isClosed) return `<span class="field-readonly muted">${escapeHtml(nextStepValue ? nextStepLabel(nextStepValue) : "—")}</span>`;
          const emptyClass = nextStepValue ? "" : " next-step-select--empty";
          const hint = nextStepValue
            ? ""
            : `<div class="next-step-hint" aria-label="Next step required">Next step required</div>`;
          return `
            <div class="next-step-stack">
              <select class="next-step-select js-next-step${emptyClass}" aria-label="Next step">${nextStepOptionsHtml}</select>
              ${hint}
            </div>
          `;
        })();

        const rowClass = (() => {
          if (!isMissedInbound) return "";
          if (isClosed) return "row--missed-handled";
          if (hasFirstAction) return "row--missed-followedup";
          return "row--missed-open";
        })();
        return `
          <div class="dashboard-card ${escapeHtml(rowClass)}" data-id="${escapeHtml(ev.id)}">
            <div class="dashboard-card__top">
              <div class="dashboard-card__meta">
                <div class="dashboard-card__time">${escapeHtml(formatTimeFull(ev.createdAt))}</div>
                <div class="dashboard-card__caller">${escapeHtml(ev.callerNumber || "")}</div>
                ${detailsText ? `<div class="dashboard-card__details">${escapeHtml(detailsText)}</div>` : ""}
                ${owner ? `<div class="muted" style="font-size:12px; margin-top:4px;">Owner: <strong>${escapeHtml(owner)}</strong></div>` : ""}
              </div>
              <div class="dashboard-card__badges">
                <span class="${escapeHtml(state.cls)}">${escapeHtml(state.label)}</span>
                <span class="source-pill" style="color:${sourceInfo.color}; white-space:nowrap;">${escapeHtml(isInboundCall ? "Inbound call" : typeLabel)}</span>
              </div>
            </div>

            <div class="dashboard-card__grid">
              <div class="dashboard-kv">
                <div class="dashboard-kv__label">Call</div>
                <div class="dashboard-kv__value dashboard-kv__value--rich">${callLenDisplay}</div>
              </div>
              <div class="dashboard-kv">
                <div class="dashboard-kv__label">Next step</div>
                <div class="dashboard-kv__value dashboard-kv__value--controls">${nextStepSelect}</div>
              </div>
              <div class="dashboard-kv">
                <div class="dashboard-kv__label">Result</div>
                <div class="dashboard-kv__value">${escapeHtml(getOutcomeOption(ev?.outcome).label || "—")}</div>
              </div>
              <div class="dashboard-kv">
                <div class="dashboard-kv__label">Status</div>
                <div class="dashboard-kv__value">${escapeHtml(statusLabel || "—")}</div>
              </div>
            </div>

            <div class="dashboard-card__actions">
              <div style="flex:1; min-width:0;">
                ${resultControl}
              </div>
              <a class="action-btn action-btn--call" href="tel:${escapeHtml(String(ev.callerNumber || '').replaceAll(' ', ''))}" title="Call back" aria-label="Call back">Call</a>
              <button class="dashboard-card__delete js-delete" type="button" title="Delete" aria-label="Delete">🗑</button>
            </div>
          </div>
        `;
      })
      .join("");
  }
}

function showRowSaveIndicator(eventId, { ok, message, ms }) {
  const tr = document.querySelector(`[data-id="${CSS.escape(String(eventId))}"]`);
  const el = tr ? tr.querySelector(".save-indicator") : null;
  if (!el) return;

  el.textContent = String(message || (ok ? "Saved" : "Failed to save"));
  el.dataset.state = ok ? "ok" : "bad";
  el.hidden = false;
  clearTimeout(showRowSaveIndicator._t);
  showRowSaveIndicator._t = setTimeout(() => {
    el.hidden = true;
  }, Math.max(0, Number(ms || 650)));
}

function upsertEvent(ev) {
  const id = String(ev.id);
  const idx = eventsCache.findIndex((x) => String(x.id) === id);
  if (idx >= 0) eventsCache[idx] = { ...eventsCache[idx], ...ev };
  else eventsCache.unshift(ev);
}

function removeEvent(id) {
  const sid = String(id);
  eventsCache = eventsCache.filter((e) => String(e.id) !== sid);
}

function getEventById(id) {
  const sid = String(id);
  return eventsCache.find((e) => String(e.id) === sid) || null;
}

async function loadCalls({ silent, force } = {}) {
  if (inFlight && !force) return;
  inFlight = true;
  const btn = $("#refreshBtn");
  if (btn && !silent) btn.disabled = true;
  const epochAtStart = mutationEpoch;
  try {
    const calls = await fetchCalls();

    // If a mutation started during this fetch, don't overwrite UI with stale data.
    if (!force && epochAtStart !== mutationEpoch) return;

    const fresh = Array.isArray(calls) ? calls : [];
    if (mutatingIds.size > 0 && !force) {
      // Keep local in-flight edits for those rows to prevent dropdown snap-back.
      const localById = new Map(eventsCache.map((e) => [String(e.id), e]));
      const merged = fresh.map((row) => {
        const id = String(row.id);
        if (mutatingIds.has(id)) return localById.get(id) || row;
        return row;
      });
      eventsCache = merged;
    } else {
      eventsCache = fresh;
    }
    const filtered = applyDemoFilter(eventsCache);
    renderRows(filtered);
    setSummary(filtered);
    setLastFetch(new Date());
    setUpdatedAgoText();
  } catch (e) {
    if (!silent) showToast(e.message || "Refresh failed", "bad");
  } finally {
    if (btn && !silent) btn.disabled = false;
    inFlight = false;
  }
}

async function main() {
  console.log("🔧 Dashboard JS loaded");
  console.log("🔧 #rows element:", $("#rows"));
  
  // Load operator config (e.g., owner dropdown options). If it fails, we fall back gracefully.
  try {
    const cfg = await fetchDashboardConfig();
    ownerOptions = Array.isArray(cfg?.ownerOptions) ? cfg.ownerOptions : [];
  } catch (e) {
    ownerOptions = null;
    // Keep quiet; dashboard remains usable with prompt-based owner assignment.
  }

  // Keep simulator link keyed
  // Simulator link removed from UI (demo-only tooling).

  $("#exportBtn")?.addEventListener("click", () => exportVisibleRowsToCsv());
  $("#refreshBtn")?.addEventListener("click", () => loadCalls({ silent: false, force: true }));
  $("#clearAllBtn")?.addEventListener("click", async () => {
    if (!confirm("Clear all leads?")) return;
    pauseAutoRefresh(3000);
    try {
      try {
        await clearAll();
      } catch (e) {
        const msg = String(e?.message || "");
        if (msg.toLowerCase().includes("unresolved")) {
          const ok = confirm("There are leads with no Result. Clear anyway?");
          if (!ok) throw e;
          await clearAll({ confirmUnresolved: true });
        } else {
          throw e;
        }
      }
      eventsCache = [];
      renderRows(eventsCache);
      setSummary(eventsCache);
      showToast("Cleared", "ok");
      setLastFetch(new Date());
    } catch (e) {
      showToast(e.message || "Failed to clear", "bad");
    }
  });

  // Modals: follow-up + timeline intentionally removed.

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
  });

  const eventsRoot = $("#eventsRoot") || $("#rows");

  eventsRoot?.addEventListener("click", async (e) => {
    const toggleBtn = e.target.closest(".js-toggle-details");
    if (toggleBtn) {
      const rowEl = toggleBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;
      if (expandedDetailsIds.has(String(id))) expandedDetailsIds.delete(String(id));
      else expandedDetailsIds.add(String(id));
      renderRows(applyDemoFilter(eventsCache));
      return;
    }

    const editOutcomeBtn = e.target.closest(".js-edit-outcome");
    if (editOutcomeBtn) {
      e.preventDefault();
      const rowEl = editOutcomeBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;
      if (editingOutcomeIds.has(String(id))) editingOutcomeIds.delete(String(id));
      else editingOutcomeIds.add(String(id));
      renderRows(applyDemoFilter(eventsCache));
      return;
    }

    const cancelOutcomeBtn = e.target.closest(".js-cancel-outcome");
    if (cancelOutcomeBtn) {
      e.preventDefault();
      const rowEl = cancelOutcomeBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;
      editingOutcomeIds.delete(String(id));
      renderRows(applyDemoFilter(eventsCache));
      return;
    }

    // Timeline UI intentionally removed.

    // Follow-up UI intentionally removed.

    const setOwnerBtn = e.target.closest(".js-set-owner");
    if (setOwnerBtn) {
      e.preventDefault();
      const rowEl = setOwnerBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;
      const current = getEventById(id)?.owner ? String(getEventById(id).owner) : "";
      const owner = prompt("Assign owner (name/initials):", current);
      if (owner === null) return;
      pauseAutoRefresh(2500);
      try {
        const resp = await apiSetOwner({ eventId: id, owner: owner.trim() ? owner.trim() : null });
        if (resp?.event) upsertEvent(resp.event);
        const filtered = applyDemoFilter(eventsCache);
        renderRows(filtered);
        setSummary(filtered);
        showToast("Owner saved", "ok");
      } catch (err) {
        showToast(err.message || "Failed to set owner", "bad");
      }
      return;
    }

    const deleteBtn = e.target.closest(".js-delete");
    if (deleteBtn) {
      const rowEl = deleteBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;

      console.log("Delete clicked:", { id });

      if (!confirm("Delete this lead?")) return;

      pauseAutoRefresh(3000);
      mutationEpoch += 1;
      mutatingIds.add(String(id));
      deleteBtn.disabled = true;
      try {
        removeEvent(id);
        {
          const filtered = applyDemoFilter(eventsCache);
          renderRows(filtered);
          setSummary(filtered);
        }

        try {
          await deleteCall(id);
        } catch (err) {
          const msg = String(err?.message || "");
          if (msg.toLowerCase().includes("no result") || msg.toLowerCase().includes("unresolved")) {
            const ok = confirm("This lead has no Result yet. Delete anyway?");
            if (!ok) throw err;
            await deleteCall(id, { confirmUnresolved: true });
          } else {
            throw err;
          }
        }
        mutatingIds.delete(String(id));
        showToast("Deleted", "ok");
        setLastFetch(new Date());
      } catch (err) {
        mutatingIds.delete(String(id));
        console.error("Delete failed", err);
        showToast(err.message || "Failed to delete", "bad");
        await loadCalls({ silent: true, force: true });
      } finally {
        deleteBtn.disabled = false;
      }
    }
  });

  // Next step dropdown changes
  eventsRoot?.addEventListener("change", async (e) => {
    const sel = e.target?.closest?.(".js-next-step");
    if (!sel) return;
    const rowEl = sel.closest("[data-id]");
    const id = rowEl?.dataset?.id;
    if (!id) return;
    const value = sel.value || "";
    const prev = getEventById(id)?.next_step ? String(getEventById(id).next_step) : "";

    // Optimistic update: immediately reflect change.
    upsertEvent({ id, next_step: value ? value : null });
    renderRows(applyDemoFilter(eventsCache));

    pauseAutoRefresh(2500);
    try {
      const resp = await apiSetNextStep({ eventId: id, nextStep: value ? value : null });
      if (resp?.event) upsertEvent(resp.event);
      const filtered = applyDemoFilter(eventsCache);
      renderRows(filtered);
      setSummary(filtered);
      // Subtle inline "Saved" (500–700ms)
      showRowSaveIndicator(id, { ok: true, message: "Saved", ms: 650 });
    } catch (err) {
      // Revert UI
      upsertEvent({ id, next_step: prev ? prev : null });
      renderRows(applyDemoFilter(eventsCache));
      showRowSaveIndicator(id, { ok: false, message: "Failed to save", ms: 1500 });
    }
  });

  // Owner dropdown changes
  eventsRoot?.addEventListener("change", async (e) => {
    const sel = e.target?.closest?.(".js-owner-select");
    if (!sel) return;
    const rowEl = sel.closest("[data-id]");
    const id = rowEl?.dataset?.id;
    if (!id) return;
    const value = (sel.value || "").trim();
    pauseAutoRefresh(2500);
    try {
      const resp = await apiSetOwner({ eventId: id, owner: value ? value : null });
      if (resp?.event) upsertEvent(resp.event);
      const filtered = applyDemoFilter(eventsCache);
      renderRows(filtered);
      setSummary(filtered);
      showToast("Owner saved", "ok");
    } catch (err) {
      showToast(err.message || "Failed to set owner", "bad");
    }
  });

  eventsRoot?.addEventListener("change", async (e) => {
    if (!e.target.matches || !e.target.matches(".js-outcome")) {
      return;
    }
    
    const sel = e.target;
    const rowEl = sel.closest("[data-id]");
    const id = rowEl?.dataset?.id;
    if (!id) return;

    const raw = sel.value;
    const outcome = raw ? raw : null;
    const prev = getEventById(id)?.outcome ?? null;

    pauseAutoRefresh(3000);
    mutationEpoch += 1;
    mutatingIds.add(String(id));
    sel.disabled = true;
    try {
      // Optimistic update
      upsertEvent({
        id,
        outcome,
        outcomeAt: outcome ? new Date().toISOString() : null,
      });
      setSummary(applyDemoFilter(eventsCache));

      const resp = await setResult(id, outcome);
      if (resp?.event) upsertEvent(resp.event);

      mutatingIds.delete(String(id));
      editingOutcomeIds.delete(String(id));
      {
        const filtered = applyDemoFilter(eventsCache);
        renderRows(filtered);
        setSummary(filtered);
      }
      showToast(
        outcome ? "Result saved" : "Result cleared",
        "ok"
      );
    } catch (err) {
      mutatingIds.delete(String(id));
      console.error("Outcome save failed", err);
      showToast(err.message || "Failed to update", "bad");
      // Revert to previous value immediately (and keep selection stable)
      upsertEvent({
        id,
        outcome: prev,
        outcomeAt: null,
      });
      {
        const filtered = applyDemoFilter(eventsCache);
        renderRows(filtered);
        setSummary(filtered);
      }
    } finally {
      sel.disabled = false;
    }
  });

  // Interaction detection: pause auto-refresh while user is focused on controls
  if (eventsRoot) {
    eventsRoot.addEventListener("focusin", (e) => {
      if (e.target.matches && e.target.matches(".js-outcome")) {
        isInteracting = true;
      }
    });
    eventsRoot.addEventListener("focusout", (e) => {
      if (e.target.matches && e.target.matches(".js-outcome")) {
        // Use short timeout to allow click handlers to complete
        setTimeout(() => {
          isInteracting = false;
        }, 100);
      }
    });
  }

  setLastFetch(null);
  startAgoTicker();
  // First load should not be silent so auth/key issues are visible immediately.
  await loadCalls({ silent: false });

  // Auto-refresh every ~10s, but pause when tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  startAutoRefresh();
}

document.addEventListener("DOMContentLoaded", main);


