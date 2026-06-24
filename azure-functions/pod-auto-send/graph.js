'use strict';

// Microsoft Graph client for pod-auto-send. Mirrors the MSAL +
// /users/{SEND_FROM}/sendMail pattern from azure-functions/daily-report
// (which is already in production — Mail.Send admin consent is granted).

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

let _msal = null;
let _token = null;
let _tokenExpiry = 0;

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

// Send a mail with a single PDF attachment. Returns the Graph message id when
// available (Graph's POST /sendMail returns 202 with no body, so message_id
// will usually be null — we log "sent" anyway).
async function sendMailWithPdf({ to, cc = [], subject, bodyText, pdfBuffer, pdfFilename }) {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`;

  const message = {
    subject,
    body: { contentType: 'Text', content: bodyText },
    toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } })),
    ccRecipients: cc.map(addr => ({ emailAddress: { address: addr } })),
    attachments: [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: pdfFilename,
      contentType: 'application/pdf',
      contentBytes: pdfBuffer.toString('base64'),
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // 202 Accepted, no body
  return null;
}

module.exports = { getToken, sendMailWithPdf };
