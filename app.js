import { SITE_CONFIG } from "./site.config.js";

/**
 * Optional: Formspree endpoint for inbox-style form handling.
 * If left empty, the form still shows a success state and we also POST to /api/landing/form (if available).
 */
const FORM_ENDPOINT = "";

function $(sel, root = document) {
  return root.querySelector(sel);
}

function setText(el, value) {
  if (!el) return;
  el.textContent = String(value ?? "");
}

function applyConfigToDom() {
  // Theme
  try {
    const root = document.documentElement;
    if (SITE_CONFIG?.theme?.primaryColor) root.style.setProperty("--accent", SITE_CONFIG.theme.primaryColor);
    if (SITE_CONFIG?.theme?.accentColor) root.style.setProperty("--accent2", SITE_CONFIG.theme.accentColor);
  } catch {
    // ignore
  }

  // Title + basic metas
  try {
    const baseTitle = `${SITE_CONFIG.companyName} | HVAC Service`;
    document.title = baseTitle;
    const desc = `Licensed HVAC service in ${SITE_CONFIG.primaryCity}. Call now or request service in under a minute.`;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", desc);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", baseTitle);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", desc);

    const twTitle = document.querySelector('meta[property="twitter:title"]');
    if (twTitle) twTitle.setAttribute("content", baseTitle);
    const twDesc = document.querySelector('meta[property="twitter:description"]');
    if (twDesc) twDesc.setAttribute("content", desc);
  } catch {
    // ignore
  }

  // Text bindings (+ optional hide when blank)
  document.querySelectorAll("[data-bind]").forEach((el) => {
    const key = el.getAttribute("data-bind");
    if (!key) return;
    const val = SITE_CONFIG[key];
    setText(el, val);
    if (el.getAttribute("data-hide-empty") === "1") {
      const isEmpty = val == null || String(val).trim().length === 0;
      el.hidden = isEmpty;
    }
  });

  // Image src bindings (+ optional hide when blank)
  document.querySelectorAll("[data-bind-src]").forEach((el) => {
    const key = el.getAttribute("data-bind-src");
    if (!key) return;
    const val = SITE_CONFIG[key];
    const src = val == null ? "" : String(val).trim();
    if (el.tagName === "IMG") el.setAttribute("src", src);
    if (el.getAttribute("data-hide-empty") === "1") el.hidden = !src;
  });

  // Phone bindings
  document.querySelectorAll("[data-bind-tel]").forEach((el) => {
    const telKey = el.getAttribute("data-bind-tel") || "phoneTel";
    const tel = SITE_CONFIG[telKey] || SITE_CONFIG.phoneTel;
    if (!tel) return;
    if (el.tagName === "A") el.setAttribute("href", `tel:${tel}`);
    el.setAttribute("aria-label", `Call ${SITE_CONFIG.phoneDisplay || ""}`.trim());
  });

  // Optional hero background image (off by default)
  try {
    const hero = document.querySelector(".hero");
    const enabled = Boolean(SITE_CONFIG.enableHeroImage) && String(SITE_CONFIG.heroBackgroundImageUrl || "").trim().length > 0;
    if (hero) {
      hero.classList.toggle("hero--image", enabled);
      if (enabled) {
        document.documentElement.style.setProperty("--hero-image", `url("${SITE_CONFIG.heroBackgroundImageUrl}")`);
      } else {
        document.documentElement.style.removeProperty("--hero-image");
      }
    }
  } catch {
    // ignore
  }

  // Trust strip
  const trustStrip = document.getElementById("trustStrip");
  if (trustStrip) {
    trustStrip.innerHTML = "";
    (SITE_CONFIG.trustStrip || []).slice(0, 4).forEach((t) => {
      const item = document.createElement("div");
      item.className = "trust-strip__item";
      item.innerHTML = `
        <span class="trust-strip__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="trust-strip__text"></span>
      `;
      const textEl = item.querySelector(".trust-strip__text");
      setText(textEl, t);
      trustStrip.appendChild(item);
    });
  }

  // Services
  const servicesGrid = document.getElementById("servicesGrid");
  if (servicesGrid) {
    servicesGrid.innerHTML = "";
    (SITE_CONFIG.services || []).forEach((svc, idx) => {
      const article = document.createElement("article");
      article.className = "card card--service";
      article.setAttribute("data-aos", "fade-up");
      article.setAttribute("data-aos-delay", String(80 + Math.min(idx * 40, 240)));
      article.innerHTML = `
        <div class="service-line">
          <span class="service-icon" aria-hidden="true"></span>
          <div class="service-name"></div>
        </div>
        <p class="card__body"></p>
      `;
      const iconWrap = article.querySelector(".service-icon");
      if (iconWrap) {
        iconWrap.innerHTML = "";
        const iconUrl = String(svc.iconUrl || "").trim();
        if (iconUrl) {
          const img = document.createElement("img");
          img.src = iconUrl;
          img.alt = String(svc.iconAlt || "").trim();
          img.loading = "lazy";
          img.decoding = "async";
          iconWrap.appendChild(img);
        } else {
          setText(iconWrap, svc.icon || "•");
        }
      }
      setText(article.querySelector(".service-name"), svc.title || "");
      setText(article.querySelector(".card__body"), svc.desc || "");
      servicesGrid.appendChild(article);
    });
  }

  // Testimonials
  const testimonialsGrid = document.getElementById("testimonialsGrid");
  if (testimonialsGrid) {
    testimonialsGrid.innerHTML = "";
    (SITE_CONFIG.testimonials || []).slice(0, 3).forEach((t, idx) => {
      const stars = Math.max(1, Math.min(5, Number(t.stars || 5)));
      const article = document.createElement("article");
      article.className = "testimonial";
      article.setAttribute("data-aos", "fade-up");
      article.setAttribute("data-aos-delay", String(100 + idx * 100));
      article.innerHTML = `
        <div class="testimonial__meta">
          <div class="stars" aria-label="${stars} stars">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</div>
          <div class="verified">Verified homeowner</div>
        </div>
        <p class="testimonial__text"></p>
        <div class="testimonial__author"></div>
      `;
      setText(article.querySelector(".testimonial__text"), `"${t.text || ""}"`);
      setText(article.querySelector(".testimonial__author"), `— ${t.name || ""}, ${t.city || ""}`.trim());
      testimonialsGrid.appendChild(article);
    });
  }

  // Service areas
  const chips = document.getElementById("serviceAreasChips");
  if (chips) {
    chips.innerHTML = "";
    (SITE_CONFIG.serviceAreas || []).forEach((a) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.setAttribute("role", "listitem");
      setText(chip, a);
      chips.appendChild(chip);
    });
  }

  // JSON-LD schema
  try {
    const existing = document.getElementById("localBusinessSchema");
    if (existing) existing.remove();

    const schema = {
      "@context": "https://schema.org",
      "@type": "HVACBusiness",
      name: SITE_CONFIG.companyName,
      description: `Licensed HVAC service in ${SITE_CONFIG.primaryCity}.`,
      telephone: SITE_CONFIG.phoneTel,
      areaServed: SITE_CONFIG.serviceAreas,
      url: window.location.origin,
    };

    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.id = "localBusinessSchema";
    s.textContent = JSON.stringify(schema);
    document.head.appendChild(s);
  } catch {
    // ignore
  }
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

