'use strict';

// Graph client for assembly-backlog-report. App-only MSAL token (same pattern
// as pod-auto-send/graph.js + daily-report). Adds graphGet for Workbook reads
// and an HTML sendMail with an optional generic file attachment.

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

let _msal = null, _token = null, _tokenExpiry = 0;

function getMsalApp() {
  if (_msal) return _msal;
  _msal = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET,
    },
  });
  return _msal;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  _token = result.accessToken;
  _tokenExpiry = result.expiresOn?.getTime() || (Date.now() + 3600000);
  return _token;
}

function encodeSharingUrl(link) {
  return 'u!' + Buffer.from(link).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function graphGet(url) {
  const token = await getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Graph GET ${res.status} ${url.slice(0, 120)}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function sendMailWithAttachment({ to, cc = [], subject, html, attachment }) {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`;
  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: (Array.isArray(to) ? to : [to]).map((a) => ({ emailAddress: { address: a } })),
    ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
  };
  if (attachment) {
    message.attachments = [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachment.name,
      contentType: attachment.contentType,
      contentBytes: attachment.contentBytes,
    }];
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return null;
}

module.exports = { getToken, encodeSharingUrl, graphGet, sendMailWithAttachment };
