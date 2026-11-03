import './style.css';
import { $, esc } from './data.js';
import { S, configured, start, onChange, onNotify, login, logout, reload, STAFF_EMAIL } from './store.js';
import { mountWork, render, modeChanged, pinPicker, isTablet } from './waiter.js';
import { mountOwner, ownerRender } from './owner.js';
import { toast } from './ui.js';

const app = $('#app');
let mounted = '';

// Tablet layout = wide screen (≥ 760 px) that is not a phone in landscape
const mq = matchMedia('(min-width: 760px) and (min-height: 500px)');
function applyMode() { const t = mq.matches; if (t !== isTablet()) { document.body.classList.toggle('tablet', t); if (mounted === 'work') modeChanged(); } }
document.body.classList.toggle('tablet', mq.matches);
mq.addEventListener('change', applyMode);

function screenFor() {
  if (!configured) return 'setup';
  if (!S.ready) return 'loading';
  if (!S.session) return 'login';
  if (S.role !== 'owner' && S.role !== 'staff') return S.role ? 'norole' : 'loading';
  if (location.hash === '#owner' && S.role === 'owner') return 'owner';
  if (!S.waiter) return 'pin';
  return 'work';
}

function route() {
  const s = screenFor();
  if (s === mounted) { if (s === 'work') render(); if (s === 'owner') ownerRender(); if (s === 'pin' && !$('.pinpad')) pinPicker($('#pinBox'), route); return; }
  mounted = s; document.body.style.overflow = ''; document.querySelectorAll('.scrim,.recv').forEach(e => e.remove());
  document.body.classList.remove('scr-map', 'scr-order');
  scrollTo(0, 0);
  if (s === 'setup') app.innerHTML = gate(`<p>The app is not connected to the database yet.</p><p class="hint">Add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> in Vercel → Settings → Environment Variables, then redeploy. See SETUP.md.</p>`);
  else if (s === 'loading') app.innerHTML = gate('<p class="hint" style="text-align:center">Loading…</p>');
  else if (s === 'login') loginScreen();
  else if (s === 'norole') { app.innerHTML = gate(`<p>This login (<b>${esc(S.email)}</b>) has no role yet.</p><p class="hint">The owner must run step 4 of SETUP.md for it.</p><button class="btn block" id="lo">Log out</button>`); $('#lo').onclick = logout; }
  else if (s === 'pin') {
    app.innerHTML = gate(`<div id="pinBox"></div>${S.role === 'owner' ? '<button class="btn block" id="toOwn" style="margin-top:14px">Owner dashboard</button>' : ''}<button class="linkbtn" id="lo">Log out this device</button>`, 'Who is working?');
    pinPicker($('#pinBox'), route);
    if (navigator.onLine) reload('waiters');
    const to = $('#toOwn'); if (to) to.onclick = () => { location.hash = '#owner'; };
    $('#lo').onclick = logout;
  }
  else if (s === 'owner') mountOwner(app);
  else mountWork(app);
}

function gate(inner, sub) {
  return `<div class="gate"><div class="card2"><h1>Comande</h1><p class="sub">${esc(sub || 'Hotel Concordia · Fugari Bistrot')}</p>${inner}</div></div>`;
}

function loginScreen() {
  let kind = 'staff';
  const draw = () => {
    app.innerHTML = gate(`<div class="seg"><button data-k="staff" class="${kind === 'staff' ? 'on' : ''}">Waiter device</button><button data-k="owner" class="${kind === 'owner' ? 'on' : ''}">Owner</button></div>
      <form id="lf">${kind === 'staff' && STAFF_EMAIL ? '' : `<label class="field">Email<input id="le" type="email" autocomplete="username" required value="${kind === 'staff' ? '' : esc(S.email || '')}"></label>`}
      <label class="field">${kind === 'staff' ? 'Restaurant password' : 'Password'}<input id="lp" type="password" autocomplete="current-password" required></label>
      <p class="err" id="lerr"></p><button class="btn primary block" type="submit">Log in</button></form>
      <p class="hint" style="margin-top:14px">${kind === 'staff' ? 'One time per tablet or phone. Ask the owner for the restaurant password. After this, waiters only use their PIN.' : 'Owner: your own email and password. You see all the history.'}</p>`);
    app.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => { kind = b.dataset.k; draw(); }; });
    $('#lf').onsubmit = async e => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; $('#lerr').textContent = '';
      try { await login(kind === 'staff' && STAFF_EMAIL ? STAFF_EMAIL : $('#le').value, $('#lp').value); if (kind === 'owner') location.hash = '#owner'; route(); }
      catch (er) { $('#lerr').textContent = er.message; btn.disabled = false; }
    };
  };
  draw();
}

// Keep the screen on while the app is open (ignored if the device says no)
let lock = null;
async function wake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch { lock = null; } }
document.addEventListener('visibilitychange', wake);
addEventListener('pointerdown', wake, { once: true });

onNotify(m => toast(m, null, null, 4000));
onChange(route);
addEventListener('hashchange', route);
route();
start().then(route);
wake();

// Offline support (service worker made by vite-plugin-pwa)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
