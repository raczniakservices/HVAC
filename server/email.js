function isTruthy(s) {
  return !!(s && String(s).trim());
}

let _resendCtor = null;
async function getResendCtor() {
  if (_resendCtor) return _resendCtor;
  // Official Resend SDK (supports ESM). We load it lazily to keep startup robust.
  const mod = await import("resend");
  const Resend = mod?.Resend || mod?.default?.Resend || mod?.default || null;
  if (!Resend) {
    const e = new Error("Failed to load Resend SDK");
    e.code = "RESEND_SDK_LOAD_FAILED";
    throw e;
  }
  _resendCtor = Resend;
  return _resendCtor;
}

async function sendResendEmail({ apiKey, from, to, subject, html, text }) {
  if (!isTruthy(apiKey)) {
    const e = new Error("RESEND_API_KEY is not set");
    e.code = "RESEND_NOT_CONFIGURED";
    throw e;
  }
  if (!isTruthy(from)) {
    const e = new Error("FROM_EMAIL is not set");
    e.code = "FROM_EMAIL_MISSING";
    throw e;
  }
  if (!isTruthy(to)) {
    const e = new Error("to_email is required");
    e.code = "TO_EMAIL_MISSING";
    throw e;
  }
  if (!isTruthy(subject)) {
    const e = new Error("subject is required");
    e.code = "SUBJECT_MISSING";
    throw e;
  }

  const Resend = await getResendCtor();
  const resend = new Resend(String(apiKey).trim());

  const payload = {
    from: String(from).trim(),
    to: String(to).trim(),
    subject: String(subject).trim(),
    ...(isTruthy(html) ? { html: String(html) } : {}),
    ...(isTruthy(text) ? { text: String(text) } : {}),
  };

  let result;
  try {
    result = await resend.emails.send(payload);
  } catch (err) {
    const e = new Error(err?.message || "Resend send failed");
    e.code = err?.code || "RESEND_SEND_FAILED";
    e.details = err;
    throw e;
  }

  // Resend SDK commonly returns { data, error } without throwing.
  if (result?.error) {
    const e = new Error(result?.error?.message || "Resend send failed");
    e.code = result?.error?.name || result?.error?.code || "RESEND_SEND_FAILED";
    e.details = result?.error;
    throw e;
  }

  const id = result?.data?.id || result?.id || null;
  if (!id) {
    const e = new Error("Resend did not return a message id");
    e.code = "RESEND_NO_MESSAGE_ID";
    e.details = result;
    throw e;
  }

  return { id, raw: result };
}

module.exports = {
  sendResendEmail,
};


