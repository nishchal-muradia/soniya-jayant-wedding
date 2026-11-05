// Cloudflare Pages advanced-mode Worker. Credentials are encrypted bindings,
// never public content or build-time replacements.
const MAX_BODY_BYTES = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNCONFIRMED = 'We could not confirm your RSVP. Please try again; retrying the same reply will not create a duplicate.';

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extra
  }});
}

async function limitedText(stream) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('body-too-large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', {fatal: true}).decode(result);
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some(key => !['submissionId', 'guestName', 'attending', 'guestCount', 'message', 'website'].includes(key))) return null;
  if (typeof input.submissionId !== 'string' || !UUID.test(input.submissionId)) return null;
  if (typeof input.guestName !== 'string' || !input.guestName.trim() || input.guestName.length > 120 || /[\u0000-\u001f\u007f]/.test(input.guestName)) return null;
  if (!['yes', 'no'].includes(input.attending)) return null;
  if (input.attending === 'yes' && (!Number.isInteger(input.guestCount) || input.guestCount < 1 || input.guestCount > 12)) return null;
  if (typeof input.message !== 'string' || input.message.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.message)) return null;
  if (input.website !== undefined && input.website !== '') return null;
  return {submissionId: input.submissionId.toLowerCase(), guestName: input.guestName.trim(), attending: input.attending,
    guestCount: input.attending === 'yes' ? input.guestCount : 0, message: input.message};
}

function configured(env) {
  try {
    const url = new URL(env.RSVP_APPS_SCRIPT_URL);
    return url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port && !url.username && !url.password && !url.search && !url.hash &&
      /^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url.pathname) && typeof env.RSVP_RELAY_SECRET === 'string' && env.RSVP_RELAY_SECRET.length >= 32;
  } catch { return false; }
}

export async function handleRsvp(request, env, fetchUpstream = fetch) {
  if (request.method !== 'POST') return json(405, {saved: false, error: 'Please submit using the RSVP form.'}, {Allow: 'POST'});
  const url = new URL(request.url);
  // Browser requests must originate on this invitation; no cross-origin API.
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json(403, {saved: false, error: 'Please submit from the invitation page.'});
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json(415, {saved: false, error: 'Please submit using the RSVP form.'});
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return json(413, {saved: false, error: 'Your reply is too long.'});
  let payload;
  try { payload = validate(JSON.parse(await limitedText(request.body))); }
  catch { return json(400, {saved: false, error: 'Please check your name, attendance and message.'}); }
  if (!payload) return json(400, {saved: false, error: 'Please check your name, attendance and message.'});
  if (!configured(env)) return json(503, {saved: false, error: 'RSVP is not ready to receive replies yet. Please try again later.'});
  try {
    const response = await fetchUpstream(env.RSVP_APPS_SCRIPT_URL, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...payload, relaySecret: env.RSVP_RELAY_SECRET}),
      redirect: 'follow', signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) return json(502, {saved: false, error: UNCONFIRMED});
    const acknowledgement = JSON.parse(await limitedText(response.body));
    if (acknowledgement.saved === false && acknowledgement.error === 'try_later') return json(429, {saved: false, error: 'RSVP is receiving many replies. Please try again later.'}, {'Retry-After': '60'});
    // Apps Script returns pending only after writing AND reading back the
    // private property queue (or finding the identical queued submission).
    // Receipt is sufficient for the guest to leave; the trigger owns delivery.
    // Keep saved:false: a queued response is not yet a confirmed Sheet row.
    if (acknowledgement.saved === false && acknowledgement.pending === true &&
        acknowledgement.submissionId === payload.submissionId &&
        acknowledgement.error === undefined && acknowledgement.retryable === undefined) {
      return json(202, {saved: false, pending: true, received: true, submissionId: payload.submissionId});
    }
    // A lock-busy response does NOT prove durable receipt. Never acknowledge it
    // as received, even if an inconsistent upstream response also says pending.
    if (acknowledgement.saved === false && acknowledgement.submissionId === payload.submissionId &&
        acknowledgement.retryable === true && acknowledgement.error === 'busy') {
      return json(202, {saved: false, pending: true, submissionId: payload.submissionId}, {'Retry-After': '5'});
    }
    if (acknowledgement.saved !== true || acknowledgement.submissionId !== payload.submissionId) return json(502, {saved: false, error: UNCONFIRMED});
    return json(200, {saved: true, submissionId: payload.submissionId});
  } catch { return json(502, {saved: false, error: UNCONFIRMED}); }
}

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/api/rsvp') {
      const delivery = handleRsvp(request, env);
      // Keep the bounded upstream request alive if the guest disconnects.
      // This is not the durable queue: success still awaits Google's receipt.
      ctx?.waitUntil(delivery.then(() => undefined));
      return delivery;
    }
    return env.ASSETS.fetch(request);
  }
};
