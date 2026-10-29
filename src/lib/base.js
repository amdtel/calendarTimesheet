import { LitElement } from 'lit';

// Light DOM so the global stylesheet applies; re-renders on any store change.
export class CtElement extends LitElement {
  createRenderRoot() {
    return this;
  }
  _sync = () => this.requestUpdate();
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('ct-change', this._sync);
  }
  disconnectedCallback() {
    window.removeEventListener('ct-change', this._sync);
    super.disconnectedCallback();
  }
}
