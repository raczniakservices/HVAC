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
  { value: "booked", label: "Booked", displayLabel: "✅ Booked", color: "#16a34a" },
  { value: "reached_no_booking", label: "Contacted (no booking)", displayLabel: "📞 Contacted", color: "#f59e0b" },
  { value: "no_answer", label: "No answer", displayLabel: "❌ No answer", color: "#94a3b8" },
  { value: "already_hired", label: "Already hired", displayLabel: "🚫 Already hired", color: "#dc2626" },
  { value: "wrong_number", label: "Wrong number/spam", displayLabel: "⚠️ Wrong number", color: "#dc2626" },
  { value: "call_back_later", label: "Call back later", displayLabel: "⏰ Call back", color: "#f59e0b" },
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

function computeRespondedSeconds(ev) {
  const rs = computeResponseSeconds(ev);
  if (typeof rs === "number" && Number.isFinite(rs)) return rs;
  return null;
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
  const isFormLead = ev?.source === "landing_form";
  const statusClass = isFormLead ? (ev?.followedUp ? "answered" : "missed") : ev?.status;
  const statusLabel = isFormLead ? (ev?.followedUp ? "followed up" : "new lead") : ev?.status;
  return { statusClass, statusLabel };
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
  // Unhandled = needs first real attempt (handled_at is null) AND no outcome.
  const missed = events.filter((e) => !e?.outcome && (e?.handled_at === null || typeof e?.handled_at === "undefined")).length;
  const followedUp = events.filter((e) => typeof e?.handled_at === "number").length;
  const booked = events.filter((e) => e.outcome === "booked").length;
  const lost = events.filter((e) => {
    if (e.outcome === "already_hired" || e.outcome === "wrong_number") return true;
    if (e.outcome === "no_answer" && typeof e?.handled_at === "number") return true;
    return false;
  }).length;

  set("sumMissed", missed);
  set("sumFollowedUp", followedUp);
  set("sumBooked", booked);
  set("sumLost", lost);
}

