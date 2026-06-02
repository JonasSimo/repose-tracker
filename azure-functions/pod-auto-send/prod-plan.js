'use strict';

// Reads the Repose production plan workbook on SharePoint and returns a
// Map<repDigits, clientName> sourced from column L (REP NNNNNNN) and
// column D (Client Name). Lifted from the proven implementation in
// test-routing.js and daily-report/index.js.
//
// One workbook fetch builds a 10k+ row map; ~30s per call. Caller should
// build per timer tick (not per audit) — see index.js.
//
// Required env vars: TENANT_ID, CLIENT_ID, CLIENT_SECRET.

const fetch = require('node-fetch');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const PROD_SHARING_URL = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQBLf67iYnbQSq2O8UU_zQihARfBedzZcW-CmO0q3v5zC3o?e=nfze02';

let _msal = null;
function getMsalApp() {
  if (_msal) return _msal;
  _msal = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
      clientSecret: process.env.CLIENT_SECRET,
    },
  });
  return _msal;
}

function encodeSharingUrl(link) {
  return 'u!' + Buffer.from(link).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function loadRepClientMap(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : null);
  const warn = (...a) => (log && typeof log.warn === 'function' ? log.warn(...a) : info('[warn]', ...a));

  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  const token = result.accessToken;
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const driveItemRes = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(PROD_SHARING_URL)}/driveItem`,
    { headers: auth }
  );
  if (!driveItemRes.ok) throw new Error(`Graph shares/driveItem ${driveItemRes.status}: ${(await driveItemRes.text()).slice(0, 200)}`);
  const item = await driveItemRes.json();
  const driveId = item.parentReference.driveId;
  const itemId = item.id;

  const sheetsRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`,
    { headers: auth }
  );
  if (!sheetsRes.ok) throw new Error(`Graph worksheets ${sheetsRes.status}: ${(await sheetsRes.text()).slice(0, 200)}`);
  const sheets = await sheetsRes.json();
  const wkSheets = (sheets.value || []).filter(s => /^WK\s*\d+/.test(s.name));

  const repMap = new Map();
  for (const s of wkSheets) {
    try {
      const r = await (await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(s.name)}')/usedRange?$select=values`,
        { headers: auth }
      )).json();
      for (const row of r.values || []) {
        const client = String(row[3] || '').trim();   // column D
        const m = String(row[11] || '').match(/(?<!\d)(\d{7})(?!\d)/); // column L
        if (m && !repMap.has(m[1])) repMap.set(m[1], client);
      }
    } catch (e) {
      warn(`[pod-auto-send] failed to read sheet ${s.name}: ${e.message}`);
    }
  }
  info(`[pod-auto-send] production plan loaded: ${repMap.size} REP entries across ${wkSheets.length} sheets`);
  return repMap;
}

module.exports = { loadRepClientMap };
