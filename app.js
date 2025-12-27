/*
  DEMO FORM SETUP

  Option A (recommended): Formspree
  - Create a Formspree form and paste the endpoint URL below.
  - Example: https://formspree.io/f/abcdwxyz

  Option B: No backend (default demo behavior)
  - Leave FORM_ENDPOINT empty.
  - On submit, we show a success message and log fields to console.
*/
const FORM_ENDPOINT = ""; // <-- paste your Formspree endpoint here

function $(sel, root = document) {
  return root.querySelector(sel);
}

function getField(form, name) {
  const fromCollection = form.elements.namedItem(name);
  if (fromCollection) return fromCollection;
  // Fallback (more robust in case the browser does not surface namedItem as expected)
  try {
    return form.querySelector(`[name="${CSS.escape(name)}"]`);
  } catch {
    return form.querySelector(`[name="${name}"]`);
  }
}

function getValue(form, name) {
  const el = getField(form, name);
  if (!el) return "";
  // RadioNodeList can be returned for grouped inputs.
  // It still exposes `.value` for the selected option.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEl = /** @type {any} */ (el);
  return String(anyEl.value ?? "").trim();
}

function setError(form, name, message) {
  const field = getField(form, name);
  if (!field) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldWrap = /** @type {any} */ (field).closest?.(".field");
  const errorEl = form.querySelector(`[data-error-for="${name}"]`);
  if (fieldWrap) fieldWrap.dataset.invalid = message ? "true" : "false";
  if (errorEl) errorEl.textContent = message || "";
}

function normalizePhone(raw) {
  return String(raw || "").replace(/[^\d+]/g, "").trim();
}

function validate(form) {
  const firstName = getValue(form, "firstName");
  const phone = getValue(form, "phone");
  const cityOrZip = getValue(form, "cityOrZip");
  const issue = getValue(form, "issue");
  const timeframe = getValue(form, "timeframe");

  let ok = true;

  setError(form, "firstName", "");
  setError(form, "phone", "");
  setError(form, "cityOrZip", "");
  setError(form, "issue", "");
  setError(form, "timeframe", "");

  if (!firstName) {
    setError(form, "firstName", "Please enter your first name.");
    ok = false;
  }

  const normalized = normalizePhone(phone);
  if (!phone) {
    setError(form, "phone", "Please enter a phone number.");
    ok = false;
  } else if (normalized.replace("+", "").length < 10) {
    setError(form, "phone", "Please enter a valid phone number.");
    ok = false;
  }

  if (!cityOrZip) {
    setError(form, "cityOrZip", "Please enter your city or ZIP.");
    ok = false;
  }

  if (!issue) {
    setError(form, "issue", "Please select an issue.");
    ok = false;
  }

  if (!timeframe) {
    setError(form, "timeframe", "Please select a timeframe.");
    ok = false;
  }

  return ok;
}

function serialize(form) {
  const data = new FormData(form);
  const obj = {};
  for (const [k, v] of data.entries()) obj[k] = String(v);
  return obj;
}

function showSuccess(form) {
  const success =
    $("#formSuccess", form) ||
    $("#formSuccess2", form);
  if (success) {
    success.hidden = false;
    success.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function setSubmitting(button, isSubmitting) {
  if (!button) return;
  button.disabled = isSubmitting;
  button.dataset.prevText = button.dataset.prevText || button.textContent;
  if (isSubmitting) {
    button.textContent = "Sending...";
    button.style.opacity = "0.7";
  } else {
    button.textContent = button.dataset.prevText;
    button.style.opacity = "1";
  }
}

function setupSmoothScroll() {
  const scrollTargets = document.querySelectorAll("[data-scroll]");
  scrollTargets.forEach((el) => {
    el.addEventListener("click", (e) => {
      const id = el.getAttribute("data-scroll");
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstInput = target.querySelector("input, select, textarea");
      if (firstInput) setTimeout(() => firstInput.focus({ preventScroll: true }), 250);
    });
  });
}

function setupInlineValidation(form) {
  const watched = ["firstName", "phone", "cityOrZip", "issue", "timeframe"];
  watched.forEach((name) => {
    const field = getField(form, name);
    if (!field) return;
    field.addEventListener("input", () => validate(form));
    field.addEventListener("change", () => validate(form));
    field.addEventListener("blur", () => validate(form));
  });
}

function setupDemoFooterLinks() {
  const el = document.getElementById("demoFooterLinks");
  const demoLink = document.getElementById("demoLink");
  const dashboardLink = document.getElementById("dashboardLink");
  if (!el || !demoLink || !dashboardLink) return;

  const params = new URLSearchParams(window.location.search);
  const isDemoMode = params.get("demo") === "1";
  if (!isDemoMode) return;

  el.hidden = false;

  const savedKey = localStorage.getItem("hvac_demo_key") || "";
  const withKey = (path) => {
    try {
      const url = new URL(path, window.location.origin);
      if (savedKey) url.searchParams.set("key", savedKey);
      return url.toString();
    } catch {
      return path;
    }
  };

  demoLink.href = withKey("/demo");
  dashboardLink.href = withKey("/dashboard");
}

function isDemoModeEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("demo") === "1";
  } catch {
    return false;
  }
}

