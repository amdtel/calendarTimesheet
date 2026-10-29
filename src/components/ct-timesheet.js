import { html } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, jobById, deleteEntry, fmtHours, fmtTime, fmtDur, dateKey } from '../lib/store.js';

class CtTimesheet extends CtElement {
  static properties = { range: { state: true } };
  constructor() {
    super();
    this.range = 'week';
  }

  _since() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (this.range === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (this.range === 'month') d.setDate(1);
    return this.range === 'all' ? 0 : d.getTime();
  }

  render() {
    const since = this._since();
    const entries = getState().entries.filter((e) => e.start >= since).sort((a, b) => b.start - a.start);
    const total = entries.reduce((a, e) => a + (e.end - e.start), 0);
    const byJob = {};
    for (const e of entries) byJob[e.jobId] = (byJob[e.jobId] ?? 0) + (e.end - e.start);
    const days = [...new Set(entries.map((e) => dateKey(new Date(e.start))))];

    return html`
      <div class="chips">
        ${['week', 'month', 'all'].map(
          (r) => html`<button class="chip ${this.range === r ? 'sel' : ''}" @click=${() => (this.range = r)}>${r}</button>`
        )}
      </div>
      <section class="card">
        <h2>Total <span class="muted">${fmtHours(total)} h</span></h2>
        ${Object.entries(byJob).map(
          ([id, ms]) => html`<div class="row"><span>${jobById(id)?.name ?? 'Deleted job'}</span><span>${fmtHours(ms)} h</span></div>`
        )}
      </section>
      ${days.map(
        (day) => html`<section class="card">
          <h2>${new Date(day + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</h2>
          ${entries
            .filter((e) => dateKey(new Date(e.start)) === day)
            .map(
              (e) => html`<div class="row">
                <span>${jobById(e.jobId)?.name ?? 'Deleted job'}<br /><small class="muted">${fmtTime(e.start)}–${fmtTime(e.end)}</small></span>
                <span>${fmtDur(e.end - e.start)}
                  <button class="x" aria-label="Delete entry" @click=${() => confirm('Delete entry?') && deleteEntry(e.id)}>×</button>
                </span>
              </div>`
            )}
        </section>`
      )}
      ${!entries.length ? html`<p class="muted">No time logged in this range.</p>` : ''}
    `;
  }
}
customElements.define('ct-timesheet', CtTimesheet);
