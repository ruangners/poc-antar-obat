function trustedAppsScriptMessageOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    return u.hostname === 'script.google.com' ||
      u.hostname === 'script.googleusercontent.com' ||
      u.hostname.endsWith('.googleusercontent.com');
  } catch (_) {
    return false;
  }
}

export class AppsScriptFormTransport {
  constructor({ endpoint, timeoutMs = 20000, onState = () => {} }) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.onState = onState;
    this.ready = false;
    this.pending = new Map();
    this.nonce = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    this.boundMessage = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundMessage);
  }

  async connect() {
    this.ready = false;
    this.onState({ ready:false, message:'Menguji koneksi backend...' });
    try {
      const result = await this.call('ping');
      this.ready = true;
      const version = result?.data?.version || '';
      this.onState({ ready:true, message:`Backend siap • ${version}` });
      return result;
    } catch (error) {
      this.ready = false;
      this.onState({ ready:false, message:`Gagal terhubung • ${error.message}` });
      throw error;
    }
  }

  handleMessage(event) {
    const msg = event.data || {};
    if (msg.type !== 'POC_RPC_RESPONSE' || msg.nonce !== this.nonce || !msg.id) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;

    // Apps Script HtmlService dijalankan di sandbox iframe pada domain Google.
    // Sumber pesan dapat berasal dari frame internal, jadi validasi memakai domain Google + nonce/id.
    if (!trustedAppsScriptMessageOrigin(event.origin)) {
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.cleanup();
      pending.reject(new Error(`Origin respons tidak dipercaya: ${event.origin || '(kosong)'}`));
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    pending.cleanup();
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error?.message || 'Apps Script transport error'));
  }

  call(method, ...args) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const frameName = `poc_rpc_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.name = frameName;
      frame.title = 'Apps Script RPC';
      frame.style.display = 'none';
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = this.endpoint;
      form.target = frameName;
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'rpc';
      input.value = JSON.stringify({
        type: 'POC_RPC_REQUEST',
        id,
        nonce: this.nonce,
        method,
        args,
        origin: location.origin
      });
      form.appendChild(input);
      document.body.appendChild(form);

      const cleanup = () => {
        try { form.remove(); } catch (_) {}
        try { frame.remove(); } catch (_) {}
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        reject(new Error(`Timeout ${this.timeoutMs/1000} detik saat memanggil ${method}.`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer, cleanup });
      form.submit();
      setTimeout(() => { try { form.remove(); } catch (_) {} }, 0);
    });
  }
}

export class PocApi {
  constructor(transport) { this.transport = transport; }
  ping() { return this.transport.call('ping'); }
  createSession() { return this.transport.call('createSession', { origin:location.origin, userAgent:navigator.userAgent }); }
  writeDummy(token, payload) { return this.transport.call('writeDummy', token, payload); }
  readRows(token) { return this.transport.call('readRows', token); }
  resetRows(token) { return this.transport.call('resetRows', token); }
  forceError(token) { return this.transport.call('forceError', token); }
}
