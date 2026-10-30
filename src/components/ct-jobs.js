import { html, nothing } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, saveJob, deleteJob, STATUSES } from '../lib/store.js';

class CtJobs extends CtElement {
  static properties = { editing: { state: true }, filter: { state: true } };
  constructor() {
    super();
    this.editing = null;
    this.filter = 'all';
  }

  _new() {
    const p = new URLSearchParams(location.search);
    return { name: '', client: '', status: 'estimate', date: p.get('date') ?? '', amount: '', notes: '' };
  }

  connectedCallback() {
    super.connectedCallback();
    if (new URLSearchParams(location.search).has('date')) this.editing = this._new();
  }

  _submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    saveJob({ ...this.editing, ...Object.fromEntries(f) });
    this.editing = null;
    history.replaceState(null, '', location.pathname);
  }

  _form() {
    const j = this.editing;
    return html`
      <form class="card" @submit=${this._submit}>
        <h2>${j.id ? 'Edit job' : 'New job'}</h2>
        <label>Job name <input name="name" required .value=${j.name} /></label>
        <label>Client <input name="client" .value=${j.client} /></label>
        <label>Status
          <select name="status">
            ${STATUSES.map((s) => html`<option ?selected=${s === j.status}>${s}</option>`)}
          </select>
        </label>
        <label>Date <input type="date" name="date" .value=${j.date} /></label>
        <label>Quote / amount <input type="number" name="amount" step="0.01" inputmode="decimal" .value=${j.amount} /></label>
        <label>Notes <textarea name="notes" rows="3" .value=${j.notes}></textarea></label>
        <div class="actions">
          <button class="btn go">Save</button>
          <button type="button" class="btn ghost" @click=${() => (this.editing = null)}>Cancel</button>
          ${j.id
            ? html`<button type="button" class="btn stop" @click=${() => confirm('Delete job and its time?') && (deleteJob(j.id), (this.editing = null))}>Delete</button>`
            : nothing}
        </div>
      </form>
    `;
  }

  render() {
    const jobs = getState().jobs.filter((j) => this.filter === 'all' || j.status === this.filter);
    return html`
      <div class="jobs-title-row">
        ${!this.editing ? html`<button class="btn go add-job" @click=${() => (this.editing = this._new())}>+ Add job</button>` : nothing}
      </div>
      ${this.editing
        ? this._form()
        : html`
            <div class="chips">
              ${['all', ...STATUSES].map(
                (s) => html`<button class="chip ${this.filter === s ? 'sel' : ''}" @click=${() => (this.filter = s)}>${s}</button>`
              )}
            </div>
            ${jobs.length
              ? jobs.map(
                  (j) => html`<button class="card job" @click=${() => (this.editing = j)}>
                    <strong>${j.name}</strong>
                    <span class="badge ${j.status}">${j.status}</span>
                    <span class="muted">${[j.client, j.date, j.amount && `$${j.amount}`].filter(Boolean).join(' · ')}</span>
                  </button>`
                )
              : html`<p class="muted">No jobs here yet.</p>`}
          `}
    `;
  }
}
customElements.define('ct-jobs', CtJobs);
