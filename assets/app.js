import { AppsScriptFormTransport, PocApi } from './api-client.js';

const $ = (id) => document.getElementById(id);
const state = { transport:null, api:null, token:sessionStorage.getItem('poc_session_token') || '' };

function log(title, payload) {
  const time = new Date().toLocaleTimeString('id-ID');
  $('log').textContent = `[${time}] ${title}\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}\n\n` + $('log').textContent;
}

function setBridgeState({ready, message}) {
  $('bridgeDot').className = `dot ${ready ? 'ok' : ''}`;
  $('bridgeText').textContent = message;
  document.querySelectorAll('[data-needs-bridge]').forEach(b => b.disabled = !ready);
  updateSessionUi();
}

function updateSessionUi() {
  const has = !!state.token;
  $('sessionBadge').className = `badge ${has ? 'ok' : 'warn'}`;
  $('sessionBadge').textContent = has ? 'SESI AKTIF' : 'BELUM ADA SESI';
  document.querySelectorAll('[data-needs-session]').forEach(b => b.disabled = !has || !state.transport?.ready);
}

function endpointValue() {
  return $('endpoint').value.trim();
}

function saveEndpoint() {
  const url = endpointValue();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(url)) {
    throw new Error('Gunakan URL deployment Apps Script yang berakhir /exec.');
  }
  localStorage.setItem('poc_apps_script_endpoint', url);
  return url;
}

async function connect() {
  try {
    const endpoint = saveEndpoint();
    state.transport = new AppsScriptFormTransport({ endpoint, onState:setBridgeState });
    state.api = new PocApi(state.transport);
    const result = await state.transport.connect();
    log('CONNECT ✓', {endpoint, frontendOrigin:location.origin, result});
    updateSessionUi();
  } catch (e) {
    log('CONNECT ✗', e.message);
  }
}

async function run(name, fn) {
  try {
    const result = await fn();
    log(name + ' ✓', result);
    return result;
  } catch (e) {
    log(name + ' ✗', e.message);
    throw e;
  }
}

async function ping() {
  const r = await run('PING', () => state.api.ping());
  $('pingBadge').className = 'badge ok';
  $('pingBadge').textContent = 'BERHASIL';
  $('pingResult').textContent = r.message || 'Backend terhubung.';
}

async function createSession() {
  const r = await run('CREATE SESSION', () => state.api.createSession());
  state.token = r.data.token;
  sessionStorage.setItem('poc_session_token', state.token);
  updateSessionUi();
}

async function writeDummy() {
  const payload = {
    rmDemo:$('rmDemo').value,
    namaDemo:$('namaDemo').value,
    status:$('statusDemo').value,
    note:$('noteDemo').value
  };
  const r = await run('WRITE DUMMY', () => state.api.writeDummy(state.token, payload));
  $('writeBadge').className = 'badge ok';
  $('writeBadge').textContent = 'TERTULIS';
  await readRows();
  return r;
}

async function readRows() {
  const r = await run('READ ROWS', () => state.api.readRows(state.token));
  const rows = r.data.rows || [];
  $('rowsBody').innerHTML = rows.length ? rows.map(x => `<tr>
    <td>${esc(x.timestamp)}</td><td>${esc(x.rmDemo)}</td><td>${esc(x.namaDemo)}</td><td>${esc(x.status)}</td><td>${esc(x.note)}</td>
  </tr>`).join('') : '<tr><td colspan="5" class="tiny">Belum ada data dummy.</td></tr>';
  $('readBadge').className = 'badge ok';
  $('readBadge').textContent = `${rows.length} BARIS`;
}

async function forceError() {
  try { await run('FORCE ERROR', () => state.api.forceError(state.token)); }
  catch (e) {
    $('errorBadge').className = 'badge ok';
    $('errorBadge').textContent = 'ERROR TERTANGKAP';
  }
}

async function resetRows() {
  if (!confirm('Hapus seluruh baris dummy di TEST_API?')) return;
  await run('RESET ROWS', () => state.api.resetRows(state.token));
  await readRows();
}

function esc(v='') { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

window.poc = { connect, ping, createSession, writeDummy, readRows, forceError, resetRows };

window.addEventListener('DOMContentLoaded', () => {
  $('frontendOrigin').textContent = location.origin;
  $('endpoint').value = localStorage.getItem('poc_apps_script_endpoint') || '';
  updateSessionUi();
  setBridgeState({ready:false,message:'Belum terhubung'});

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(e => log('SERVICE WORKER', e.message));
  }
});