function clearErrors(form) {
  ["firstName", "phone", "cityOrZip", "issue", "timeframe"].forEach((name) => setError(form, name, ""));
}

function normalizePhone(raw) {
  return String(raw || "").replace(/[^\d+]/g, "").trim();
}

function validate(form, { showErrors } = { showErrors: false }) {
  const firstName = getValue(form, "firstName");
  const phone = getValue(form, "phone");
  const cityOrZip = getValue(form, "cityOrZip");
  const issue = getValue(form, "issue");
  const timeframe = getValue(form, "timeframe");

  let ok = true;

  if (showErrors) {
    setError(form, "firstName", "");
    setError(form, "phone", "");
    setError(form, "cityOrZip", "");
    setError(form, "issue", "");
    setError(form, "timeframe", "");
  }

  if (!firstName) {
    if (showErrors) setError(form, "firstName", "Please enter your first name.");
    ok = false;
  }

  const normalized = normalizePhone(phone);
  if (!phone) {
    if (showErrors) setError(form, "phone", "Please enter a phone number.");
    ok = false;
  } else if (normalized.replace("+", "").length < 10) {
    if (showErrors) setError(form, "phone", "Please enter a valid phone number.");
    ok = false;
  }

  if (!cityOrZip) {
    if (showErrors) setError(form, "cityOrZip", "Please enter your city or ZIP.");
    ok = false;
  }

  if (!issue) {
    if (showErrors) setError(form, "issue", "Please select an issue.");
    ok = false;
  }

  if (!timeframe) {
    if (showErrors) setError(form, "timeframe", "Please select a timeframe.");
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
  const success = $("#formSuccess", form);
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
    const run = () => validate(form, { showErrors: form.dataset.submitted === "1" });
    field.addEventListener("input", run);
    field.addEventListener("change", run);
    field.addEventListener("blur", run);
  });
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

async function postToBackendFormIntake(payload) {
  // Send to our own backend so the dashboard can show "Form submit" rows.
  // This should work on Render (same origin) and locally. Ignore failures to keep UX smooth.
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;
  try {
    const res = await fetch("/api/landing/form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    if (!res.ok) {
      // Avoid user-facing errors on the landing (keeps friction low)
      // eslint-disable-next-line no-console
      console.warn("Form intake failed:", res.status);
    }
  } catch (e) {
    console.warn("Backend form intake failed:", e);
  }
}

function main() {
  applyConfigToDom();

  // Initialize AOS animations
  if (typeof AOS !== 'undefined') {
    AOS.init({
      duration: 600,
      easing: 'ease-out-cubic',
      once: true,
      offset: 50,
    });
  }

  setupSmoothScroll();

  const forms = [$("#serviceForm")].filter(Boolean);
  if (forms.length === 0) return;

  forms.forEach((form) => {
    form.dataset.submitted = "0";
    setupInlineValidation(form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('button[type="submit"]');
      const successEl = $("#formSuccess", form);
      if (successEl) successEl.hidden = true;

      form.dataset.submitted = "1";
      const ok = validate(form, { showErrors: true });
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
          // Optional local logging for development
          console.log("Form submission:", payload);
        }

        // Always: send to our backend intake so it appears on /dashboard.
        // (This is independent of Formspree; in production you'd likely also send to a CRM.)
        postToBackendFormIntake(payload);

        showSuccess(form);
        form.reset();
        clearErrors(form);
        form.dataset.submitted = "0";
      } catch (err) {
        console.warn("Form submit error:", err);
        showSuccess(form);
      } finally {
        setSubmitting(submitBtn, false);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", main);


