// The one thing an agent may change in RETJG HUB (Brian, 2026-10-30): a supply request's
// status and what it cost, so an agent that sees the order confirmation in his email
// can record it and the store manager is told it was ordered.
//
// It calls the Supply Request page's OWN two handlers (Save Status, Save Fulfillment)
// through the main worker's agent door (worker.js AGENT_WRITE_ACTIONS), so history, the
// requester's push + email and the 80% budget alert are exactly what a click does.
//
// 🔑 Not in cli/reporting.mjs: that table is read-only by construction and is what the
// CLI (and the reporting key every holder shares) is built from.
import { QUERIES, UsageError, QueryError, argSpec, runQuery } from '../cli/reporting.mjs';

const STATUSES = argSpec('supplyStatus').values;
const MAX_COST = 100_000;
// 🛑 An agent copies this from a vendor's email, so it is untrusted text. Letters, digits and
// a little punctuation only, starting with a letter, digit or #: no markup for the pages that
// show it, and no leading = + - @ for the Reports tab's CSV export (spreadsheet formulas).
const INVOICE_RE = /^[A-Za-z0-9#][A-Za-z0-9 #._\/-]{0,99}$/;

export const WRITE_TOOLS = [{
  name: 'update_supply_request',
  title: 'Update a supply request',
  description: 'Change one supply request as the Supply Request page does: its status, and what the order cost '
    + '(with the invoice or order number). Setting a status notifies the store manager who asked, by push and email, '
    + 'with note as the message; status ordered tells them it was ordered. Typical use, once the order is placed: '
    + 'status ordered, cost (USD, this request\'s share of the order) and invoiceNumber. An ordered request with a cost '
    + 'counts against its store\'s monthly supply budget. Check the request with get_supply_request first, and change '
    + 'only what the user asked for: the answer shows the values before and after.',
  inputSchema: {
    type: 'object',
    properties: {
      requestId: { type: 'string', pattern: '^[0-9a-fA-F]{32}$', description: argSpec('requestId').description },
      status: { type: 'string', enum: STATUSES, description: 'The new status. ordered is the last step.' },
      cost: { type: 'number', minimum: 0, maximum: MAX_COST, description: 'What this request cost, USD (rounded to cents). Replaces any cost already on it.' },
      invoiceNumber: { type: 'string', pattern: INVOICE_RE.source, description: 'The invoice or order number: letters, digits, spaces and # . _ / -, up to 100. Replaces any already on it.' },
      note: { type: 'string', maxLength: 1000, description: 'With a status change: the message the store manager gets. Otherwise it is saved as a comment with the cost or invoice. Not on its own.' },
    },
    required: ['requestId'],
    additionalProperties: false,
  },
  // Not idempotent: a note saved as a comment is added again each time.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}];

export function checkUpdate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new UsageError('arguments must be an object');
  const known = Object.keys(WRITE_TOOLS[0].inputSchema.properties);
  for (const k of Object.keys(args)) {
    if (!known.includes(k)) throw new UsageError(`Unknown argument "${k}". This takes: ${known.join(', ')}`);
  }
  const { requestId, status, cost, invoiceNumber, note } = args;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{32}$/i.test(requestId)) {
    throw new UsageError('requestId must be the 32-character id from get_supply_requests');
  }
  if (status != null && !STATUSES.includes(status)) throw new UsageError(`status must be one of: ${STATUSES.join(', ')}`);
  if (cost != null && !(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost <= MAX_COST)) {
    throw new UsageError(`cost must be a number of dollars from 0 to ${MAX_COST}`);
  }
  const text = (v, name, max) => {
    if (v == null) return undefined;
    if (typeof v !== 'string') throw new UsageError(`${name} must be a string`);
    const t = v.trim();
    if (t.length > max) throw new UsageError(`${name} is at most ${max} characters`);
    return t || undefined;
  };
  const out = {
    id: requestId.toLowerCase(),  // stored lowercase (randomHex)
    status: status ?? undefined,
    cost: cost == null ? undefined : Math.round(cost * 100) / 100,
    invoice: text(invoiceNumber, 'invoiceNumber', 100),
    note: text(note, 'note', 1000),
  };
  if (out.invoice !== undefined && !INVOICE_RE.test(out.invoice)) {
    throw new UsageError('invoiceNumber may hold only letters, digits, spaces and # . _ / -, starting with a letter, digit or #');
  }
  if (out.status === undefined && out.cost === undefined && out.invoice === undefined) {
    throw new UsageError('give at least one of status, cost or invoiceNumber');
  }
  return out;
}

const GET_ONE = QUERIES.find(q => q.name === 'get_supply_request');
const snapshot = (r) => ({ status: r.status, cost: r.cost ?? null, invoiceNumber: r.invoice_number ?? null });

// read(params) → a reporting GET's body; write(action, body) → the agent door's PATCH body.
// Both throw QueryError/ToolError-style errors the caller turns into a tool error.
export async function updateSupplyRequest(args, { read, write }) {
  const u = checkUpdate(args);
  const getOne = () => runQuery(GET_ONE, { requestId: u.id }, read);
  let before;
  try { before = await getOne(); }
  catch (e) {
    if (/ 404:/.test(e.message)) throw new QueryError(`No supply request has id ${u.id}. Find it with get_supply_requests.`);
    throw e;
  }

  const fulfil = u.cost !== undefined || u.invoice !== undefined;
  if (u.status !== undefined && u.status === before.status && !fulfil) {
    throw new QueryError(`The request is already ${u.status}; nothing was changed and the manager was not notified.`);
  }

  // Status first: the budget alert (fulfillment handler) counts only ORDERED requests,
  // so recording the cost after the status lets an order that crosses 80% raise it.
  let statusChanged = false;
  if (u.status !== undefined) {
    const r = await write('supply-request-status', { id: u.id, status: u.status, ...(u.note && { note: u.note }) });
    statusChanged = !r.unchanged;
  }
  // A note rides with a real status change (it is the manager's message); otherwise it
  // is saved as a comment with the cost. The status handler drops it on "unchanged".
  let noteSaved = !!u.note && statusChanged;
  if (fulfil) {
    const body = { id: u.id };
    if (u.cost !== undefined) body.cost = u.cost;
    if (u.invoice !== undefined) body.invoice_number = u.invoice;
    if (u.note && !statusChanged) body.note = u.note;
    try { await write('supply-request-fulfillment', body); noteSaved = !!u.note; }
    catch (e) {
      if (u.status === undefined) throw e;
      throw new QueryError(`The status was ${statusChanged ? 'set to ' + u.status : 'already ' + u.status}, `
        + `but the cost and invoice were NOT saved (${e.message}). Call again with only cost and invoiceNumber`
        + `${u.note && !statusChanged ? ' (and the note, which was not saved either)' : ''}.`);
    }
  }

  // Everything is saved by now. A failed read-back must not look like a failed write,
  // or a retry would save the note twice.
  let after = null, readBack;
  try { after = await getOne(); } catch (e) { readBack = `Saved, but reading it back failed (${e.message}); do not retry, check with get_supply_request.`; }
  return {
    requestId: u.id, store: before.store,
    before: snapshot(before), after: after && snapshot(after),
    ...(readBack && { readBack }),
    statusChanged,
    // notifySupplyStatusChange in worker.js: only on a real change, only to the requester, and
    // in the background, so delivery is not known here.
    managerNotified: statusChanged
      ? `the app is emailing ${before.user_email} (and pushing, if they turned push on); delivery is not confirmed here`
      : 'no: the status did not change',
    ...(u.note && { noteSaved }),
    items: (after || before).items,
  };
}
