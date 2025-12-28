# Twilio + Render demo setup notes (HVAC missed-call visibility)

## What this is
- **Render-hosted Node/Express app** (same repo as `server.js`) that serves:
  - Landing page `/` (static HTML/CSS/JS)
  - Demo simulator `/demo`
  - Dashboard `/dashboard` (protected by `DEMO_KEY`)
  - Twilio webhooks `/twilio/voice` and `/twilio/status`
  - One-phone test endpoint `/api/twilio/test-call` (creates a Twilio outbound call to your phone)

## Live URLs (current)
- **Render base URL**: `https://hvac-r7bp.onrender.com`
- **Health**: `/_health`
- **Dashboard**: `/dashboard?key=<DEMO_KEY>`

## Twilio number + user info (current)
- **Twilio company number**: `(443) 665-0603` (E.164: `+14436650603`)
- **Forward-to test phone**: `+14438761983` (user cell)

## Environment variables (Render)
Required:
- `DEMO_KEY` (protects `/demo` and `/dashboard`)
- `DATABASE_PATH` (recommended with disk) e.g. `/var/data/calls.sqlite`

Twilio webhook verification + forwarding:
- `TWILIO_AUTH_TOKEN` (Twilio Console → Account Info; enables signature verification)
- `TWILIO_FORWARD_TO` (E.164, e.g. `+14438761983`)  
  - This is where inbound calls to the Twilio number should ring.

One-phone Twilio testing (Twilio API call creation):
- `TWILIO_ACCOUNT_SID` (starts with `AC...`)
- `TWILIO_NUMBER` (E.164 for the Twilio company number, e.g. `+14436650603`)

Optional:
- `TWILIO_VALIDATE_SIGNATURE` (default `1`; set `0` only for debugging)

## Twilio Console (Phone Number → Voice Configuration)
Set for the Twilio number:
- **A call comes in** (Webhook, HTTP POST):
  - `https://hvac-r7bp.onrender.com/twilio/voice`
- **Call status changes** (HTTP POST):
  - `https://hvac-r7bp.onrender.com/twilio/status`

## Important behaviors we implemented
- **Dashboard “Type” label**:
  - `twilio` source displays as **“Inbound call”** (business-friendly)
  - `landing_call_click` displays as **“Call click”** (page telemetry; not a real phone call)
  - `landing_form` displays as **“Form submit”**
- **Caller column formatting**:
  - Phone numbers are forced to **one line** (no wrapping).
- **Answered vs missed logic**:
  - If forwarding is **not enabled**, calls are treated as **missed** (Twilio “completed” just means TwiML completed).
  - If forwarding **is enabled**, we use `DialCallStatus` from Twilio status callbacks.
- **Redirect loop fix for demo key entry**:
  - Prevents looping when a bad `?key=` is present.
  - Escape hatch: `/dashboard?reset=1` clears stored key + cookie to re-enter.
- **Forwarding loop guard**:
  - If caller number equals `TWILIO_FORWARD_TO`, we do **not** forward (avoids voicemail PIN prompt when you call from the same phone).

## Testing
### A) Real inbound call test (best “client-like” demo)
1) Ensure `TWILIO_FORWARD_TO` is set to the client’s phone (E.164).
2) Call the Twilio number from a **different phone** (not the forward-to phone).
3) Confirm:
   - The forward-to phone rings
   - Dashboard logs an **Inbound call** row

### B) One-phone test (no second device needed)
This uses Twilio’s REST API to place an outbound call from the Twilio number to your phone, while still triggering status callbacks.

1) Ensure env vars are set: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`.
2) Make request (must include demo key auth):
   - **POST** `https://hvac-r7bp.onrender.com/api/twilio/test-call?key=<DEMO_KEY>`
   - JSON body:
     - `{ "to": "+14438761983" }`
3) Twilio will call your phone. Answer or ignore, then refresh dashboard to see the logged result.

## Repo + commits (high-level)
- Repo: `https://github.com/raczniakservices/HVAC`
- Key changes implemented over time:
  - Node pinned to 20.11.1 for Render build compatibility
  - Twilio webhook ingestion + SQLite persistence (CallSid, statuses)
  - `/dashboard` auth loop fixes + UX improvements
  - Business-friendly labeling + caller no-wrap
  - One-phone test-call endpoint


