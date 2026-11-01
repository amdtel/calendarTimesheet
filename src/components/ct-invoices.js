import { html, nothing } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, jobById, saveInvoice, saveBusiness, deleteInvoice, nextInvoiceNumber, entryDuration, entrySegments, segmentDuration, dateKey } from '../lib/store.js';

const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value || 0);
const roundUpMinutes = (ms) => Math.ceil(ms / 600000 - 1e-9) * 10;
const fmtHrsMins = (minutes) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + Number(days));
  return dateKey(d);
};
const textLines = (text) => String(text ?? '').split('\n').filter(Boolean);

class CtInvoices extends CtElement {
  static properties = { jobId: { state: true }, billingType: { state: true }, invoiceId: { state: true } };

  constructor() {
    super();
    this.jobId = '';
    this.billingType = 'fixed';
    this.invoiceId = '';
  }

  _selectJob(e) {
    this.jobId = e.target.value;
    const job = jobById(this.jobId);
    this.billingType = job?.billingType ?? (job?.amount ? 'fixed' : 'hourly');
  }

  _unbilledEntries(jobId, excludeInvoiceId = '') {
    const billed = new Set(getState().invoices.filter((invoice) => invoice.id !== excludeInvoiceId).flatMap((invoice) => invoice.entryIds ?? []));
    return getState().entries.filter((entry) => entry.jobId === jobId && !billed.has(entry.id));
  }

  _makeInvoice() {
    const job = jobById(this.jobId);
    if (!job) return;
    const invoices = getState().invoices;
    const previousDraft = invoices.find((invoice) => invoice.jobId === job.id && invoice.status === 'draft');
    if (this.billingType === 'fixed' && invoices.some((invoice) => invoice.jobId === job.id && invoice.billingType === 'fixed' && invoice.status !== 'draft')) return;

    let lines;
    let entryIds = [];
    if (this.billingType === 'hourly') {
      const rate = Number(job.hourlyRate);
      const entries = this._unbilledEntries(job.id, previousDraft?.id);
      if (!rate || !entries.length) return;
      entryIds = entries.map((entry) => entry.id);
      lines = entries.map((entry) => {
        const minutes = roundUpMinutes(entryDuration(entry));
        const travelMinutes = Math.round(segmentDuration(entrySegments(entry), 'travel') / 60000);
        return {
          description: `${job.name} · ${dateKey(new Date(entry.start))}${travelMinutes ? ` · includes ${fmtHrsMins(travelMinutes)} travel` : ''}`,
          minutes,
          quantity: minutes / 60,
          rate,
          amount: Math.round((minutes / 60) * rate * 100) / 100,
        };
      });
    } else {
      const amount = Number(job.amount);
      if (!amount) return;
      lines = [{ description: job.name, quantity: 1, rate: amount, amount }];
    }

    const invoice = saveInvoice({
      id: previousDraft?.id,
      number: previousDraft?.number ?? nextInvoiceNumber(job.id),
      jobId: job.id,
      jobName: job.name,
      client: job.client || 'Client',
      clientDetails: {
        contact: job.clientContact ?? '',
        email: job.clientEmail ?? '',
        address: job.clientAddress ?? '',
        ref: job.clientRef ?? '',
      },
      business: { ...getState().business },
      billingType: this.billingType,
      date: dateKey(new Date()),
      status: 'draft',
      entryIds,
      lines,
      total: Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100,
    });
    this.invoiceId = invoice.id;
  }

  _saveBusiness(e) {
    e.preventDefault();
    saveBusiness(Object.fromEntries(new FormData(e.target)));
  }

  _setStatus(invoice, e) {
    saveInvoice({ ...invoice, status: e.target.value });
  }

  _deleteDraft(invoice) {
    if (!confirm(`Delete draft ${invoice.number}? Its number will be reused if you redraft this job.`)) return;
    deleteInvoice(invoice.id);
    this.invoiceId = '';
  }

