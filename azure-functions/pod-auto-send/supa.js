'use strict';

// PostgREST helpers for pod-auto-send. Service-role key bypasses RLS.

const fetch = require('node-fetch');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

async function supaSelectOne(table, qs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`;
  const res = await fetch(url, { headers: { ...authHeaders(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Supabase select ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function supaSelectMany(table, qs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`;
  const res = await fetch(url, { headers: { ...authHeaders(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Supabase select ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supaUpsert(table, rows, onConflict) {
  if (!rows.length) return;
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${res.status} on ${table}: ${await res.text()}`);
}

// INSERT that returns null on PK conflict instead of throwing. Used to claim
// an audit_id in pod_send_log before doing the (expensive) PDF + mail work,
// so two parallel timer runs can never double-send.
async function supaInsertIgnoreConflict(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`Supabase insert ${res.status} on ${table}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null; // null = row already existed (duplicate)
}

async function supaUpdate(table, qs, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${res.status} on ${table}: ${await res.text()}`);
}

module.exports = {
  supaSelectOne,
  supaSelectMany,
  supaUpsert,
  supaInsertIgnoreConflict,
  supaUpdate,
};
