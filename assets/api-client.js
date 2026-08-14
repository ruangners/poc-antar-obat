export class AppsScriptBridgeTransport {
  constructor({ endpoint, timeoutMs = 20000, onState = () => {} }) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.onState = onState;
    this.frame = null;
    this.ready = false;
    this.pending = new Map();
    this.nonce = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    this.boundMessage = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundMessage);
  }

  connect() {
    this.destroyFrame();
    this.ready = false;
    this.onState({ ready:false, message:'Menghubungkan bridge...' });
    const frame = document.createElement('iframe');
    frame.id = 'bridgeFrame';
    frame.title = 'Apps Script Bridge';
    frame.src = this.endpoint;
    document.body.appendChild(frame);
    this.frame = frame;
  }

  destroyFrame() {
    if (this.frame) this.frame.remove();
    this.frame = null;
  }

  handleMessage(event) {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    const msg = event.data || {};
    if (msg.type === 'POC_BRIDGE_READY') {
      this.ready = true;
      this.onState({ ready:true, message:`Bridge siap • ${msg.version || ''}` });
      return;
    }
    if (msg.type !== 'POC_RPC_RESPONSE' || msg.nonce !== this.nonce) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error?.message || 'Bridge error'));
  }

  call(method, ...args) {
    if (!this.ready || !this.frame?.contentWindow) return Promise.reject(new Error('Bridge belum siap.'));
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout ${this.timeoutMs/1000} detik saat memanggil ${method}.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.frame.contentWindow.postMessage({
        type:'POC_RPC_REQUEST',
        id,
        nonce:this.nonce,
        method,
        args
      }, '*');
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
