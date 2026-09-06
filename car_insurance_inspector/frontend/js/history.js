/**
 * AutoClaim Pro - Claims Archive & Survey Dossier Vault
 */

class ClaimsHistoryManager {
  constructor() {
    this.container = document.getElementById("historyGrid");
    this.searchInput = document.getElementById("historySearchInput");
    this.severityFilter = document.getElementById("historySeverityFilter");
    this.emptyState = document.getElementById("historyEmptyState");

    this._initEventListeners();
  }

  _initEventListeners() {
    if (this.searchInput) {
      let debounceTimer;
      this.searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => this.loadHistory(), 300);
      });
    }

    if (this.severityFilter) {
      this.severityFilter.addEventListener("change", () => this.loadHistory());
    }
  }

  formatINR(amount) {
    const num = Number(amount) || 0;
    return "₹ " + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async loadHistory() {
    if (!this.container) return;
    this.container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      <div class="ai-spinner" style="width: 36px; height: 36px; margin: 0 auto 12px;"></div>
      Loading claims archive from secure cloud vault...
    </div>`;

    const query = this.searchInput ? this.searchInput.value.trim() : "";
    const severity = this.severityFilter ? this.severityFilter.value : "All";

    const params = new URLSearchParams();
    if (query) params.append("query", query);
    if (severity && severity !== "All") params.append("severity", severity);

    try {
      const endpoint = window.getApiUrl ? window.getApiUrl(`/api/inspections?${params.toString()}`) : `/api/inspections?${params.toString()}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.renderHistory(data.inspections || []);
    } catch (err) {
      console.error("Failed to load history:", err);
      this.container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--accent-red);">
        Failed to fetch records from cloud database: ${err.message}
      </div>`;
    }
  }

  renderHistory(inspections) {
    if (!inspections.length) {
      this.container.innerHTML = "";
      if (this.emptyState) this.emptyState.style.display = "block";
      return;
    }
    if (this.emptyState) this.emptyState.style.display = "none";

    this.container.innerHTML = inspections.map(item => {
      const rep = item.report || {};
      const cost = rep.cost_breakdown || {};
      const risk = rep.claim_risk_level || "LOW";
      const createdDate = new Date(item.created_at).toLocaleDateString("en-IN", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });

      const netAmount = cost.net_payable_inr || cost.gross_total_inr || cost.total_estimated_min_usd || 0;

      return `
        <div class="history-card" data-id="${item.inspection_id}">
          <div class="history-card-header">
            <div>
              <div class="history-card-title">${item.vehicle_title || 'Motor Survey'}</div>
              <div class="history-plate">Reg: ${item.license_plate || 'N/A'} • <span class="report-id-pill" style="font-size: 10px; padding: 2px 6px;">${item.inspection_id}</span></div>
            </div>
            <span class="badge-tag badge-${rep.findings?.[0]?.severity || 'Minor'}">${risk} RISK</span>
          </div>

          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">
            ${rep.executive_summary ? rep.executive_summary.substring(0, 110) + '...' : 'Damage survey complete.'}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin-top: 4px;">
            <span style="color: var(--text-muted);">${rep.findings?.length || 0} damage items</span>
            <span style="color: var(--accent-green); font-weight: 700; font-family: var(--font-mono);">
              Net Payable: ${this.formatINR(netAmount)}
            </span>
          </div>

          <div class="history-card-footer">
            <span>${createdDate}</span>
            <div style="display: flex; gap: 8px;">
              <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="claimsHistory.viewInspection('${item.inspection_id}', event)">View Dossier</button>
              <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; color: var(--accent-red);" onclick="claimsHistory.deleteInspection('${item.inspection_id}', event)">✕</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  async viewInspection(inspectionId, event) {
    if (event) event.stopPropagation();
    try {
      const endpoint = window.getApiUrl ? window.getApiUrl(`/api/inspections/${inspectionId}`) : `/api/inspections/${inspectionId}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Could not fetch survey record");
      const fullDoc = await res.json();
      
      if (window.appController) {
        window.appController.displayExistingReport(fullDoc);
      }
    } catch (err) {
      alert(`Error loading survey ${inspectionId}: ${err.message}`);
    }
  }

  async deleteInspection(inspectionId, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Are you sure you want to delete survey record ${inspectionId} from database?`)) return;

    try {
      const endpoint = window.getApiUrl ? window.getApiUrl(`/api/inspections/${inspectionId}`) : `/api/inspections/${inspectionId}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete record");
      this.loadHistory();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }
}

window.claimsHistory = new ClaimsHistoryManager();
