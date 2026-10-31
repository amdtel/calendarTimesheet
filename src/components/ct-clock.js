import { html, nothing } from 'lit';
import { CtElement } from '../lib/base.js';
import {
  getState,
  jobById,
  clockOn,
  clockOff,
  setClockPhase,
  activeDuration,
  activeSegments,
  entrySegments,
  durationForDate,
  segmentDuration,
  fmtDur,
  fmtTime,
  dateKey,
} from '../lib/store.js';

class CtClock extends CtElement {
  static properties = { startPhase: { state: true } };
  _timer = null;
  constructor() {
    super();
    this.startPhase = 'work';
  }
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
    const todays = entries.filter((entry) => durationForDate(entrySegments(entry), today) > 0);
    const activeToday = active ? durationForDate(activeSegments(active), today) : 0;
    const total = todays.reduce((sum, entry) => sum + durationForDate(entrySegments(entry), today), 0) + activeToday;
    const sessionSegments = active ? activeSegments(active) : [];
    const sessionWork = segmentDuration(sessionSegments, 'work');
    const sessionTravel = segmentDuration(sessionSegments, 'travel');
    const phaseName = active?.phase === 'travel' ? 'Travel' : active?.phase === 'paused' ? 'Paused' : 'Work';

    return html`
      <section class="card clock ${active?.phase !== 'paused' && active ? 'on' : ''}">
        <p class="muted">${active ? `${phaseName} · ${jobById(active.jobId)?.name ?? 'job'}` : 'Clocked off'}</p>
        <div class="big">${active ? fmtDur(activeDuration(active)) : '00:00:00'}</div>
        ${active
          ? html`
              <p class="muted">Session started ${fmtTime(active.start)} · Work ${fmtDur(sessionWork)} · Travel ${fmtDur(sessionTravel)}</p>
              ${active.phase === 'paused'
                ? html`<p class="muted">${active.pauseReason === 'overnight' ? 'Paused for today. Resume when you return to the job.' : 'Break in progress.'}</p>
                    <div class="actions">
                      <button class="btn go" @click=${() => setClockPhase('work')}>Resume work</button>
                      <button class="btn ghost" @click=${() => setClockPhase('travel')}>Resume travel</button>
                    </div>`
                : html`
                    <div class="phase-actions">
                      <button class="btn ${active.phase === 'work' ? 'go' : 'ghost'}" ?disabled=${active.phase === 'work'} @click=${() => setClockPhase('work')}>Work</button>
                      <button class="btn ${active.phase === 'travel' ? 'go' : 'ghost'}" ?disabled=${active.phase === 'travel'} @click=${() => setClockPhase('travel')}>Travel</button>
                    </div>
                    <button class="btn ghost" @click=${() => setClockPhase('paused', 'break')}>Pause for break</button>
                    <button class="btn ghost" @click=${() => setClockPhase('paused', 'overnight')}>End day, resume later</button>
                  `}
              <button class="btn stop" @click=${() => confirm('Finish this job session?') && clockOff()}>Finish job</button>
            `
          : html`
              <select id="job" aria-label="Job">
                ${open.map((j) => html`<option value=${j.id}>${j.name}</option>`)}
              </select>
              <select aria-label="Starting phase" .value=${this.startPhase} @change=${(e) => (this.startPhase = e.target.value)}>
                <option value="work">Start working</option>
                <option value="travel">Start travelling</option>
              </select>
              <button class="btn go" ?disabled=${!open.length} @click=${() => clockOn(this.querySelector('#job').value, this.startPhase)}>
                Start session
              </button>
              ${!open.length ? html`<p class="muted"><a href="/jobs/">Add a job</a> first.</p>` : nothing}
            `}
      </section>
      <section class="card">
        <h2>Today <span class="muted">${fmtDur(total)}</span></h2>
        ${todays.length || activeToday
          ? todays.map(
              (entry) => html`<div class="row">
                <span>${jobById(entry.jobId)?.name ?? 'Deleted job'}</span>
                <span class="muted">${fmtTime(entry.start)}–${fmtTime(entry.end)} · ${fmtDur(durationForDate(entrySegments(entry), today))}</span>
              </div>`
            )
          : nothing}
        ${activeToday
          ? html`<div class="row"><span>${jobById(active.jobId)?.name ?? 'Deleted job'} · In progress</span><span class="muted">${fmtDur(activeToday)}</span></div>`
          : nothing}
        ${!todays.length && !activeToday ? html`<p class="muted">No time logged yet.</p>` : nothing}
      </section>
    `;
  }
}
customElements.define('ct-clock', CtClock);
