const KEY = 'ct.v1';

export const STATUSES = ['estimate', 'proposal', 'booked', 'done'];

const load = () => {
  try {
    return { jobs: [], entries: [], active: null, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { jobs: [], entries: [], active: null };
  }
};

let state = load();

const save = () => {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event('ct-change'));
};

const id = () => crypto.randomUUID();

export const getState = () => state;
export const jobById = (jobId) => state.jobs.find((j) => j.id === jobId);

export const saveJob = (job) => {
  const i = state.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) state.jobs[i] = job;
  else state.jobs.push({ ...job, id: id() });
  save();
};

export const deleteJob = (jobId) => {
  state.jobs = state.jobs.filter((j) => j.id !== jobId);
  state.entries = state.entries.filter((e) => e.jobId !== jobId);
  if (state.active?.jobId === jobId) state.active = null;
  save();
};

export const clockOn = (jobId) => {
  if (state.active) clockOff();
  state.active = { jobId, start: Date.now() };
  save();
};

export const clockOff = () => {
  if (!state.active) return;
  state.entries.push({ id: id(), jobId: state.active.jobId, start: state.active.start, end: Date.now() });
  state.active = null;
  save();
};

export const deleteEntry = (entryId) => {
  state.entries = state.entries.filter((e) => e.id !== entryId);
  save();
};

export const replaceAll = (data) => {
  state = { jobs: data.jobs ?? [], entries: data.entries ?? [], active: data.active ?? null };
  save();
};

// Formatting helpers
export const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDur = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
export const fmtHours = (ms) => (ms / 3600000).toFixed(2);
export const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
