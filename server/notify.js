function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s)) return "";
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const rem = total % 60;
  if (m <= 0) return `${rem}s`;
  if (rem === 0) return `${m}m`;
  return `${m}m ${rem}s`;
}

function formatMinutes(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n / 60000));
}

function isTruthy(s) {
  return !!(s && String(s).trim());
}

function internalInboundSubject({ status, callerNumber, callDurationSec, source, customerName }) {
  const num = callerNumber ? String(callerNumber) : "Unknown";
  const st = String(status || "").toLowerCase();
  const src = String(source || "");

  if (src === "landing_form") {
    const name = customerName ? String(customerName).trim() : "";
    return name ? `NEW FORM: ${name} / ${num}` : `NEW FORM: ${num}`;
  }
  if (st === "missed") return `MISSED CALL: ${num}`;

  const dur = formatDuration(callDurationSec);
  return dur ? `NEW CALL: ${num} (answered, ${dur})` : `NEW CALL: ${num} (answered)`;
}

function internalOverdueSubject({ minutesOver, callerNumber }) {
  const mins = Number(minutesOver);
  const m = Number.isFinite(mins) ? Math.max(1, Math.floor(mins)) : null;
  const num = callerNumber ? String(callerNumber) : "Unknown";
  return m ? `OVERDUE: Lead unhandled for ${m} minutes (${num})` : `OVERDUE: Lead unhandled (${num})`;
}

function internalEmailHtml({ title, lines, dashboardUrl }) {
  const safeLines = (lines || []).filter(Boolean).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  const link =
    dashboardUrl && String(dashboardUrl).trim()
      ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(
          String(dashboardUrl).trim()
        )}" target="_blank" rel="noopener">Open dashboard</a></p>`
      : "";

  return `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.45; color:#0b1220;">
      <h2 style="margin:0 0 8px; font-size:16px;">${escapeHtml(title || "Lead update")}</h2>
      <ul style="margin:0; padding-left:18px;">${safeLines}</ul>
      ${link}
    </div>
  `.trim();
}

function customerFormConfirmation({ companyName, companyPhone }) {
  const name = companyName ? String(companyName) : "our team";
  const phone = companyPhone ? String(companyPhone).trim() : "";
  const subject = `We received your request — ${name}`;
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.55; color:#0b1220;">
      <p style="margin:0 0 10px;">Thanks — we received your request.</p>
      <p style="margin:0 0 10px;">We’ll reach out shortly to confirm availability and next steps.</p>
      ${phone ? `<p style="margin:0;">If you need us sooner, call ${escapeHtml(phone)}.</p>` : ""}
      <p style="margin:16px 0 0; color:#4b5563; font-size:12px;">— ${escapeHtml(name)}</p>
    </div>
  `.trim();
  return { subject, html };
}

function customerBookingConfirmation({ companyName, companyPhone, appointmentDate, appointmentWindow }) {
  const name = companyName ? String(companyName) : "our team";
  const phone = companyPhone ? String(companyPhone).trim() : "";
  const hasDate = isTruthy(appointmentDate);
  const hasWindow = isTruthy(appointmentWindow);

  const subject = `You’re scheduled — ${name}`;
  const whenLine =
    hasDate || hasWindow
      ? `<p style="margin:0 0 10px;"><strong>Appointment:</strong> ${escapeHtml(
          [appointmentDate, appointmentWindow].filter((x) => isTruthy(x)).join(" — ")
        )}</p>`
      : `<p style="margin:0 0 10px;"><strong>Appointment:</strong> We’ll confirm the exact time window shortly.</p>`;

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.55; color:#0b1220;">
      <p style="margin:0 0 10px;">Thanks — you’re booked with ${escapeHtml(name)}.</p>
      ${whenLine}
      ${phone ? `<p style="margin:0;">Questions? Call ${escapeHtml(phone)}.</p>` : ""}
      <p style="margin:16px 0 0; color:#4b5563; font-size:12px;">— ${escapeHtml(name)}</p>
    </div>
  `.trim();

  return { subject, html };
}

module.exports = {
  formatDuration,
  formatMinutes,
  internalInboundSubject,
  internalOverdueSubject,
  internalEmailHtml,
  customerFormConfirmation,
  customerBookingConfirmation,
};


