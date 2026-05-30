# StellarMarket Webhooks

Webhooks let you receive real-time HTTP notifications when events occur on StellarMarket.

## Supported Events

| Event | When it fires |
|-------|--------------|
| `job.status_changed` | A job moves to a new status (e.g. `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) |
| `milestone.approved` | A milestone is approved by the client |

## Registering a Webhook

```
POST /api/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-server.example.com/hook",
  "event": "job.status_changed"
}
```

The response includes the webhook `id`. Keep it — you need it to delete the webhook later.
A unique `secret` is generated per webhook and used for signing (see below).

## Payload Format

Every delivery sends a `POST` request to your URL with:

```json
{
  "event": "job.status_changed",
  "data": {
    "jobId": "clxyz...",
    "status": "COMPLETED"
  }
}
```

## Signature Verification

Every outgoing request includes an `X-StellarMarket-Signature` header so you can
confirm the payload is genuine and has not been tampered with.

**Header format:**
```
X-StellarMarket-Signature: sha256=<64-char-hex-digest>
```

The signature is an **HMAC-SHA256** of the raw JSON request body, computed with
the per-webhook `secret` returned at registration time.

### Verification — Node.js

```js
const crypto = require("crypto");

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)          // rawBody must be the raw Buffer/string, not parsed JSON
    .digest("hex");

  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader ?? "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express example
app.post("/hook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-stellarmarket-signature"];
  if (!verifySignature(process.env.WEBHOOK_SECRET, req.body, sig)) {
    return res.status(401).send("Invalid signature");
  }
  const { event, data } = JSON.parse(req.body);
  // handle event …
  res.sendStatus(200);
});
```

### Verification — Python

```python
import hmac
import hashlib

def verify_signature(secret: str, raw_body: bytes, signature_header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")

# Flask example
from flask import Flask, request, abort
import os

app = Flask(__name__)

@app.route("/hook", methods=["POST"])
def hook():
    sig = request.headers.get("X-StellarMarket-Signature", "")
    if not verify_signature(os.environ["WEBHOOK_SECRET"], request.data, sig):
        abort(401)
    payload = request.get_json()
    # handle payload["event"] …
    return "", 200
```

## Retry Policy

If your endpoint does not return a `2xx` status, StellarMarket retries the delivery:

| Attempt | Delay after previous failure |
|---------|------------------------------|
| 2nd     | 30 seconds |
| 3rd     | 2 minutes |
| (final) | 10 minutes |

After 3 failed attempts the delivery is marked `failed` and no further retries occur.

## Deleting a Webhook

```
DELETE /api/webhooks/:id
Authorization: Bearer <token>
```
