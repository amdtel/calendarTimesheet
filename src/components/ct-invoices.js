import { html, nothing } from 'lit';
import { CtElement } from '../lib/base.js';
import { getState, jobById, saveInvoice, deleteInvoice, nextInvoiceNumber, entryDuration, entrySegments, segmentDuration, dateKey } from '../lib/store.js';

const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value || 0);

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
        const hours = Math.round((entryDuration(entry) / 3600000) * 100) / 100;
        const travelHours = Math.round((segmentDuration(entrySegments(entry), 'travel') / 3600000) * 100) / 100;
        return {
          description: `${job.name} · ${dateKey(new Date(entry.start))}${travelHours ? ` · includes ${travelHours}h travel` : ''}`,
          quantity: hours,
          rate,
          amount: Math.round(hours * rate * 100) / 100,
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
      billingType: this.billingType,
      date: dateKey(new Date()),
      status: 'draft',
      entryIds,
      lines,
      total: Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100,
    });
    this.invoiceId = invoice.id;
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
    const { jobs, invoices = [] } = getState();
    const selected = invoices.find((invoice) => invoice.id === this.invoiceId);
    const job = jobById(this.jobId);
    const jobDraft = job ? invoices.find((invoice) => invoice.jobId === job.id && invoice.status === 'draft') : null;
    const unbilled = job ? this._unbilledEntries(job.id, jobDraft?.id) : [];
    const fixedAlreadyInvoiced = job && invoices.some((invoice) => invoice.jobId === job.id && invoice.billingType === 'fixed' && invoice.status !== 'draft');
    const rate = Number(job?.hourlyRate || 0);
    const hours = unbilled.reduce((sum, entry) => sum + entryDuration(entry), 0) / 3600000;
    const canCreate = this.billingType === 'hourly' ? rate > 0 && unbilled.length > 0 : Number(job?.amount) > 0 && !fixedAlreadyInvoiced;

    return html`
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
                ? html`<p class="muted">${unbilled.length} ${jobDraft ? 'sessions in this draft' : 'unbilled job sessions'} · ${hours.toFixed(2)} hours including travel · ${money(rate)}/hour</p>
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
        ? html`<section class="invoice-paper">
            <div class="invoice-heading">
              <div><p class="muted">INVOICE</p><h2>${selected.number}</h2></div>
              <div><p><strong>Date</strong><br />${selected.date}</p><p><strong>Status</strong><br />${selected.status}</p></div>
            </div>
            <div class="invoice-party"><p class="muted">BILL TO</p><strong>${selected.client}</strong><p>${selected.jobName}</p></div>
            <div class="invoice-table">
              <div class="invoice-line invoice-labels"><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span></div>
              ${selected.lines.map((line) => html`<div class="invoice-line"><span>${line.description}</span><span>${line.quantity}</span><span>${money(line.rate)}</span><strong>${money(line.amount)}</strong></div>`)}
            </div>
            <div class="invoice-total"><span>Total due</span><strong>${money(selected.total)}</strong></div>
            <p class="muted">No tax applied.</p>
            <div class="invoice-controls no-print">
              <label>Status
                <select .value=${selected.status} @change=${(e) => this._setStatus(selected, e)}>
                  ${['draft', 'sent', 'paid'].map((status) => html`<option value=${status}>${status}</option>`)}
                </select>
              </label>
              <button class="btn go" @click=${() => window.print()}>Print / Save PDF</button>
              ${selected.status === 'draft' ? html`<button class="btn stop" @click=${() => this._deleteDraft(selected)}>Delete draft</button>` : nothing}
            </div>
          </section>`
        : nothing}
    `;
  }
}

customElements.define('ct-invoices', CtInvoices);