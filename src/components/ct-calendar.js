import { html } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, dateKey } from '../lib/store.js';

class CtCalendar extends CtElement {
  static properties = { month: { state: true }, selected: { state: true } };
  constructor() {
    super();
    this.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    this.selected = dateKey(new Date());
  }

  _shift(n) {
    this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1);
  }

  render() {
    const y = this.month.getFullYear();
    const m = this.month.getMonth();
    const lead = this.month.getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const jobs = getState().jobs.filter((j) => j.date);
    const on = (k) => jobs.filter((j) => j.date === k);
    const today = dateKey(new Date());
    const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

    return html`
      <div class="cal-head">
        <button class="btn ghost" aria-label="Previous month" @click=${() => this._shift(-1)}>‹</button>
        <h2>${this.month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
        <button class="btn ghost" aria-label="Next month" @click=${() => this._shift(1)}>›</button>
      </div>
      <div class="grid">
        ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => html`<span class="dow">${d}</span>`)}
        ${cells.map((d) => {
          if (!d) return html`<span></span>`;
          const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const list = on(k);
          return html`<button class="day ${k === today ? 'today' : ''} ${k === this.selected ? 'sel' : ''}" @click=${() => (this.selected = k)}>
            ${d}<span class="dots">${list.slice(0, 3).map((j) => html`<i class="dot ${j.status}"></i>`)}</span>
          </button>`;
        })}
      </div>
      <section class="card">
        <h2>${new Date(this.selected + 'T00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
        ${on(this.selected).length
          ? on(this.selected).map(
              (j) => html`<div class="row"><span>${j.name}</span><span class="badge ${j.status}">${j.status}</span></div>`
            )
          : html`<p class="muted">Nothing booked.</p>`}
        <a class="btn go" href="/jobs/?date=${this.selected}">Add job on this day</a>
      </section>
    `;
  }
}
customElements.define('ct-calendar', CtCalendar);
