const KEY = 'ct.v1';

export const STATUSES = ['estimate', 'proposal', 'booked', 'done'];

const normalizeActive = (active) => {
  if (active && !('phase' in active)) {
    active.phase = 'work';
    active.phaseStartedAt = active.start;
    active.segments = [];
  }
  return active;
};

const load = () => {
  try {
    const data = { jobs: [], entries: [], invoices: [], deletedDraftNumbers: [], active: null, ...JSON.parse(localStorage.getItem(KEY)) };
    data.active = normalizeActive(data.active);
    return data;
  } catch {
    return { jobs: [], entries: [], invoices: [], deletedDraftNumbers: [], active: null };
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

export const saveInvoice = (invoice) => {
  if (invoice.status === 'draft') {
    state.invoices = state.invoices.filter((item) => item.jobId !== invoice.jobId || item.status !== 'draft' || item.id === invoice.id);
  }
  const i = state.invoices.findIndex((item) => item.id === invoice.id);
  if (i >= 0) state.invoices[i] = invoice;
  else {
    invoice = { ...invoice, id: id() };
    state.invoices.push(invoice);
  }
  state.deletedDraftNumbers = (state.deletedDraftNumbers ?? []).filter(
    (item) => item.jobId !== invoice.jobId || item.number !== invoice.number
  );
  save();
  return invoice;
};

export const deleteInvoice = (invoiceId) => {
  const index = state.invoices.findIndex((invoice) => invoice.id === invoiceId && invoice.status === 'draft');
  if (index < 0) return false;
  const [invoice] = state.invoices.splice(index, 1);
  state.deletedDraftNumbers ??= [];
  state.deletedDraftNumbers.push({ jobId: invoice.jobId, number: invoice.number });
  save();
  return true;
};

export const nextInvoiceNumber = (jobId) => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const used = new Set(state.invoices.map((invoice) => invoice.number));
  const reusable = state.deletedDraftNumbers?.find(
    (item) => item.jobId === jobId && item.number?.startsWith(prefix) && !used.has(item.number)
  );
  if (reusable) return reusable.number;
  const sequence = state.invoices
    .map((invoice) => invoice.number)
    .filter((number) => number?.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter(Number.isFinite);
  return `${prefix}${String(Math.max(0, ...sequence) + 1).padStart(4, '0')}`;
};

export const deleteJob = (jobId) => {
  state.jobs = state.jobs.filter((j) => j.id !== jobId);
  state.entries = state.entries.filter((e) => e.jobId !== jobId);
  if (state.active?.jobId === jobId) state.active = null;
  save();
};

export const clockOn = (jobId, phase = 'work') => {
  if (state.active) return false;
  const now = Date.now();
  state.active = { jobId, start: now, phase, phaseStartedAt: now, segments: [] };
  save();
  return true;
};

export const setClockPhase = (phase, pauseReason = 'break') => {
  if (!state.active) return;
  const now = Date.now();
  const active = state.active;
  if (active.phaseStartedAt && now > active.phaseStartedAt) {
    active.segments ??= [];
    active.segments.push({ type: active.phase ?? 'work', start: active.phaseStartedAt, end: now });
  }
  active.phase = phase;
  active.phaseStartedAt = phase === 'paused' ? null : now;
  active.pausedAt = phase === 'paused' ? now : null;
  active.pauseReason = phase === 'paused' ? pauseReason : null;
  save();
};

export const clockOff = () => {
  if (!state.active) return;
  const active = state.active;
  const now = Date.now();
  if (active.phaseStartedAt && now > active.phaseStartedAt) {
    active.segments ??= [];
    active.segments.push({ type: active.phase ?? 'work', start: active.phaseStartedAt, end: now });
  }
  const segments = active.segments ?? [];
  if (segments.length) {
    state.entries.push({
      id: id(),
      jobId: active.jobId,
      start: active.start,
      end: now,
      segments,
      durationMs: segments.reduce((sum, segment) => sum + segment.end - segment.start, 0),
    });
  }
  state.active = null;
  save();
};

export const entryDuration = (entry) =>
  entry.durationMs ?? entry.segments?.reduce((sum, segment) => sum + segment.end - segment.start, 0) ?? entry.end - entry.start;

export const entrySegments = (entry) => entry.segments ?? [{ type: 'work', start: entry.start, end: entry.end }];

export const segmentDuration = (segments, type) =>
  segments.filter((segment) => segment.type === type).reduce((sum, segment) => sum + segment.end - segment.start, 0);

export const activeDuration = (active, now = Date.now()) => {
  const closed = (active.segments ?? []).reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const current = active.phaseStartedAt ? Math.max(0, now - active.phaseStartedAt) : 0;
  return closed + current;
};

export const activeSegments = (active, now = Date.now()) => [
  ...(active.segments ?? []),
  ...(active.phaseStartedAt ? [{ type: active.phase ?? 'work', start: active.phaseStartedAt, end: now }] : []),
];

export const durationForDate = (segments, date) => {
  const dayStart = new Date(`${date}T00:00:00`);
  const startOfDay = dayStart.getTime();
  dayStart.setDate(dayStart.getDate() + 1);
  const endOfDay = dayStart.getTime();
  return segments.reduce((sum, segment) => {
    const start = Math.max(segment.start, startOfDay);
    const end = Math.min(segment.end, endOfDay);
    return sum + Math.max(0, end - start);
  }, 0);
};

export const deleteEntry = (entryId) => {
  state.entries = state.entries.filter((e) => e.id !== entryId);
  save();
};

export const replaceAll = (data) => {
  state = {
    jobs: data.jobs ?? [],
    entries: data.entries ?? [],
    invoices: data.invoices ?? [],
    deletedDraftNumbers: data.deletedDraftNumbers ?? [],
    active: normalizeActive(data.active ?? null),
  };
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
