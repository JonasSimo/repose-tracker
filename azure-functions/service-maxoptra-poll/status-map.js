'use strict';

// ─────────────────────────────────────────────────────────────────────────
// status-map — translate a Maxoptra order's raw status into the friendly pill
// text stored in TICKET LOG / shown on the Service dashboard.
// ─────────────────────────────────────────────────────────────────────────

function fmtDateLocal(d) {
  if (!d || isNaN(d.getTime())) return '';
  // Force Europe/London timezone regardless of server locale (Azure default is UTC).
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', '');
}

function fmtDateOnly(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'short'
  });
}

// rawStatus → friendly pill. scheduledTime = Maxoptra plannedArrivalTime,
// completedAt = completion timestamp.
function mapMaxoptraStatus(rawStatus, scheduledTime, completedAt) {
  const s = String(rawStatus || '').trim().toLowerCase();
  const sched = scheduledTime ? new Date(scheduledTime) : null;
  const done  = completedAt ? new Date(completedAt) : null;

  if (s === 'cancelled' || s === 'canceled' || s === 'failed' || s === 'rejected') {
    return `❌ Collection ${s} · please rebook`;
  }
  if (s === 'completed' || s === 'delivered' || s === 'finished') {
    const when = fmtDateOnly(done || sched);
    return when ? `✅ In factory · ${when}` : `✅ In factory`;
  }
  if (s === 'inprogress' || s === 'in_progress' || s === 'in progress' ||
      s === 'enroute'    || s === 'en_route'    || s === 'moving'      ||
      s === 'onway'      || s === 'on_way'      || s === 'on way') {
    return `🚚 On way to customer`;
  }
  if (s === 'arrived' || s === 'atcustomer' || s === 'at_customer' || s === 'at customer') {
    return `🚚 At customer · collecting`;
  }
  if (s === 'departed' || s === 'pickedup' || s === 'picked_up' || s === 'picked up') {
    return `🚚 Collected · returning to factory`;
  }
  if (s === 'planned' || s === 'scheduled' || s === 'assigned' || s === 'locked') {
    const when = fmtDateLocal(sched);
    return when ? `📅 Scheduled · ${when}` : `📅 Scheduled`;
  }
  // Maxoptra terms for "booked but not yet in a planned route".
  if (s === 'unallocated' || s === 'unscheduled' || s === 'created') {
    return `🗓️ Awaiting collection planning`;
  }
  // Any other status Maxoptra reports — e.g. "accepted" — isn't in the explicit
  // lists above. Rather than surfacing the cryptic raw word, infer the real
  // state from the data: if Maxoptra has planned a collection time it IS
  // scheduled (show it), otherwise it's still awaiting planning.
  const when = fmtDateLocal(sched);
  if (when) return `📅 Scheduled · ${when}`;
  return `🗓️ Awaiting collection planning`;
}

module.exports = { mapMaxoptraStatus, fmtDateLocal, fmtDateOnly };
