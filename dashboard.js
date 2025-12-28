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
let hideDemoRows = true;
const editingOutcomeIds = new Set();

const HIDE_DEMO_ROWS_STORAGE_KEY = "hide_demo_rows";

function readHideDemoRowsFromStorage() {
  try {
    const raw = localStorage.getItem(HIDE_DEMO_ROWS_STORAGE_KEY);
    if (raw === null) return true; // default ON for demos
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "1") return true;
    if (raw === "0") return false;
    return true;
  } catch {
    return true;
  }
}

function writeHideDemoRowsToStorage(val) {
  try {
    localStorage.setItem(HIDE_DEMO_ROWS_STORAGE_KEY, String(!!val));
  } catch {
    // ignore
  }
}

function applyDemoFilter(events) {
  const rows = Array.isArray(events) ? events : [];
  if (!hideDemoRows) return rows;
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
  const created = parseIsoMs(ev?.createdAt);
  const followed = parseIsoMs(ev?.followedUpAt);
  if (!Number.isFinite(created) || !Number.isFinite(followed)) return null;
  return Math.max(0, Math.floor((followed - created) / 1000));
}

function setLastFetch(date) {
  const el = $("#lastFetchAt");
  if (!el) return;
  if (!date) {
    el.textContent = "—";
    lastFetchAtMs = 0;
    return;
  }
  lastFetchAtMs = date.getTime();
  el.textContent = date.toLocaleTimeString();
}

