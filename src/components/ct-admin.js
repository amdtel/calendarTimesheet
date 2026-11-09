import { LitElement, html } from 'lit';
import { wallets, login, logout, me } from '../lib/wallet.js';

const api = async (method, body) => {
  const res = await fetch('/api/admin/users', { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'request failed'), { status: res.status });
  return data;
};

export class CtAdmin extends LitElement {
  static properties = { user: {}, list: {}, wallets: {}, error: {}, stake: {}, busy: {} };
  createRenderRoot() { return this; }

  constructor() {
    super();
    this.user = null;
    this.list = [];
    this.wallets = [];
    this.error = '';
    this.stake = '';
    this.busy = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    this.user = await me();
    if (this.user) await this.load();
    else this.wallets = wallets();
  }

  async load() {
    try {
      this.list = await api('GET');
    } catch (e) {
      if (e.status === 401 || e.status === 403) { this.user = null; this.wallets = wallets(); }
      this.error = e.message;
    }
  }

  async run(fn) {
    this.busy = true;
    this.error = '';
    this.stake = '';
    try { await fn(); } catch (e) {
      // CIP-30 wallets throw plain objects such as { code, info }.
      this.error = e.message || e.info || 'Sign in failed';
      this.stake = e.stake || '';
    } finally { this.busy = false; }
  }

  signIn(id) {
    return this.run(async () => {
      this.user = await login(id);
      if (this.user.role === 'worker') throw new Error('Admin or office role required');
      await this.load();
    });
  }

  async signOut() {
    await logout();
    this.user = null;
    this.list = [];
    this.wallets = wallets();
  }

  save(e) {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    return this.run(async () => {
      await api('POST', { stake: f.get('stake').trim(), name: f.get('name').trim(), role: f.get('role') });
      form.reset();
      await this.load();
    });
  }

  toggle(u) { return this.run(async () => { await api('POST', { ...u, active: !u.active }); await this.load(); }); }
  remove(u) { return confirm(`Remove ${u.name}?`) && this.run(async () => { await api('DELETE', { stake: u.stake }); await this.load(); }); }

  render() {
    const err = this.error ? html`<p class="muted" role="alert">${this.error}</p>${this.stake ? html`<p class="muted">Your wallet address:</p><code style="word-break:break-all">${this.stake}</code>` : ''}` : '';
    if (!this.user || this.user.role === 'worker') {
      return html`<section class="card"><h2>Admin sign in</h2>
        ${this.wallets.length
          ? this.wallets.map((w) => html`<button class="btn" ?disabled=${this.busy} @click=${() => this.signIn(w.id)}>Sign in with ${w.name}</button>`)
          : html`<p class="muted">No Cardano wallet found. Install or enable a wallet, then reload this page.</p>
            <h2>Cardano wallets</h2>
            <a class="btn ghost" href="https://www.lace.io/" target="_blank" rel="noopener noreferrer">Lace</a>
            <a class="btn ghost" href="https://eternl.io/" target="_blank" rel="noopener noreferrer">Eternl</a>
            <a class="btn ghost" href="https://brave.com/wallet/" target="_blank" rel="noopener noreferrer">Brave Wallet</a>`}
        ${err}</section>`;
    }
    const isAdmin = this.user.role === 'admin';
    return html`
      <section class="card"><h2><span>${this.user.name}</span><span class="badge">${this.user.role}</span></h2>
        <button class="btn ghost" @click=${() => this.signOut()}>Sign out</button>${err}</section>
      ${isAdmin ? html`<form class="card" @submit=${(e) => this.save(e)}><h2>Register user</h2>
        <label>Name<input name="name" required maxlength="80" /></label>
        <label>Wallet address<input name="stake" required placeholder="addr1… or stake1…" autocomplete="off" /></label>
        <label>Role<select name="role"><option value="worker">Worker</option><option value="office">Office</option><option value="admin">Admin</option></select></label>
        <button class="btn" ?disabled=${this.busy}>Save</button></form>` : ''}
      <section class="card"><h2>Users</h2>
        ${this.list.map((u) => html`<div class="row"><div><strong>${u.name}</strong> <span class="badge">${u.role}</span>
          ${u.active ? '' : html`<span class="badge">disabled</span>`}<div class="muted" style="word-break:break-all">${u.stake}</div></div>
          ${isAdmin && !u.fromEnv && u.stake !== this.user.stake ? html`<div class="actions">
            <button class="btn ghost" @click=${() => this.toggle(u)}>${u.active ? 'Disable' : 'Enable'}</button>
            <button class="btn ghost" @click=${() => this.remove(u)}>Remove</button></div>` : ''}</div>`)}
      </section>`;
  }
}
customElements.define('ct-admin', CtAdmin);
