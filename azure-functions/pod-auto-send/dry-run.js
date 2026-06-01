'use strict';

// Usage:
//   cd bin/azure-functions
//   $env:SAFETYCULTURE_API_TOKEN = "<token>"
//   node pod-auto-send/dry-run.js <audit_id>
//
// Writes ./pod-<audit_id>.pdf and prints the eligibility verdict + extracted
// REP / order number. Does NOT call Graph or Supabase.

const fs = require('fs');
const path = require('path');
const sc = require('./sc');
const eligibility = require('./eligibility');

(async () => {
  const auditId = process.argv[2];
  if (!auditId) {
    console.error('Usage: node dry-run.js <audit_id>');
    process.exit(1);
  }
  if (!process.env.SAFETYCULTURE_API_TOKEN) {
    console.error('SAFETYCULTURE_API_TOKEN required');
    process.exit(1);
  }

  console.log(`Fetching audit ${auditId}...`);
  const audit = await sc.getAudit(auditId);

  const elig = eligibility.isAuditEligible(audit);
  console.log('Eligibility:', elig);

  const rep = eligibility.extractRepSerial(audit);
  console.log('REP serial:', rep);

  const orderItem = eligibility.findItemByLabel(audit, ['Customer order number', 'Order number']);
  console.log('Customer order number:', orderItem?.responses?.text || null);

  console.log('Requesting PDF export...');
  const pdf = await sc.fetchPodPdf(auditId, (...a) => console.log(...a));
  const out = path.resolve(`pod-${auditId}.pdf`);
  fs.writeFileSync(out, pdf);
  console.log(`PDF written to ${out} (${pdf.length} bytes)`);
})().catch(e => {
  console.error('dry-run failed:', e.message);
  process.exit(1);
});
