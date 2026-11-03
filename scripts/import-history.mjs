// Load the history of the old app (comande.html JSON export) into Supabase.
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=your-secret-key node scripts/import-history.mjs history-export.json
// The secret key is in Supabase → Project Settings → API Keys. Never put it in the website or in git.
// Safe to run more than once: orders already imported are skipped.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'history-export.json';
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY (see the top of this file).');
  process.exit(1);
}
let rows = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(rows)) rows = rows.orders || rows.history;
if (!Array.isArray(rows)) { console.error('The file does not contain a list of orders.'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
let imported = 0, already = 0, errors = 0;
for (let i = 0; i < rows.length; i += 500) {            // in groups of 500
  const { data, error } = await sb.rpc('import_orders', { p_rows: rows.slice(i, i + 500) });
  if (error) { console.error('Error:', error.message); process.exit(1); }
  imported += data.imported; already += data.already_there; errors += data.errors;
}
const days = rows.map(r => r.day).filter(Boolean).sort();
console.log(`${rows.length} orders in the file (${days[0]} → ${days[days.length - 1]}).`);
console.log(`Imported: ${imported} · already there: ${already} · errors: ${errors}`);
