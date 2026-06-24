'use strict';

// Decides which (if any) trade customer a POD belongs to, based on the
// client names looked up from the production plan for its REPs.
//
// Phase 2 LIVE scope is exactly two trade customers — Charterhouse and
// Grosvenor. All other plan-client values mean "don't auto-send"
// (residential / OSKA / BRISTOL MAID / etc — manual workflow continues).

function getCustomerMap() {
  return {
    CHARTERHOUSE: {
      label: 'Charterhouse Mobility',
      email: process.env.POD_CUSTOMER_CHARTERHOUSE_EMAIL || '',
    },
    GROSVENOR: {
      label: 'Grosvenor Mobility',
      email: process.env.POD_CUSTOMER_GROSVENOR_EMAIL || '',
    },
  };
}

function matchTradeCustomer(clientName) {
  const u = String(clientName || '').toUpperCase();
  if (u.includes('CHARTERHOUSE')) return 'CHARTERHOUSE';
  if (u.includes('GROSVENOR'))    return 'GROSVENOR';
  return null;
}

// Given an array of client-name strings looked up from the plan, returns
//   { customer: 'CHARTERHOUSE'|'GROSVENOR', label, email } when ALL matched
//     plan-clients resolve to the same trade customer.
//   null when no plan-client is a trade customer, or the POD spans
//     multiple different trade customers (which would be ambiguous).
function resolveTradeCustomer(clientNames) {
  const matched = clientNames.map(matchTradeCustomer).filter(Boolean);
  if (matched.length === 0) return null;
  const unique = [...new Set(matched)];
  if (unique.length > 1) return null; // mixed Charterhouse + Grosvenor — ambiguous
  const customer = unique[0];
  const map = getCustomerMap();
  return { customer, label: map[customer].label, email: map[customer].email };
}

module.exports = { resolveTradeCustomer, matchTradeCustomer, getCustomerMap };