  render() {
    const { jobs, invoices = [], business = {} } = getState();
    const selected = invoices.find((invoice) => invoice.id === this.invoiceId);
    const job = jobById(this.jobId);
    const jobDraft = job ? invoices.find((invoice) => invoice.jobId === job.id && invoice.status === 'draft') : null;
    const unbilled = job ? this._unbilledEntries(job.id, jobDraft?.id) : [];
    const fixedAlreadyInvoiced = job && invoices.some((invoice) => invoice.jobId === job.id && invoice.billingType === 'fixed' && invoice.status !== 'draft');
    const rate = Number(job?.hourlyRate || 0);
    const hours = unbilled.reduce((sum, entry) => sum + roundUpMinutes(entryDuration(entry)), 0);
    const canCreate = this.billingType === 'hourly' ? rate > 0 && unbilled.length > 0 : Number(job?.amount) > 0 && !fixedAlreadyInvoiced;

    return html`
      <section class="card no-print">
        <details>
          <summary><strong>Your business details</strong></summary>
          <form @submit=${this._saveBusiness}>
            <label>Business name <input name="name" .value=${business.name ?? ''} /></label>
            <label>Address <textarea name="address" rows="3" .value=${business.address ?? ''}></textarea></label>
            <label>Email <input type="email" name="email" .value=${business.email ?? ''} /></label>
            <label>Phone <input name="phone" .value=${business.phone ?? ''} /></label>
            <label>VAT / company number <input name="taxId" .value=${business.taxId ?? ''} /></label>
            <label>Payment terms (days) <input type="number" name="termsDays" min="0" inputmode="numeric" .value=${business.termsDays ?? '14'} /></label>
            <label>Payment details <textarea name="paymentDetails" rows="3" placeholder="Bank name, sort code, account number" .value=${business.paymentDetails ?? ''}></textarea></label>
            <label>Invoice footer note <textarea name="footer" rows="2" .value=${business.footer ?? ''}></textarea></label>
            <button class="btn go">Save business details</button>
          </form>
        </details>
      </section>

      <section class="card no-print">
        <h2>Create invoice</h2>
        <label>Job
          <select .value=${this.jobId} @change=${this._selectJob}>
            <option value="">Choose a job</option>
            ${jobs.map((item) => html`<option value=${item.id}>${item.name}${item.client ? ` · ${item.client}` : ''}</option>`)}
          </select>
        </label>
        ${job
          ? html`
              <label>Billing type
                <select .value=${this.billingType} @change=${(e) => (this.billingType = e.target.value)}>
                  <option value="hourly">Hourly</option>
                  <option value="fixed">Fixed quote</option>
                </select>
              </label>
              ${this.billingType === 'hourly'
                ? html`<p class="muted">${unbilled.length} ${jobDraft ? 'sessions in this draft' : 'unbilled job sessions'} · ${fmtHrsMins(hours)} (rounded up to 10 min per session) including travel · ${money(rate)}/hour</p>
                    ${!rate ? html`<p class="muted">Set an hourly rate on the job before creating an invoice.</p>` : nothing}
                    ${!unbilled.length ? html`<p class="muted">No unbilled sessions for this job.</p>` : nothing}`
                : html`<p class="muted">Fixed quote: ${money(job.amount)}${!Number(job.amount) ? ' · Add a quote amount to this job first.' : fixedAlreadyInvoiced ? ' · An invoice already exists for this fixed quote.' : ''}</p>`}
              ${jobDraft ? html`<p class="muted">Creating a draft replaces ${jobDraft.number} and keeps its invoice number.</p>` : nothing}
              <button class="btn go" ?disabled=${!canCreate} @click=${() => (!jobDraft || confirm(`Replace draft ${jobDraft.number}?`)) && this._makeInvoice()}>
                ${jobDraft ? 'Replace draft invoice' : 'Create draft invoice'}
              </button>
            `
          : nothing}
      </section>

      <section class="card no-print">
        <h2>Invoices</h2>
        ${invoices.length
          ? invoices.slice().sort((a, b) => b.date.localeCompare(a.date)).map(
              (invoice) => html`<button class="row invoice-list-item" @click=${() => (this.invoiceId = invoice.id)}>
                <span><strong>${invoice.number}</strong><br />${invoice.client} · ${invoice.jobName}</span>
                <span>${money(invoice.total)}<br /><span class="badge ${invoice.status}">${invoice.status}</span></span>
              </button>`
            )
          : html`<p class="muted">No invoices created yet.</p>`}
      </section>

      ${selected
        ? this._paper(selected, business)
        : nothing}
    `;
  }