function setUpdatedAgoText() {
  const el = $("#lastUpdatedAgo");
  if (!el) return;
  if (!lastFetchAtMs) {
    el.textContent = "—";
    return;
  }
  const s = Math.max(0, Math.floor((Date.now() - lastFetchAtMs) / 1000));
  el.textContent = `${s}s`;
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
  const res = await fetch(withKey("/api/calls?limit=50"), {
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

async function followUp(id) {
  const key = getKey();
  const res = await fetch(withKey(`/api/calls/${encodeURIComponent(id)}/follow-up`), {
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

  if (!res.ok) throw new Error(json.message || "Failed to follow up");
  return json;
}

async function setOutcome(id, outcome) {
  const key = getKey();
  const res = await fetch(withKey(`/api/calls/${encodeURIComponent(id)}/outcome`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-demo-key": key } : {}),
    },
    body: JSON.stringify({ outcome }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text || "Unexpected response" };
  }
  if (!res.ok) throw new Error(json.message || "Failed to set outcome");
  return json;
}

async function deleteCall(id) {
  const key = getKey();
  const res = await fetch(withKey(`/api/calls/${encodeURIComponent(id)}`), {
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

async function clearAll() {
  const key = getKey();
  const res = await fetch(withKey("/api/calls/clear"), {
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

function setSummary(events) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };

  // "Unhandled" means we still need to take action.
  // - For calls: missed and not followed up
  // - For forms: treated as unhandled until followed up (status is stored as 'missed' for simplicity)
  const missed = events.filter((e) => e.status === "missed" && !e.followedUp).length;
  const followedUp = events.filter((e) => !!e.followedUp).length;
  const within5 = events.filter((e) => {
    if (!e.followedUp) return false;
    const rs = computeResponseSeconds(e);
    return Number.isFinite(rs) && rs <= 300;
  }).length;
  const booked = events.filter((e) => e.outcome === "booked").length;
  const lost = events.filter((e) => {
    if (e.outcome === "already_hired" || e.outcome === "wrong_number") return true;
    if (e.outcome === "no_answer" && e.followedUp) return true;
    return false;
  }).length;

  set("sumMissed", missed);
  set("sumFollowedUp", followedUp);
  set("sumWithin5", within5);
  set("sumBooked", booked);
  set("sumLost", lost);
}

function renderRows(events) {
  const tbody = $("#rows");
  if (!tbody) return;

  if (!Array.isArray(events) || events.length === 0) {
    const hasAny = Array.isArray(eventsCache) && eventsCache.length > 0;
    const hiddenOnlyDemo =
      hasAny && hideDemoRows && eventsCache.every((e) => e?.source === "simulator");
    const msg = hiddenOnlyDemo
      ? `No rows match the current filter. Uncheck “Hide Demo rows” to view demo data.`
      : `No events yet. Use the Simulator to create one.`;
    tbody.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(msg)}</td></tr>`;
    return;
  }

  tbody.innerHTML = events
    .map((ev) => {
      const isMissed = ev.status === "missed";
      // Follow-up is now driven by selecting a Result (Outcome).
      // We still compute responseSeconds from followedUpAt in the backend for metrics.

      const rs = computeResponseSeconds(ev);
      const responseText = typeof rs === "number" ? formatDuration(rs) : "—";

      const sourceInfo = formatSource(ev.source);

      const callLenSec =
        typeof ev?.dialCallDurationSec === "number"
          ? ev.dialCallDurationSec
          : typeof ev?.callDurationSec === "number"
            ? ev.callDurationSec
            : null;
      const callLenText = typeof callLenSec === "number" ? formatDuration(callLenSec) : "—";

      // Display status:
      // - Twilio calls: show answered/missed
      // - Form submits: show New lead / Followed up (instead of implying a missed phone call)
      const isFormLead = ev.source === "landing_form";
      const statusClass = isFormLead ? (ev.followedUp ? "answered" : "missed") : ev.status;
      const statusLabel = isFormLead ? (ev.followedUp ? "followed up" : "new lead") : ev.status;

      // Show captured details for form leads (stored in note)
      const detailsHtml =
        isFormLead && ev.note
          ? `<div class="muted" style="font-size:11px; margin-top:4px; line-height:1.25; white-space:normal;">${escapeHtml(
              ev.note
            )}</div>`
          : "";

      const currentOutcome = ev.outcome ? String(ev.outcome) : "";
      const outcomeOption = OUTCOME_OPTIONS.find((o) => o.value === currentOutcome) || OUTCOME_OPTIONS[0];
      
      const outcomeOptionsHtml = OUTCOME_OPTIONS.map((o) => {
        const selected = o.value === currentOutcome ? "selected" : "";
        return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
      }).join("");

      // Outcome display with timestamp
      let outcomeDisplay = `<span style="color:${outcomeOption.color}; font-weight:700; font-size:13px;">${escapeHtml(outcomeOption.displayLabel)}</span>`;
      if (ev.outcomeAt && currentOutcome) {
        outcomeDisplay += `<div class="muted" style="font-size:11px; margin-top:2px;">${escapeHtml(formatTimeShort(ev.outcomeAt))}</div>`;
      }

      const isEditingOutcome = editingOutcomeIds.has(String(ev.id));
      const outcomeControlsHtml = currentOutcome
        ? `
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
              <div style="min-width:0;">
                ${outcomeDisplay}
              </div>
              <div style="flex:0 0 auto;">
                <button class="btn-link js-edit-outcome" type="button" aria-label="Edit outcome" title="Edit outcome">Edit</button>
              </div>
            </div>
            <div style="margin-top:8px; ${isEditingOutcome ? "" : "display:none;"}">
              <select class="outcome-select js-outcome" aria-label="Set Outcome" style="width:100%; font-size:12px;">
                ${outcomeOptionsHtml}
              </select>
              <div style="margin-top:6px;">
                <button class="btn-link js-cancel-outcome" type="button" aria-label="Cancel editing outcome" title="Cancel">Cancel</button>
              </div>
            </div>
          `
        : `
            <select class="outcome-select js-outcome" aria-label="Set Outcome" style="width:100%; font-size:12px;">
              ${outcomeOptionsHtml}
            </select>
          `;

      // Row color class based on outcome
      let rowClass = "";
      if (currentOutcome === "booked") rowClass = "row-success";
      else if (currentOutcome === "already_hired" || currentOutcome === "wrong_number") rowClass = "row-danger";
      else if (currentOutcome === "call_back_later" || currentOutcome === "reached_no_booking") rowClass = "row-warning";

      return `
        <tr data-id="${escapeHtml(ev.id)}" class="${rowClass}">
          <td>${escapeHtml(formatTime(ev.createdAt))}</td>
          <td style="font-family:ui-monospace,monospace; font-size:12px; white-space:nowrap;">${escapeHtml(ev.callerNumber)}${detailsHtml}</td>
          <td><span class="status-badge status-badge--${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span></td>
          <td style="font-family:ui-monospace,monospace; font-size:12px; white-space:nowrap;">${escapeHtml(callLenText)}</td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:${sourceInfo.color}; white-space:nowrap;">
              ${sourceInfo.label}
            </span>
          </td>
          <td>${escapeHtml(responseText)}</td>
          <td style="overflow:visible;">
            ${outcomeControlsHtml}
          </td>
          <td style="text-align:right; overflow:visible;">
            <div style="display:inline-flex; gap:8px; justify-content:flex-end; align-items:center;">
              <button class="btn btn--secondary btn--sm js-delete" type="button" title="Delete" aria-label="Delete" style="width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:18px; opacity:0.6; flex-shrink:0;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">🗑</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
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
  const goDemo = $("#goDemo");
  if (goDemo) goDemo.href = withKey("/demo");

  const hideToggle = $("#hideDemoRows");
  hideDemoRows = readHideDemoRowsFromStorage();
  if (hideToggle) {
    hideToggle.checked = !!hideDemoRows;
    hideToggle.addEventListener("change", () => {
      hideDemoRows = !!hideToggle.checked;
      writeHideDemoRowsToStorage(hideDemoRows);
      const filtered = applyDemoFilter(eventsCache);
      renderRows(filtered);
      setSummary(filtered);
    });
  }

  $("#refreshBtn")?.addEventListener("click", () => loadCalls({ silent: false }));
  $("#clearAllBtn")?.addEventListener("click", async () => {
    if (!confirm("Clear all call events? (demo cleanup)")) return;
    pauseAutoRefresh(3000);
    try {
      await clearAll();
      eventsCache = [];
      renderRows(eventsCache);
      setSummary(eventsCache);
      showToast("Cleared", "ok");
      setLastFetch(new Date());
    } catch (e) {
      showToast(e.message || "Failed to clear", "bad");
    }
  });

  $("#rows")?.addEventListener("click", async (e) => {
    const editOutcomeBtn = e.target.closest(".js-edit-outcome");
    if (editOutcomeBtn) {
      const tr = editOutcomeBtn.closest("tr");
      const id = tr?.dataset?.id;
      if (!id) return;
      if (editingOutcomeIds.has(String(id))) editingOutcomeIds.delete(String(id));
      else editingOutcomeIds.add(String(id));
      renderRows(applyDemoFilter(eventsCache));
      return;
    }

    const cancelOutcomeBtn = e.target.closest(".js-cancel-outcome");
    if (cancelOutcomeBtn) {
      const tr = cancelOutcomeBtn.closest("tr");
      const id = tr?.dataset?.id;
      if (!id) return;
      editingOutcomeIds.delete(String(id));
      renderRows(applyDemoFilter(eventsCache));
      return;
    }

    const deleteBtn = e.target.closest(".js-delete");
    if (deleteBtn) {
      const tr = deleteBtn.closest("tr");
      const id = tr?.dataset?.id;
      if (!id) return;

      console.log("Delete clicked:", { id });

      if (!confirm("Delete this call event?")) return;

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

        await deleteCall(id);
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

  $("#rows")?.addEventListener("change", async (e) => {
    if (!e.target.matches || !e.target.matches(".js-outcome")) {
      return;
    }
    
    const sel = e.target;
    const tr = sel.closest("tr");
    const id = tr?.dataset?.id;
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

      const updated = await setOutcome(id, outcome);
      upsertEvent(updated);

      // Make this useful for real ops: setting an outcome implies you followed up.
      // Auto-mark "Followed up" when user sets a non-null outcome.
      const afterOutcome = getEventById(id);
      if (outcome && afterOutcome && !afterOutcome.followedUp) {
        const fu = await followUp(id);
        upsertEvent(fu);
      }

      mutatingIds.delete(String(id));
      editingOutcomeIds.delete(String(id));
      {
        const filtered = applyDemoFilter(eventsCache);
        renderRows(filtered);
        setSummary(filtered);
      }
      showToast(
        outcome ? "Outcome saved (marked followed up)" : "Outcome cleared",
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
  const tbody = $("#rows");
  if (tbody) {
    tbody.addEventListener("focusin", (e) => {
      if (e.target.matches && e.target.matches(".js-outcome")) {
        isInteracting = true;
      }
    });
    tbody.addEventListener("focusout", (e) => {
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