function getOrPromptDemoKey() {
  // If a key is present in the URL, prefer it (and persist it) to avoid prompts.
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = String(params.get("key") || "").trim();
    if (fromUrl) {
      localStorage.setItem("hvac_demo_key", fromUrl);
      try {
        document.cookie = "demo_key=" + encodeURIComponent(fromUrl) + "; path=/; SameSite=Lax";
      } catch {
        // ignore
      }
      return fromUrl;
    }
  } catch {
    // ignore
  }

  const existing = localStorage.getItem("hvac_demo_key") || "";
  if (existing) return existing;
  // Only prompt in explicit demo mode so normal visitors aren't bothered.
  if (!isDemoModeEnabled()) return "";
  const entered = window.prompt("Enter demo key to log a missed call event (optional):");
  const key = String(entered || "").trim();
  if (!key) return "";
  localStorage.setItem("hvac_demo_key", key);
  try {
    document.cookie = "demo_key=" + encodeURIComponent(key) + "; path=/; SameSite=Lax";
  } catch {
    // ignore
  }
  return key;
}

function formatE164ForDemo(rawPhone) {
  // Try to turn common US formats into +1XXXXXXXXXX for the demo.
  const s = normalizePhone(rawPhone);
  if (!s) return "";
  if (s.startsWith("+")) return s;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits; // fallback (may still pass validation if length is 7-20)
}

function ensureToastEl() {
  let el = document.getElementById("landingToast");
  if (el) return el;
  el = document.createElement("div");
  el.id = "landingToast";
  el.className = "toast";
  el.hidden = true;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  return el;
}

function showLandingToast(message, type = "ok") {
  const el = ensureToastEl();
  el.textContent = message;
  el.dataset.type = type;
  el.hidden = false;
  clearTimeout(showLandingToast._t);
  showLandingToast._t = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

async function simulateCallEvent({ callerNumber, status, source }) {
  const key = getOrPromptDemoKey();
  if (!key) return { ok: false, reason: "no_key" };

  const url = new URL("/api/webhooks/call", window.location.origin);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-demo-key": key
    },
    body: JSON.stringify({
      callerNumber,
      status,
      source: source || "landing_call_click"
    })
  });

  if (!res.ok) return { ok: false, reason: "http" };
  return { ok: true };
}