  _paper(selected, currentBusiness) {
    const biz = selected.business ?? currentBusiness;
    const cd = selected.clientDetails ?? {};
    const termsDays = Number(biz.termsDays);
    const hourly = selected.billingType === 'hourly';
    const totalMinutes = hourly ? selected.lines.reduce((sum, line) => sum + (line.minutes ?? Math.round(line.quantity * 60)), 0) : 0;
    return html`<section class="invoice-paper">
            <div class="invoice-heading">
              <div>
                <p class="muted">INVOICE</p><h2>${selected.number}</h2>
                ${biz.name ? html`<p><strong>${biz.name}</strong></p>` : nothing}
                ${textLines(biz.address).map((l) => html`<p class="invoice-small">${l}</p>`)}
                ${biz.email ? html`<p class="invoice-small">${biz.email}</p>` : nothing}
                ${biz.phone ? html`<p class="invoice-small">${biz.phone}</p>` : nothing}
                ${biz.taxId ? html`<p class="invoice-small">${biz.taxId}</p>` : nothing}
              </div>
              <div>
                <p><strong>Date</strong><br />${selected.date}</p>
                ${termsDays > 0 ? html`<p><strong>Due</strong><br />${addDays(selected.date, termsDays)}</p>` : nothing}
                <p><strong>Status</strong><br />${selected.status}</p>
              </div>
            </div>
            <div class="invoice-party">
              <p class="muted">BILL TO</p><strong>${selected.client}</strong>
              ${cd.contact ? html`<p>${cd.contact}</p>` : nothing}
              ${textLines(cd.address).map((l) => html`<p>${l}</p>`)}
              ${cd.email ? html`<p>${cd.email}</p>` : nothing}
              ${cd.ref ? html`<p>Ref: ${cd.ref}</p>` : nothing}
              <p>${selected.jobName}</p>
            </div>
            <div class="invoice-table">
              <div class="invoice-line invoice-labels"><span>Description</span><span>Hrs</span><span>Rate</span><span>Amount</span></div>
              ${selected.lines.map((line) => html`<div class="invoice-line"><span>${line.description}</span><span>${hourly ? fmtHrsMins(line.minutes ?? Math.round(line.quantity * 60)) : '—'}</span><span>${money(line.rate)}${hourly ? '/h' : ''}</span><strong>${money(line.amount)}</strong></div>`)}
            </div>
            ${hourly ? html`<p class="muted">Total time: ${fmtHrsMins(totalMinutes)} (each session rounded up to 10 minutes)</p>` : nothing}
            <div class="invoice-total"><span>Total due</span><strong>${money(selected.total)}</strong></div>
            <p class="muted">No tax applied.</p>
            ${biz.paymentDetails ? html`<div><p class="muted">PAYMENT DETAILS</p>${textLines(biz.paymentDetails).map((l) => html`<p class="invoice-small">${l}</p>`)}</div>` : nothing}
            ${biz.footer ? html`<p class="invoice-small">${biz.footer}</p>` : nothing}
            <div class="invoice-controls no-print">
              <label>Status
                <select .value=${selected.status} @change=${(e) => this._setStatus(selected, e)}>
                  ${['draft', 'sent', 'paid'].map((status) => html`<option value=${status}>${status}</option>`)}
                </select>
              </label>
              <button class="btn go" @click=${() => window.print()}>Print / Save PDF</button>
              ${selected.status === 'draft' ? html`<button class="btn stop" @click=${() => this._deleteDraft(selected)}>Delete draft</button>` : nothing}
            </div>
          </section>`;
  }
}

customElements.define('ct-invoices', CtInvoices);