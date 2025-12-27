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

function normalizeCallerNumber(raw) {
  // Convert common formatting to +digits for demo friendliness
  let s = String(raw || "").trim();
  s = s.replace(/[^\d+]/g, "");
  // If user typed digits only, leave as-is. If they typed leading +, keep it.
  return s;
}

function setError(name, message) {
  const err = document.querySelector(`[data-error-for="${name}"]`);
  if (err) err.textContent = message || "";
  const input = document.querySelector(`[name="${name}"]`);
  const field = input && input.closest && input.closest(".field");
  if (field) field.dataset.invalid = message ? "true" : "false";
}

function validate(callerNumber, status) {
  let ok = true;
  setError("callerNumber", "");
  setError("status", "");

  if (!callerNumber) {
    setError("callerNumber", "Please enter a caller number.");
    ok = false;
  } else if (callerNumber.length < 7 || callerNumber.length > 20 || !/^\+?\d+$/.test(callerNumber)) {
    setError("callerNumber", "Use 7-20 chars, digits only, optional leading '+'.");
    ok = false;
  }

  if (status !== "missed" && status !== "answered") {
    setError("status", "Choose missed or answered.");
    ok = false;
  }

  return ok;
}

async function main() {
  // Ensure dashboard link keeps the key
  const goDash = $("#goDash");
  if (goDash) goDash.href = withKey("/dashboard");

  const form = $("#simForm");
  const callerInput = $("#callerNumber");
  const statusSelect = $("#status");
  const createdCard = $("#createdCard");
  const saveStatus = $("#saveStatus");
  const submitBtn = form?.querySelector('button[type="submit"]');

  if (callerInput) callerInput.value = localStorage.getItem("hvac_demo_last_number") || "+14105551234";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const callerNumber = normalizeCallerNumber(callerInput.value);
    const status = String(statusSelect.value || "missed");

    if (!validate(callerNumber, status)) return;

    localStorage.setItem("hvac_demo_last_number", callerNumber);

    // Instant, optimistic UI (do NOT block on network)
    const optimisticCreatedAt = new Date().toISOString();
    if (createdCard) createdCard.hidden = false;
    if (saveStatus) saveStatus.textContent = "";
    $("#createdTime").textContent = new Date(optimisticCreatedAt).toLocaleString();
    $("#createdNumber").textContent = callerNumber;
    $("#createdStatus").innerHTML = `<span class="status-badge status-badge--${status}">${status}</span>`;

    // Brief button disable to feel responsive without double-submits
    if (submitBtn) {
      submitBtn.disabled = true;
      setTimeout(() => {
        submitBtn.disabled = false;
      }, 350);
    }

    // If save takes >1s, show subtle indicator (but keep UI unblocked)
    let savingTimer = null;
    savingTimer = setTimeout(() => {
      if (saveStatus) saveStatus.textContent = "Saving…";
    }, 1000);

    const key = getKey();
    fetch(withKey("/api/webhooks/call"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "x-demo-key": key } : {}),
      },
      body: JSON.stringify({
        callerNumber,
        status,
        source: "simulator",
      }),
    })
      .then(async (res) => {
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = { message: text || "Unexpected response" };
        }
        if (!res.ok) throw new Error(json.message || "Failed to create event");
        return json;
      })
      .then((json) => {
        if (savingTimer) clearTimeout(savingTimer);
        if (saveStatus) saveStatus.textContent = "Saved";
        setTimeout(() => {
          if (saveStatus && saveStatus.textContent === "Saved") saveStatus.textContent = "";
        }, 1200);

        // Replace optimistic timestamp with server timestamp for accuracy
        $("#createdTime").textContent = new Date(json.createdAt).toLocaleString();
        showToast("Event created", "ok");
      })
      .catch((err) => {
        if (savingTimer) clearTimeout(savingTimer);
        if (saveStatus) saveStatus.textContent = "Save failed";
        showToast(err.message || "Failed to create event", "bad");
      });
  });
}

document.addEventListener("DOMContentLoaded", main);