function formatAutomationKind(kind) {
  const k = String(kind || "").trim();
  if (k === "sla_breached") {
    return { title: "SLA breached", pill: "Overdue", pillClass: "automation-item__pill--warn" };
  }
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

function getSlaMinutes(ev) {
  const n = Number(ev?.slaMinutes);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 15;
}

function getLeadState(ev) {
  const hasOutcome = !!ev?.outcome;
  if (hasOutcome) return { state: "closed", label: "Closed", cls: "pill pill--ok" };

  const handled = typeof ev?.handled_at === "number" && Number.isFinite(ev.handled_at);
  if (handled) return { state: "handled", label: "Handled", cls: "pill pill--muted" };

  const createdMs = getCreatedAtMs(ev);
  const mins = createdMs ? minutesBetweenMs(createdMs, Date.now()) : null;
  const slaMin = getSlaMinutes(ev);
  const overdue = typeof mins === "number" && mins > slaMin;
  return {
    state: overdue ? "overdue" : "open",
    label: `${overdue ? "Overdue" : "Open"} ${typeof mins === "number" ? `${mins}m` : "—"}`,
    cls: overdue ? "pill pill--danger" : "pill pill--warn",
    overdue,
    mins,
    slaMin,
  };
}

function getSlaDotClass(ev) {
  const rs = computeResponseSeconds(ev);
  const state = getLeadState(ev);
  if (typeof rs === "number") {
    if (rs <= 5 * 60) return "sla-dot sla-dot--green";
    if (rs <= 30 * 60) return "sla-dot sla-dot--yellow";
    return "sla-dot sla-dot--red";
  }
  if (state?.state === "overdue") return "sla-dot sla-dot--red";
  return "sla-dot";
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

async function openTimelineModal(eventId) {
  timelineEventId = Number(eventId);
  const ev = getEventById(eventId);
  const title = document.getElementById("timelineTitle");
  if (title) {
    title.textContent = ev?.callerNumber ? `Timeline — ${ev.callerNumber}` : "Lead timeline";
  }

  showOverlay("timelineOverlay");

  // Evidence pane (robust against cached/stale HTML or DOM drift)
  let itemsEl = document.getElementById("timelineItems");
  if (!itemsEl) {
    const col = document.querySelector("#timelineOverlay .timeline-col .section-label")?.parentElement || null;
    if (col) {
      const div = document.createElement("div");
      div.id = "timelineItems";
      div.className = "timeline";
      col.appendChild(div);
      itemsEl = div;
    }
  }
  if (itemsEl) itemsEl.innerHTML = `<div class="muted">Loading…</div>`;

  try {
    const emailLogs = await apiGetEmailLogs(eventId);

    const parts = [];
    parts.push(
      buildTimelineItem({
        title: "Lead created",
        time: formatTimeFull(ev?.createdAt),
        body: `${formatSource(ev?.source).label}${ev?.note ? ` — ${String(ev.note)}` : ""}`,
      })
    );

    if (ev?.source === "twilio") {
      const dur = getCallLengthSeconds(ev);
      parts.push(
        buildTimelineItem({
          title: ev?.status === "answered" ? "Answered call" : "Missed call",
          time: formatTimeFull(ev?.createdAt),
          body: dur != null ? `Call duration: ${formatDuration(dur)}` : "",
        })
      );
    }

    if (ev?.outcome) {
      parts.push(
        buildTimelineItem({
          title: `Outcome set: ${ev.outcome}`,
          time: ev?.outcomeAt ? formatTimeFull(ev.outcomeAt) : "",
          body: "",
        })
      );
    }

    for (const m of Array.isArray(emailLogs) ? emailLogs : []) {
      const receipt = m.provider_message_id ? String(m.provider_message_id).slice(0, 10) : "";
      const isFailed = String(m.status || "").toLowerCase() === "failed";
      parts.push(
        buildTimelineItem({
          title: isFailed ? `EMAIL FAILED: ${m.email_type}` : `Email: ${m.email_type} (sent)`,
          time: fmtEpoch(m.created_at),
          body: `${m.to_email}${receipt ? ` — receipt ${receipt}…` : ""}${
            isFailed && m.error_text ? ` — ${m.error_text}` : ""
          }`,
          className: isFailed ? "timeline-item--danger" : "timeline-item--ok",
        })
      );
    }

    if (itemsEl) itemsEl.innerHTML = parts.join("") || `<div class="muted">No timeline entries yet.</div>`;
  } catch (e) {
    if (itemsEl) itemsEl.innerHTML = `<div class="muted">Failed to load timeline: ${escapeHtml(e?.message || "Unknown error")}</div>`;
  }
}

function closeTimelineModal() {
  timelineEventId = null;
  hideOverlay("timelineOverlay");
}

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
      const callLenText = typeof callLenSec === "number" ? formatDuration(callLenSec) : "—";

      // Show captured details for form leads (stored in note)
      const detailsHtml =
        ev.source === "landing_form" && ev.note
          ? `<div class="caller-cell__details muted">${escapeHtml(ev.note)}</div>`
          : "";

      const currentOutcome = ev.outcome ? String(ev.outcome) : "";
      const outcomeOption = OUTCOME_OPTIONS.find((o) => o.value === currentOutcome) || OUTCOME_OPTIONS[0];
      
      const outcomeOptionsHtml = OUTCOME_OPTIONS.map((o) => {
        const selected = o.value === currentOutcome ? "selected" : "";
        return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.displayLabel)}</option>`;
      }).join("");

      // Always show dropdown, but style the select based on current value
      let selectClass = "outcome-select js-outcome";
      if (currentOutcome === "booked") selectClass += " outcome-select--success";
      else if (currentOutcome === "already_hired" || currentOutcome === "wrong_number") selectClass += " outcome-select--danger";
      else if (currentOutcome === "call_back_later" || currentOutcome === "reached_no_booking") selectClass += " outcome-select--warning";
      else if (currentOutcome === "no_answer") selectClass += " outcome-select--muted";

      const resultDisplay = `
        <select class="${selectClass}" aria-label="Set Result">
          ${outcomeOptionsHtml}
        </select>
      `;

      const respondedSeconds = computeRespondedSeconds(ev);
      const respondedHtml =
        typeof respondedSeconds === "number"
          ? `<div class="result-meta muted">Responded in ${escapeHtml(formatDuration(respondedSeconds))}</div>`
          : "";

      const state = getLeadState(ev);
      const slaDotClass = getSlaDotClass(ev);
      const followupCount = Number(ev?.followup_count || 0);
      const owner = ev?.owner ? String(ev.owner) : "";

      return `
        <tr data-id="${escapeHtml(ev.id)}">
          <td title="${escapeHtml(formatTimeFull(ev.createdAt))}">${escapeHtml(formatTime(ev.createdAt))}</td>
          <td class="caller-cell">
            <a class="caller-cell__num caller-link" href="tel:${escapeHtml(String(ev.callerNumber || '').replaceAll(' ', ''))}">${escapeHtml(ev.callerNumber)}</a>
            ${detailsHtml}
          </td>
          <td><span class="${escapeHtml(state.cls)}">${escapeHtml(state.label)}</span></td>
          <td style="text-align:center;"><span class="${escapeHtml(slaDotClass)}" title="SLA indicator"></span></td>
          <td style="font-family:ui-monospace,monospace; font-size:12px; white-space:nowrap;">${escapeHtml(callLenText)}</td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:${sourceInfo.color}; white-space:nowrap;">
              ${sourceInfo.label}
            </span>
          </td>
          <td style="white-space:nowrap;">
            <span style="font-weight:900;">${escapeHtml(String(followupCount))}</span>
          </td>
          <td style="white-space:nowrap;">
            ${owner ? `<span style="font-weight:900;">${escapeHtml(owner)}</span>` : `<a href="#" class="mini-link js-set-owner">Set</a>`}
          </td>
          <td style="overflow:visible;">
            ${resultDisplay}
            ${currentOutcome ? "" : `<div class="result-meta"><span class="pill pill--warn">Needs outcome</span></div>`}
            ${respondedHtml}
          </td>
          <td class="actions-td" style="overflow:visible;">
            <button class="icon-btn js-timeline" type="button" title="Timeline" aria-label="Timeline">⎯⎯</button>
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
        const callLenText = typeof callLenSec === "number" ? formatDuration(callLenSec) : "—";

        const isFormLead = ev?.source === "landing_form";
        const detailsText = isFormLead && ev.note ? String(ev.note) : "";
        const display = getDisplayStatus(ev);
        const statusLabel = display?.statusLabel || "";

        const currentOutcome = ev.outcome ? String(ev.outcome) : "";
        const outcomeOption =
          OUTCOME_OPTIONS.find((o) => o.value === currentOutcome) || OUTCOME_OPTIONS[0];

        const outcomeOptionsHtml = OUTCOME_OPTIONS.map((o) => {
          const selected = o.value === currentOutcome ? "selected" : "";
          return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
        }).join("");

        const state = getLeadState(ev);
        const slaDotClass = getSlaDotClass(ev);
        const followupCount = Number(ev?.followup_count || 0);
        const owner = ev?.owner ? String(ev.owner) : "";

        const outcomeControlsHtml = `
          <select class="outcome-select js-outcome" aria-label="Set Result">
            ${outcomeOptionsHtml}
          </select>
          ${currentOutcome ? "" : `<div class="result-meta"><span class="pill pill--warn">Needs outcome</span></div>`}
        `;

        return `
          <div class="dashboard-card" data-id="${escapeHtml(ev.id)}">
            <div class="dashboard-card__top">
              <div class="dashboard-card__meta">
                <div class="dashboard-card__time">${escapeHtml(formatTimeFull(ev.createdAt))}</div>
                <div class="dashboard-card__caller">${escapeHtml(ev.callerNumber || "")}</div>
                ${detailsText ? `<div class="dashboard-card__details">${escapeHtml(detailsText)}</div>` : ""}
                ${owner ? `<div class="muted" style="font-size:12px; margin-top:4px;">Owner: <strong>${escapeHtml(owner)}</strong></div>` : ""}
              </div>
              <div class="dashboard-card__badges">
                <span class="${escapeHtml(state.cls)}">${escapeHtml(state.label)}</span>
                <span class="${escapeHtml(slaDotClass)}" title="SLA indicator"></span>
                <span class="source-pill" style="color:${sourceInfo.color}; white-space:nowrap;">${escapeHtml(sourceInfo.label)}</span>
              </div>
            </div>

            <div class="dashboard-card__grid">
              <div class="dashboard-kv">
                <div class="dashboard-kv__label">Call length</div>
                <div class="dashboard-kv__value">${escapeHtml(callLenText)}</div>
              </div>
              <div class="dashboard-kv">
                <div class="dashboard-kv__label">Follow-ups</div>
                <div class="dashboard-kv__value">${escapeHtml(String(followupCount))}</div>
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
                ${outcomeControlsHtml}
              </div>
              <button class="action-btn js-timeline" type="button" title="Timeline" aria-label="Timeline">Timeline</button>
              <a class="action-btn action-btn--call" href="tel:${escapeHtml(String(ev.callerNumber || '').replaceAll(' ', ''))}" title="Call back" aria-label="Call back">Call</a>
              <button class="dashboard-card__delete js-delete" type="button" title="Delete" aria-label="Delete">🗑</button>
            </div>
          </div>
        `;
      })
      .join("");
  }
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

  // Modals (follow-up removed)
  document.getElementById("timelineCloseBtn")?.addEventListener("click", closeTimelineModal);
  document.getElementById("timelineOverlay")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "timelineOverlay") closeTimelineModal();
  });
  // Booking confirmation email intentionally removed.

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("timelineOverlay")?.hidden) closeTimelineModal();
  });

  const eventsRoot = $("#eventsRoot") || $("#rows");

  eventsRoot?.addEventListener("click", async (e) => {
    const editOutcomeBtn = e.target.closest(".js-edit-outcome");
    if (editOutcomeBtn) {
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
      const rowEl = cancelOutcomeBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;
      editingOutcomeIds.delete(String(id));
      renderRows(applyDemoFilter(eventsCache));
      return;
    }

    const timelineBtn = e.target.closest(".js-timeline");
    if (timelineBtn) {
      const rowEl = timelineBtn.closest("[data-id]");
      const id = rowEl?.dataset?.id;
      if (!id) return;
      openTimelineModal(id);
      return;
    }

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