function setupDemoCallClickBridge() {
  // Demo-only: prevent the OS dialer from opening and instead log a call event.
  // Normal mode (no ?demo=1): phone links behave normally.
  if (!isDemoModeEnabled()) return;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

  // Rewrite tel: hrefs immediately so the browser/OS never sees a tel: navigation in demo mode.
  // We preserve the original in data-tel so styling stays the same.
  const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
  telLinks.forEach((a) => {
    if (a.dataset && a.dataset.demoTelRewritten === "1") return;
    const original = a.getAttribute("href") || "";
    a.dataset.tel = original;
    a.dataset.demoTelRewritten = "1";
    // Remove tel: to prevent Windows app picker.
    a.setAttribute("href", "#");
    // Optional: make it feel clickable but not “navigate away”
    a.setAttribute("role", "button");
  });

  async function handleTelClick(e) {
    // Allow real dialing in demo mode if user holds Shift.
    if (e.shiftKey) {
      // If user explicitly wants to dial, restore tel: for this click.
      const target = e.target;
      const link = target && target.closest ? target.closest('a[data-tel]') : null;
      if (link && link.dataset.tel) {
        link.setAttribute("href", link.dataset.tel);
        // Let the browser handle it (will trigger OS picker/dialer)
        return;
      }
      return;
    }

    const target = e.target;
    const link = target && target.closest ? target.closest('a[data-tel], a[href^="tel:"]') : null;
    if (!link) return;

    // Prevent the browser/OS from opening a "phone app" chooser.
    e.preventDefault();
    e.stopPropagation();
    // Some browsers/extensions hook clicks; this helps ensure we "win".
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    // Use last known number for “caller” (set by simulator or landing form), fallback to a stable demo number.
    const last = localStorage.getItem("hvac_demo_last_number") || "+14105551234";
    const callerNumber = formatE164ForDemo(last) || "+14105551234";
    localStorage.setItem("hvac_demo_last_number", callerNumber);

    // Alt-click = answered; normal click = missed (better for this demo)
    const status = e.altKey ? "answered" : "missed";

    try {
      const result = await simulateCallEvent({
        callerNumber,
        status,
        source: "landing_call_click"
      });

      if (!result.ok) {
        showLandingToast("Could not log call event (check demo key).", "bad");
        return;
      }

      showLandingToast(
        `Logged ${status} call event (saved). Open /dashboard to view.`,
        "ok"
      );

      // If user holds Ctrl/Meta, open dashboard immediately (nice during demos).
      if (e.ctrlKey || e.metaKey) {
        try {
          const key = localStorage.getItem("hvac_demo_key") || "";
          const dashUrl = new URL("/dashboard", window.location.origin);
          if (key) dashUrl.searchParams.set("key", key);
          window.open(dashUrl.toString(), "_blank", "noopener");
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn("Demo call click logging failed:", err);
      showLandingToast("Failed to log call event", "bad");
    }
  }

  // Capture phase ensures we intercept before the browser hands off tel: to the OS.
  document.addEventListener("click", handleTelClick, true);
  // Some environments trigger tel handling very early; also intercept pointerdown.
  document.addEventListener("pointerdown", handleTelClick, true);

  // Small hint in console for you (not user-facing)
  console.log("Demo mode: tel: links log call events (Alt=answered, Shift=real call).");
}

async function tryLogMissedCallEventFromForm(payload) {
  // This is a DEMO bridge: submitting the form implies "call was missed, so they used the form".
  // Only runs in demo mode, and only when served via http(s) (not file://).
  if (!isDemoModeEnabled()) return;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

  const callerNumber = formatE164ForDemo(payload?.phone || "");
  if (!callerNumber) return;

  const key = getOrPromptDemoKey();
  if (!key) return;

  try {
    const url = new URL("/api/webhooks/call", window.location.origin);
    url.searchParams.set("key", key);

    await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-demo-key": key
      },
      body: JSON.stringify({
        callerNumber,
        status: "missed",
        source: "landing_form"
      })
    });
  } catch (e) {
    // Keep landing flow smooth; this is demo-only telemetry.
    console.warn("Demo missed-call logging failed:", e);
  }
}

async function postToFormspree(payload) {
  // Formspree accepts JSON. We keep it simple.
  const res = await fetch(FORM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res;
}

function main() {
  // Initialize AOS animations
  if (typeof AOS !== 'undefined') {
    AOS.init({
      duration: 600,
      easing: 'ease-out-cubic',
      once: true,
      offset: 50,
    });
  }

  setupDemoFooterLinks();
  setupDemoCallClickBridge();
  setupSmoothScroll();

  const forms = [$("#serviceForm"), $("#serviceForm2")].filter(Boolean);
  if (forms.length === 0) return;

  forms.forEach((form) => {
    setupInlineValidation(form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('button[type="submit"]');
      const successEl = $("#formSuccess", form) || $("#formSuccess2", form);
      if (successEl) successEl.hidden = true;

      const ok = validate(form);
      if (!ok) return;

      const payload = serialize(form);

      setSubmitting(submitBtn, true);

      try {
        if (FORM_ENDPOINT && FORM_ENDPOINT.trim().length > 0) {
          const res = await postToFormspree(payload);
          if (!res.ok) {
            console.warn("Formspree error:", res.status, await res.text());
          }
        } else {
          // Demo mode: log the captured fields so it still feels real.
          console.log("Demo form submission:", payload);
        }

        showSuccess(form);
        // Demo bridge: log a missed-call event so it appears in /dashboard.
        // (This runs only when the landing is opened with ?demo=1)
        tryLogMissedCallEventFromForm(payload);
        form.reset();
        validate(form); // clears any invalid UI state
      } catch (err) {
        console.warn("Form submit error:", err);
        showSuccess(form); // still show success in demo to keep flow smooth
      } finally {
        setSubmitting(submitBtn, false);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", main);


