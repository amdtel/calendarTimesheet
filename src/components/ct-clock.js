import { html, nothing } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, jobById, clockOn, clockOff, fmtDur, fmtTime, dateKey } from '../lib/store.js';

class CtClock extends CtElement {
  _timer = null;
  connectedCallback() {
    super.connectedCallback();
    this._timer = setInterval(() => getState().active && this.requestUpdate(), 1000);
  }
  disconnectedCallback() {
    clearInterval(this._timer);
    super.disconnectedCallback();
  }
  render() {
    const { active, jobs, entries } = getState();
    const open = jobs.filter((j) => j.status !== 'done');
    const today = dateKey(new Date());
    const todays = entries.filter((e) => dateKey(new Date(e.start)) === today);
    const total = todays.reduce((a, e) => a + (e.end - e.start), 0) + (active ? Date.now() - active.start : 0);

    return html`
      <section class="card clock ${active ? 'on' : ''}">
        <p class="muted">${active ? `Working on ${jobById(active.jobId)?.name ?? 'job'}` : 'Clocked off'}</p>
        <div class="big">${active ? fmtDur(Date.now() - active.start) : '00:00:00'}</div>
        ${active
          ? html`<p class="muted">Since ${fmtTime(active.start)}</p>
              <button class="btn stop" @click=${clockOff}>Clock Off</button>`
          : html`
              <select id="job" aria-label="Job">
                ${open.map((j) => html`<option value=${j.id}>${j.name}</option>`)}
              </select>
              <button class="btn go" ?disabled=${!open.length} @click=${() => clockOn(this.querySelector('#job').value)}>
                Clock On
              </button>
              ${!open.length ? html`<p class="muted"><a href="/jobs/">Add a job</a> first.</p>` : nothing}
            `}
      </section>
      <section class="card">
        <h2>Today <span class="muted">${fmtDur(total)}</span></h2>
        ${todays.length
          ? todays.map(
              (e) => html`<div class="row">
                <span>${jobById(e.jobId)?.name ?? 'Deleted job'}</span>
                <span class="muted">${fmtTime(e.start)}–${fmtTime(e.end)} · ${fmtDur(e.end - e.start)}</span>
              </div>`
            )
          : html`<p class="muted">No time logged yet.</p>`}
      </section>
    `;
  }
}
customElements.define('ct-clock', CtClock);
