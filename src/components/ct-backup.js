import { html } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, replaceAll, jobById, entryDuration, entrySegments, segmentDuration } from '../lib/store.js';

const download = (name, text, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

class CtBackup extends CtElement {
  static properties = { msg: { state: true } };
  constructor() {
    super();
    this.msg = '';
  }

  _json() {
    download(`timesheet-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(getState(), null, 2), 'application/json');
  }

  _csv() {
    const q = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const rows = [['job', 'client', 'start', 'end', 'work_hours', 'travel_hours', 'total_hours'].join(',')];
    for (const e of getState().entries) {
      const j = jobById(e.jobId);
      const segments = entrySegments(e);
      rows.push([
        q(j?.name),
        q(j?.client),
        new Date(e.start).toISOString(),
        new Date(e.end).toISOString(),
        (segmentDuration(segments, 'work') / 3600000).toFixed(2),
        (segmentDuration(segments, 'travel') / 3600000).toFixed(2),
        (entryDuration(e) / 3600000).toFixed(2),
      ].join(','));
    }
    download('timesheet.csv', rows.join('\n'), 'text/csv');
  }

  async _import(e) {
    const file = e.target.files[0];
    if (!file || !confirm('Replace all data on this device with this backup?')) return;
    try {
      replaceAll(JSON.parse(await file.text()));
      this.msg = 'Backup restored.';
    } catch {
      this.msg = 'Could not read that file.';
    }
  }

  render() {
    const { jobs, entries } = getState();
    return html`
      <section class="card">
        <h2>Your data</h2>
        <p class="muted">${jobs.length} jobs · ${entries.length} time entries, stored on this device.</p>
        <button class="btn go" @click=${this._json}>Export backup (JSON)</button>
        <button class="btn ghost" @click=${this._csv}>Export timesheet (CSV)</button>
      </section>
      <section class="card">
        <h2>Restore</h2>
        <input type="file" accept="application/json" @change=${this._import} />
        <p class="muted">${this.msg}</p>
      </section>
    `;
  }
}
customElements.define('ct-backup', CtBackup);
