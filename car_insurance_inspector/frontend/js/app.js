/**
 * AutoClaim Pro - Motor Insurance Survey & Damage Valuation System
 * Multi-Stage Workflow: 1. Photos & OCR -> 2. Claim Intake -> 3. Loss Sheet & Price Editor (₹) -> 4. Certified Survey Report
 */

window.getApiUrl = function(path) {
  const base = localStorage.getItem("AUTOCLAIM_API_URL") || window.AUTOCLAIM_API_URL || "";
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}${path}`;
};

class AutoClaimApp {
  constructor() {
    this.sides = ["front", "rear", "left", "right"];
    this.photos = {
      front: { image_b64: null, annotated_image_b64: null, annotations: [] },
      rear: { image_b64: null, annotated_image_b64: null, annotations: [] },
      left: { image_b64: null, annotated_image_b64: null, annotations: [] },
      right: { image_b64: null, annotated_image_b64: null, annotations: [] }
    };
    this.allQuestionsSkipped = false;
    this.autoDetectedOnce = false;

    // Loss Assessment State
    this.lossFindings = [];
    this.preliminaryMeta = {};
    this.currentReport = null;

    this._initElements();
    this._initEventListeners();
    this._initApiSettings();
    this._checkBackendHealth();
  }

  _initElements() {
    this.navInspectBtn = document.getElementById("navInspectBtn");
    this.navArchiveBtn = document.getElementById("navArchiveBtn");

    this.inspectionWizardView = document.getElementById("inspectionWizardView");
    this.claimsArchiveView = document.getElementById("claimsArchiveView");

    this.photoUploadSection = document.getElementById("photoUploadSection");
    this.questionnaireSection = document.getElementById("questionnaireSection");
    this.lossAssessmentSection = document.getElementById("lossAssessmentSection");
    this.reportSection = document.getElementById("reportSection");

    this.btnAnalyzeLossSheet = document.getElementById("btnAnalyzeLossSheet");
    this.btnSkipQuestionnaire = document.getElementById("btnSkipQuestionnaire");
    this.btnAutoDetectVehicle = document.getElementById("btnAutoDetectVehicle");
    this.btnAutoDetectText = document.getElementById("btnAutoDetectText");
    this.loadingOverlay = document.getElementById("loadingOverlay");

    // Stage 3 Loss Sheet Elements
    this.lossTableBody = document.getElementById("lossTableBody");
    this.btnAutoEstimateCustomFlaw = document.getElementById("btnAutoEstimateCustomFlaw");
    this.btnAutoEstimateText = document.getElementById("btnAutoEstimateText");
    this.btnAddCustomItemManual = document.getElementById("btnAddCustomItemManual");
    this.customFlawDescInput = document.getElementById("customFlawDesc");
    this.customFlawSeveritySelect = document.getElementById("customFlawSeverity");

    this.policyDeductibleInput = document.getElementById("policyDeductibleInput");
    this.policyDepreciationSelect = document.getElementById("policyDepreciationSelect");
    this.surveyorFinalRemarks = document.getElementById("surveyorFinalRemarks");
    this.btnGenerateFinalReport = document.getElementById("btnGenerateFinalReport");
    this.btnBackToUpload = document.getElementById("btnBackToUpload");

    // Stepper
    this.stepIndicators = [
      document.getElementById("stepIndicator1"),
      document.getElementById("stepIndicator2"),
      document.getElementById("stepIndicator3"),
      document.getElementById("stepIndicator4")
    ];
    this.stepDividers = [
      document.getElementById("stepDivider1"),
      document.getElementById("stepDivider2"),
      document.getElementById("stepDivider3")
    ];
  }

  _initEventListeners() {
    // Navigation
    this.navInspectBtn.addEventListener("click", () => this.switchTab("inspect"));
    this.navArchiveBtn.addEventListener("click", () => this.switchTab("archive"));

    // Skip questionnaire toggle
    this.btnSkipQuestionnaire.addEventListener("click", () => this.toggleSkipQuestionnaire());

    // AI Auto-detect vehicle button
    if (this.btnAutoDetectVehicle) {
      this.btnAutoDetectVehicle.addEventListener("click", () => this.autoDetectVehicleInfo(false));
    }

    // Stage 1 & 2 -> Stage 3 (Analyze Loss Sheet)
    this.btnAnalyzeLossSheet.addEventListener("click", () => this.runPreliminaryAssessment());

    // Stage 3: Back button
    this.btnBackToUpload.addEventListener("click", () => this.goToStage(1));

    // Stage 3: Custom Flaw Adders
    this.btnAutoEstimateCustomFlaw.addEventListener("click", () => this.autoEstimateAndAddCustomFlaw());
    this.btnAddCustomItemManual.addEventListener("click", () => this.addCustomItemManual());

    // Stage 3: Deductible & Depreciation change
    this.policyDeductibleInput.addEventListener("input", () => this.recalculateSettlement());
    this.policyDepreciationSelect.addEventListener("change", () => this.recalculateSettlement());

    // Stage 3 -> Stage 4 (Finalize Certified Report)
    this.btnGenerateFinalReport.addEventListener("click", () => this.finalizeOfficialReport());

    // Stage 4 Report Actions
    document.getElementById("btnPrintReport").addEventListener("click", () => window.print());
    document.getElementById("btnEditLossSheet").addEventListener("click", () => this.goToStage(3));
    document.getElementById("btnDownloadJson").addEventListener("click", () => this.downloadReportJson());
    document.getElementById("btnNewInspection").addEventListener("click", () => this.resetWizard());

    // File dropzones & inputs for each of the 4 sides
    this.sides.forEach(side => {
      const card = document.getElementById(`photoCard_${side}`);
      const fileInput = document.getElementById(`fileInput_${side}`);
      const previewBox = card.querySelector(".photo-preview-box");
      const annotateBtn = card.querySelector(".btn-annotate");
      const removeBtn = card.querySelector(".btn-remove");

      previewBox.addEventListener("click", () => {
        if (!this.photos[side].image_b64) fileInput.click();
      });

      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          this._handleImageFile(side, e.target.files[0]);
        }
      });

      previewBox.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("dragover");
      });
      previewBox.addEventListener("dragleave", () => card.classList.remove("dragover"));
      previewBox.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this._handleImageFile(side, e.dataTransfer.files[0]);
        }
      });

      annotateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this.photos[side].image_b64) {
          fileInput.click();
          return;
        }
        window.damageAnnotator.open(
          side,
          this.photos[side].image_b64,
          this.photos[side].annotations,
          (sideKey, compositeB64, annotations) => {
            this.photos[sideKey].annotated_image_b64 = compositeB64;
            this.photos[sideKey].annotations = annotations;
            this._updateCardUI(sideKey);
          }
        );
      });

      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.photos[side] = { image_b64: null, annotated_image_b64: null, annotations: [] };
        fileInput.value = "";
        this._updateCardUI(side);
      });
    });
  }

  formatINR(amount) {
    const num = Number(amount) || 0;
    return "₹ " + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  _initApiSettings() {
    const btn = document.getElementById("btnApiSettings");
    const aiBadge = document.getElementById("aiStatusBadge");
    const cloudBadge = document.getElementById("cloudStatusBadge");

    const promptSettings = () => {
      const current = localStorage.getItem("AUTOCLAIM_API_URL") || "";
      const input = prompt(
        "AutoClaim Pro Serverless API Settings:\n\n" +
        "• Leave blank to use default Amplify /api proxy path.\n" +
        "• Or enter a custom Lambda Function URL (e.g. https://xxx.lambda-url.us-east-1.on.aws) or cloud backend URL:",
        current
      );
      if (input !== null) {
        const trimmed = input.trim();
        if (trimmed) {
          localStorage.setItem("AUTOCLAIM_API_URL", trimmed);
        } else {
          localStorage.removeItem("AUTOCLAIM_API_URL");
        }
        this._checkBackendHealth();
      }
    };

    if (btn) btn.addEventListener("click", promptSettings);
    if (aiBadge) aiBadge.addEventListener("click", promptSettings);
    if (cloudBadge) cloudBadge.addEventListener("click", promptSettings);
  }

  async _checkBackendHealth() {
    const aiEl = document.getElementById("aiCoreStatus");
    const aiDot = document.getElementById("aiStatusDot");
    const cloudEl = document.getElementById("cloudVaultStatus");
    const cloudDot = document.getElementById("cloudStatusDot");

    try {
      const res = await fetch(window.getApiUrl("/api/health"));
      if (res.ok) {
        const data = await res.json();
        if (aiEl) {
          aiEl.textContent = data.ai_engine === "online" ? "AI Vision Engine: Active" : "AI Vision: Key Needed";
          aiEl.style.color = data.ai_engine === "online" ? "var(--accent-cyan)" : "var(--accent-amber)";
        }
        if (aiDot) {
          aiDot.className = data.ai_engine === "online" ? "status-dot active" : "status-dot warning";
        }
        if (cloudEl) {
          cloudEl.textContent = data.database === "connected" ? "Secure Cloud Vault: Connected" : "Cloud Vault: Disconnected";
          cloudEl.style.color = data.database === "connected" ? "var(--accent-green)" : "var(--accent-amber)";
        }
        if (cloudDot) {
          cloudDot.className = data.database === "connected" ? "status-dot active" : "status-dot warning";
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("Health check warning:", err.message);
      if (aiEl) {
        aiEl.textContent = "AI Engine: Offline (Configure API)";
        aiEl.style.color = "var(--accent-red)";
      }
      if (aiDot) aiDot.className = "status-dot error";
      if (cloudEl) {
        cloudEl.textContent = "Cloud Vault: Offline";
        cloudEl.style.color = "var(--accent-red)";
      }
      if (cloudDot) cloudDot.className = "status-dot error";
    }
  }

  switchTab(tab) {
    if (tab === "inspect") {
      this.navInspectBtn.classList.add("active");
      this.navArchiveBtn.classList.remove("active");
      this.inspectionWizardView.style.display = "block";
      this.claimsArchiveView.classList.remove("active");
    } else {
      this.navInspectBtn.classList.remove("active");
      this.navArchiveBtn.classList.add("active");
      this.inspectionWizardView.style.display = "none";
      this.claimsArchiveView.classList.add("active");
      window.claimsHistory.loadHistory();
    }
  }

  goToStage(stageNumber) {
    // Stepper styling
    this.stepIndicators.forEach((ind, i) => {
      ind.classList.remove("active", "completed");
      if (i + 1 < stageNumber) ind.classList.add("completed");
      else if (i + 1 === stageNumber) ind.classList.add("active");
    });
    this.stepDividers.forEach((div, i) => {
      if (div) {
        if (i + 1 < stageNumber) div.classList.add("active");
        else div.classList.remove("active");
      }
    });

    if (stageNumber === 1 || stageNumber === 2) {
      this.photoUploadSection.style.display = "block";
      this.questionnaireSection.style.display = "block";
      this.lossAssessmentSection.style.display = "none";
      this.reportSection.classList.remove("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (stageNumber === 3) {
      this.photoUploadSection.style.display = "none";
      this.questionnaireSection.style.display = "none";
      this.lossAssessmentSection.style.display = "block";
      this.reportSection.classList.remove("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (stageNumber === 4) {
      this.photoUploadSection.style.display = "none";
      this.questionnaireSection.style.display = "none";
      this.lossAssessmentSection.style.display = "none";
      this.reportSection.classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  _handleImageFile(side, file) {
    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image file (JPG, PNG, WEBP).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.photos[side].image_b64 = e.target.result;
      this.photos[side].annotated_image_b64 = null;
      this.photos[side].annotations = [];
      this._updateCardUI(side);
    };
    reader.readAsDataURL(file);
  }

  _updateCardUI(side) {
    const card = document.getElementById(`photoCard_${side}`);
    const previewBox = card.querySelector(".photo-preview-box");
    const countBadge = card.querySelector(".annotation-count-badge");
    const data = this.photos[side];

    if (data.image_b64) {
      card.classList.add("has-image");
      const displaySrc = data.annotated_image_b64 || data.image_b64;
      previewBox.innerHTML = `<img src="${displaySrc}" alt="${side} view">`;

      const count = data.annotations ? data.annotations.length : 0;
      if (count > 0) {
        countBadge.style.display = "flex";
        countBadge.innerHTML = `<span>${count} Marks</span>`;
      } else {
        countBadge.style.display = "none";
      }
      card.querySelector(".btn-annotate").style.display = "flex";
      card.querySelector(".btn-remove").style.display = "flex";
    } else {
      card.classList.remove("has-image");
      countBadge.style.display = "none";
      previewBox.innerHTML = `
        <div class="photo-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span class="placeholder-text">Click or drag photo</span>
        </div>
      `;
      card.querySelector(".btn-annotate").style.display = "none";
      card.querySelector(".btn-remove").style.display = "none";
    }

    this._checkFormReady();
  }

  async autoDetectVehicleInfo(isSilent = false) {
    const availableSides = this.sides.filter(s => !!this.photos[s].image_b64);
    if (availableSides.length === 0) {
      if (!isSilent) {
        alert("Please upload at least front or rear photo first so the engine can read the plate and vehicle specs.");
      }
      return;
    }

    if (this.btnAutoDetectVehicle) this.btnAutoDetectVehicle.classList.add("loading");
    if (this.btnAutoDetectText) this.btnAutoDetectText.textContent = "Scanning Specs & Plate...";

    const photosPayload = {};
    availableSides.forEach(side => {
      photosPayload[side] = {
        view: side,
        image_b64: this.photos[side].image_b64,
        annotated_image_b64: this.photos[side].annotated_image_b64,
        annotations: this.photos[side].annotations || []
      };
    });

    try {
      const resp = await fetch(window.getApiUrl("/api/auto-detect-vehicle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: photosPayload })
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      let detectedCount = 0;

      if (data.license_plate) {
        const el = document.getElementById("q_plate");
        el.value = data.license_plate;
        el.classList.add("ai-glow-detected");
        document.getElementById("tag_detected_plate").style.display = "inline-block";
        detectedCount++;
      }

      if (data.make) {
        const el = document.getElementById("q_make");
        el.value = data.make;
        el.classList.add("ai-glow-detected");
        document.getElementById("tag_detected_make").style.display = "inline-block";
        detectedCount++;
      }

      if (data.model) {
        const el = document.getElementById("q_model");
        el.value = data.model;
        el.classList.add("ai-glow-detected");
        document.getElementById("tag_detected_model").style.display = "inline-block";
        detectedCount++;
      }

      if (data.year) {
        const el = document.getElementById("q_year");
        el.value = data.year;
        el.classList.add("ai-glow-detected");
        document.getElementById("tag_detected_year").style.display = "inline-block";
        detectedCount++;
      }

      if (data.primary_impact_hint) {
        const impactSelect = document.getElementById("q_impact");
        for (let i = 0; i < impactSelect.options.length; i++) {
          if (impactSelect.options[i].value.toLowerCase().includes(data.primary_impact_hint.toLowerCase())) {
            impactSelect.selectedIndex = i;
            break;
          }
        }
      }

      this.autoDetectedOnce = true;

      if (this.btnAutoDetectVehicle) this.btnAutoDetectVehicle.classList.remove("loading");
      if (this.btnAutoDetectText) {
        this.btnAutoDetectText.textContent = detectedCount > 0 ? `✓ Auto-Filled (${detectedCount} Specs Detected)` : "Auto-Fill Complete";
      }

      setTimeout(() => {
        document.querySelectorAll(".ai-glow-detected").forEach(el => el.classList.remove("ai-glow-detected"));
      }, 5000);

    } catch (err) {
      console.warn("AI Auto-detection error:", err);
      if (this.btnAutoDetectVehicle) this.btnAutoDetectVehicle.classList.remove("loading");
      if (this.btnAutoDetectText) this.btnAutoDetectText.textContent = "Retry Auto-Fill";
      if (!isSilent) {
        if (err.message && err.message.includes("404")) {
          alert("Backend API not reachable (HTTP 404).\n\nPlease ensure your Amplify serverless backend is deployed with BEDROCK_API_KEY and MONGODB_URI environment variables, or click '⚙️ API' in the header to set your API endpoint.");
        } else {
          alert("Vehicle auto-detection could not extract info: " + err.message);
        }
      }
    }
  }

  toggleSkipQuestionnaire() {
    this.allQuestionsSkipped = !this.allQuestionsSkipped;
    const formFields = document.querySelectorAll(".questionnaire-container .form-control, .questionnaire-container .form-select");

    if (this.allQuestionsSkipped) {
      this.btnSkipQuestionnaire.textContent = "Undo Skip";
      this.btnSkipQuestionnaire.style.background = "var(--accent-amber)";
      this.btnSkipQuestionnaire.style.color = "#070a12";
      formFields.forEach(el => {
        el.disabled = true;
        el.style.opacity = "0.4";
      });
    } else {
      this.btnSkipQuestionnaire.textContent = "Skip Questionnaire";
      this.btnSkipQuestionnaire.style.background = "transparent";
      this.btnSkipQuestionnaire.style.color = "var(--accent-amber)";
      formFields.forEach(el => {
        el.disabled = false;
        el.style.opacity = "1";
      });
    }
  }

  _checkFormReady() {
    const allUploaded = this.sides.every(s => !!this.photos[s].image_b64);
    this.btnAnalyzeLossSheet.disabled = !allUploaded;
    if (allUploaded) {
      this.btnAnalyzeLossSheet.innerHTML = `⚡ Analyze Damage & Open Loss Sheet (₹)`;
      const plateVal = document.getElementById("q_plate").value.trim();
      if (!plateVal && !this.autoDetectedOnce) {
        this.autoDetectVehicleInfo(true);
      }
    } else {
      const missingCount = this.sides.filter(s => !this.photos[s].image_b64).length;
      this.btnAnalyzeLossSheet.innerHTML = `Upload All 4 Angles (${4 - missingCount}/4)`;
    }
  }

  _collectQuestionnaire() {
    if (this.allQuestionsSkipped) {
      return { all_skipped: true, incident_type: "Skipped", drivable: "Skipped", airbags_deployed: "Skipped" };
    }

    return {
      make: document.getElementById("q_make").value.trim() || null,
      model: document.getElementById("q_model").value.trim() || null,
      year: document.getElementById("q_year").value.trim() || null,
      license_plate: document.getElementById("q_plate").value.trim() || null,
      odometer: document.getElementById("q_odometer").value.trim() || null,
      incident_type: document.getElementById("q_incident_type").value,
      drivable: document.getElementById("q_drivable").value,
      airbags_deployed: document.getElementById("q_airbags").value,
      fluid_leakage: document.getElementById("q_leaks").value,
      point_of_impact: document.getElementById("q_impact").value,
      claim_type: document.getElementById("q_policy").value,
      inspector_notes: document.getElementById("q_notes").value.trim() || null,
      all_skipped: false
    };
  }

  // STAGE 1 & 2 -> STAGE 3
  async runPreliminaryAssessment() {
    const missing = this.sides.filter(s => !this.photos[s].image_b64);
    if (missing.length > 0) {
      alert(`Please upload all 4 angles before proceeding. Missing: ${missing.join(", ")}`);
      return;
    }

    const photosPayload = {};
    for (const side of this.sides) {
      photosPayload[side] = {
        view: side,
        image_b64: this.photos[side].image_b64,
        annotated_image_b64: this.photos[side].annotated_image_b64,
        annotations: this.photos[side].annotations || []
      };
    }

    const payload = {
      photos: photosPayload,
      questionnaire: this._collectQuestionnaire()
    };

    this.loadingOverlay.classList.add("active");
    this._animateLoadingSteps();

    try {
      const resp = await fetch(window.getApiUrl("/api/preliminary-assessment"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Server error HTTP ${resp.status}`);
      }

      const data = await resp.json();
      this.loadingOverlay.classList.remove("active");

      // Save state
      this.lossFindings = data.findings || [];
      this.preliminaryMeta = {
        claim_risk_level: data.claim_risk_level || "LOW",
        severity_score: data.severity_score || 25,
        damage_classification: data.damage_classification || "Minor Repairable",
        executive_summary: data.executive_summary || "",
        fraud_consistency_check: data.fraud_consistency_check || "",
        adjuster_recommendation: data.adjuster_recommendation || ""
      };

      // Set metrics in Stage 3
      document.getElementById("loss_risk_level").textContent = this.preliminaryMeta.claim_risk_level;
      document.getElementById("loss_risk_level").className = `metric-value risk-${this.preliminaryMeta.claim_risk_level}`;
      document.getElementById("loss_severity_score").textContent = `${this.preliminaryMeta.severity_score}/100`;
      document.getElementById("loss_classification").textContent = this.preliminaryMeta.damage_classification;

      // Render Stage 3 Loss Table & Recalculate
      this.renderLossTable();
      this.recalculateSettlement();

      // Advance to Stage 3
      this.goToStage(3);

    } catch (err) {
      this.loadingOverlay.classList.remove("active");
      console.error("Preliminary assessment error:", err);
      alert("Damage assessment valuation failed: " + err.message);
    }
  }

  renderLossTable() {
    if (!this.lossTableBody) return;

    this.lossTableBody.innerHTML = this.lossFindings.map((f, idx) => {
      const total = (Number(f.parts_cost_inr) || 0) + (Number(f.labor_cost_inr) || 0);
      const isExcluded = f.included_in_claim === false;
      const rowClass = isExcluded ? "table-row-excluded" : "";

      return `
        <tr class="${rowClass}" data-idx="${idx}">
          <td style="text-align: center;">
            <input type="checkbox" class="coverage-toggle-cb" ${!isExcluded ? "checked" : ""} onchange="appController.toggleFindingCoverage(${idx})">
          </td>
          <td><span class="badge-tag">${f.side}</span></td>
          <td>
            <input type="text" class="form-control" style="font-size: 12px; padding: 4px 8px; width: 100%;" value="${f.component}" onchange="appController.updateFindingField(${idx}, 'component', this.value)">
          </td>
          <td>
            <input type="text" class="form-control" style="font-size: 12px; padding: 4px 8px; width: 100%;" value="${f.damage_type}" onchange="appController.updateFindingField(${idx}, 'damage_type', this.value)">
          </td>
          <td>
            <select class="form-select" style="font-size: 12px; padding: 4px 6px; width: 100%;" onchange="appController.updateFindingField(${idx}, 'repair_action', this.value)">
              <option value="Repair & Paint" ${f.repair_action.includes("Repair") ? "selected" : ""}>Repair & Paint</option>
              <option value="Replace with OEM Part" ${f.repair_action.includes("Replace") ? "selected" : ""}>Replace with OEM Part</option>
              <option value="Spot Paint / Blend" ${f.repair_action.includes("Spot") ? "selected" : ""}>Spot Paint / Blend</option>
              <option value="Paintless Dent Removal (PDR)" ${f.repair_action.includes("PDR") ? "selected" : ""}>Paintless Dent Removal (PDR)</option>
              <option value="Inspection / Teardown" ${f.repair_action.includes("Teardown") ? "selected" : ""}>Inspection / Teardown</option>
            </select>
          </td>
          <td>
            <div class="loss-price-input-wrap">
              <span class="loss-currency-symbol">₹</span>
              <input type="number" class="loss-input" value="${f.parts_cost_inr || 0}" min="0" step="100" oninput="appController.updateFindingCost(${idx}, 'parts', this.value)">
            </div>
          </td>
          <td>
            <div class="loss-price-input-wrap">
              <span class="loss-currency-symbol">₹</span>
              <input type="number" class="loss-input" value="${f.labor_cost_inr || 0}" min="0" step="100" oninput="appController.updateFindingCost(${idx}, 'labor', this.value)">
            </div>
          </td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan);" id="row_total_${idx}">
            ${this.formatINR(total)}
          </td>
          <td style="text-align: center;">
            <button class="btn-remove-row" onclick="appController.removeFindingRow(${idx})" title="Remove item">✕</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  updateFindingCost(idx, type, value) {
    const val = Number(value) || 0;
    if (type === "parts") {
      this.lossFindings[idx].parts_cost_inr = val;
    } else {
      this.lossFindings[idx].labor_cost_inr = val;
    }
    const total = (Number(this.lossFindings[idx].parts_cost_inr) || 0) + (Number(this.lossFindings[idx].labor_cost_inr) || 0);
    this.lossFindings[idx].estimated_cost_inr = total;

    const rowTotalEl = document.getElementById(`row_total_${idx}`);
    if (rowTotalEl) rowTotalEl.textContent = this.formatINR(total);

    this.recalculateSettlement();
  }

  updateFindingField(idx, field, value) {
    if (this.lossFindings[idx]) {
      this.lossFindings[idx][field] = value;
    }
  }

  toggleFindingCoverage(idx) {
    if (this.lossFindings[idx]) {
      this.lossFindings[idx].included_in_claim = !this.lossFindings[idx].included_in_claim;
      this.renderLossTable();
      this.recalculateSettlement();
    }
  }

  removeFindingRow(idx) {
    this.lossFindings.splice(idx, 1);
    this.renderLossTable();
    this.recalculateSettlement();
  }

  recalculateSettlement() {
    let partsSum = 0;
    let laborSum = 0;

    this.lossFindings.forEach(f => {
      if (f.included_in_claim !== false) {
        partsSum += Number(f.parts_cost_inr) || 0;
        laborSum += Number(f.labor_cost_inr) || 0;
      }
    });

    const grossTotal = partsSum + laborSum;
    const deductible = Number(this.policyDeductibleInput.value) || 0;
    const depRate = (Number(this.policyDepreciationSelect.value) || 0) / 100.0;
    const depAmount = Math.round(partsSum * depRate);
    const netPayable = Math.max(0, grossTotal - deductible - depAmount);

    // Update Stage 3 displays
    document.getElementById("loss_gross_display").textContent = this.formatINR(grossTotal);
    document.getElementById("loss_net_display").textContent = this.formatINR(netPayable);

    document.getElementById("recap_parts_val").textContent = this.formatINR(partsSum);
    document.getElementById("recap_labor_val").textContent = this.formatINR(laborSum);
    document.getElementById("recap_gross_val").textContent = this.formatINR(grossTotal);
    document.getElementById("recap_deductible_val").textContent = "- " + this.formatINR(deductible);
    document.getElementById("recap_depreciation_val").textContent = "- " + this.formatINR(depAmount);
    document.getElementById("recap_net_val").textContent = this.formatINR(netPayable);

    return { partsSum, laborSum, grossTotal, deductible, depAmount, netPayable };
  }

  // CUSTOM FLAW ADDITION WITH AI VALUATION
  async autoEstimateAndAddCustomFlaw() {
    const desc = this.customFlawDescInput.value.trim();
    if (!desc) {
      alert("Please enter a description for the custom flaw (e.g. 'Dented alloy wheel rim front left').");
      return;
    }

    const make = document.getElementById("q_make").value.trim();
    const model = document.getElementById("q_model").value.trim();
    const year = document.getElementById("q_year").value.trim();
    const severity = this.customFlawSeveritySelect.value;

    this.btnAutoEstimateCustomFlaw.classList.add("loading");
    this.btnAutoEstimateText.textContent = "Estimating ₹ Cost...";

    try {
      const resp = await fetch(window.getApiUrl("/api/estimate-custom-flaw"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flaw_description: desc,
          make,
          model,
          year,
          severity
        })
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // Add to loss sheet
      const newFinding = {
        side: "Secondary / Wheel",
        component: data.component || desc,
        damage_type: data.damage_type || "Damage / Flaw",
        severity: severity,
        repair_action: data.repair_action || "Repair / Replace",
        parts_cost_inr: data.parts_cost_inr || 0,
        labor_cost_inr: data.labor_cost_inr || 0,
        paint_cost_inr: 0,
        estimated_cost_inr: data.total_cost_inr || (data.parts_cost_inr + data.labor_cost_inr),
        included_in_claim: true,
        is_custom_added: true,
        user_marked: true,
        details: data.notes || "Custom assessed flaw."
      };

      this.lossFindings.push(newFinding);
      this.customFlawDescInput.value = "";

      this.renderLossTable();
      this.recalculateSettlement();

      this.btnAutoEstimateCustomFlaw.classList.remove("loading");
      this.btnAutoEstimateText.textContent = "✓ Estimated & Added";
      setTimeout(() => {
        this.btnAutoEstimateText.textContent = "⚡ Auto-Estimate Cost (₹)";
      }, 2500);

    } catch (err) {
      console.error("Custom flaw estimation failed:", err);
      this.btnAutoEstimateCustomFlaw.classList.remove("loading");
      this.btnAutoEstimateText.textContent = "⚡ Auto-Estimate Cost (₹)";
      alert("AI valuation failed for custom flaw: " + err.message);
    }
  }

  addCustomItemManual() {
    const desc = this.customFlawDescInput.value.trim();
    if (!desc) {
      alert("Please enter a description for the damage item.");
      return;
    }

    const severity = this.customFlawSeveritySelect.value;
    const newFinding = {
      side: "Secondary",
      component: desc,
      damage_type: "Custom Flaw",
      severity: severity,
      repair_action: "Repair & Paint",
      parts_cost_inr: 0,
      labor_cost_inr: 2500,
      paint_cost_inr: 0,
      estimated_cost_inr: 2500,
      included_in_claim: true,
      is_custom_added: true,
      user_marked: true,
      details: "Surveyor manual addition"
    };

    this.lossFindings.push(newFinding);
    this.customFlawDescInput.value = "";
    this.renderLossTable();
    this.recalculateSettlement();
  }

  // STAGE 3 -> STAGE 4: FINALIZE OFFICIAL REPORT
  async finalizeOfficialReport() {
    if (this.lossFindings.length === 0) {
      alert("No damage line items present. Please add at least one item to generate the survey report.");
      return;
    }

    const photosPayload = {};
    for (const side of this.sides) {
      photosPayload[side] = {
        view: side,
        image_b64: this.photos[side].image_b64,
        annotated_image_b64: this.photos[side].annotated_image_b64,
        annotations: this.photos[side].annotations || []
      };
    }

    const payload = {
      photos: photosPayload,
      questionnaire: this._collectQuestionnaire(),
      findings: this.lossFindings,
      policy_deductible_inr: Number(this.policyDeductibleInput.value) || 1000,
      depreciation_percent: Number(this.policyDepreciationSelect.value) || 0,
      surveyor_notes: this.surveyorFinalRemarks.value.trim() || null,
      claim_risk_level: this.preliminaryMeta.claim_risk_level || "LOW",
      severity_score: this.preliminaryMeta.severity_score || 25,
      damage_classification: this.preliminaryMeta.damage_classification || "Repairable Damage",
      executive_summary: this.preliminaryMeta.executive_summary || "",
      fraud_consistency_check: this.preliminaryMeta.fraud_consistency_check || "",
      adjuster_recommendation: this.preliminaryMeta.adjuster_recommendation || ""
    };

    this.loadingOverlay.classList.add("active");
    document.getElementById("loadingTitle").textContent = "Generating Certified Motor Survey Dossier";
    document.getElementById("loadingSubtitle").textContent = "Finalizing line items, financial recapitulation, and syncing with cloud database...";

    try {
      const resp = await fetch(window.getApiUrl("/api/finalize-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Server error HTTP ${resp.status}`);
      }

      const record = await resp.json();
      this.loadingOverlay.classList.remove("active");

      this.displayOfficialReport(record);
      this.goToStage(4);

    } catch (err) {
      this.loadingOverlay.classList.remove("active");
      console.error("Failed to finalize report:", err);
      alert("Report finalization failed: " + err.message);
    }
  }

  _animateLoadingSteps() {
    const steps = [
      document.getElementById("step1Text"),
      document.getElementById("step2Text"),
      document.getElementById("step3Text"),
      document.getElementById("step4Text")
    ];

    steps.forEach((s, idx) => {
      s.className = "loading-step-item";
      setTimeout(() => {
        s.className = "loading-step-item active";
        if (idx > 0) steps[idx - 1].className = "loading-step-item done";
      }, (idx + 1) * 2000);
    });
  }

  displayOfficialReport(record) {
    this.currentReport = record;
    const rep = record.report || {};
    const cost = rep.cost_breakdown || {};
    const q = record.questionnaire || {};
    const risk = rep.claim_risk_level || "LOW";

    // Header
    document.getElementById("rep_id").textContent = record.inspection_id;
    document.getElementById("print_rep_id").textContent = record.inspection_id;
    document.getElementById("rep_title").textContent = record.vehicle_title || "Motor Survey Dossier";
    const surveyDate = new Date(record.created_at).toLocaleDateString("en-IN", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
    document.getElementById("rep_time").textContent = `Date of Survey: ${surveyDate}`;
    document.getElementById("print_rep_date").textContent = `Date of Survey: ${surveyDate}`;

    // Vehicle Schedule
    document.getElementById("rep_sched_plate").textContent = q.license_plate || "N/A";
    document.getElementById("rep_sched_model").textContent = `${q.year || ''} ${q.make || ''} ${q.model || ''}`.trim() || "Vehicle";
    document.getElementById("rep_sched_year").textContent = q.year || "N/A";
    document.getElementById("rep_sched_odometer").textContent = q.odometer || "Not Stated";
    document.getElementById("rep_sched_incident").textContent = q.incident_type || "Road Collision";
    document.getElementById("rep_sched_policy").textContent = q.claim_type || "Comprehensive";
    document.getElementById("rep_sched_drivable").textContent = q.drivable || "Yes";
    document.getElementById("rep_sched_airbags").textContent = q.airbags_deployed || "No";

    // Key Metrics
    const riskEl = document.getElementById("rep_risk");
    riskEl.textContent = risk;
    riskEl.className = `metric-value risk-${risk}`;

    document.getElementById("rep_severity_score").textContent = `${rep.severity_score || 25}/100`;
    document.getElementById("rep_classification").textContent = rep.damage_classification || "Repairable";
    document.getElementById("rep_gross_cost").textContent = this.formatINR(cost.gross_total_inr);
    document.getElementById("rep_net_payable").textContent = this.formatINR(cost.net_payable_inr);

    // Summary
    document.getElementById("rep_summary").textContent = rep.executive_summary || "Automotive survey completed.";

    // 4-Angle Gallery
    this.sides.forEach(side => {
      const imgBox = document.getElementById(`rep_gallery_${side}`);
      const photoData = record.photos?.[side] || this.photos[side];
      const src = photoData?.annotated_image_b64 || photoData?.image_b64;
      if (src) {
        imgBox.innerHTML = `<img src="${src}" alt="${side} view">`;
      }
    });

    // Itemized Findings Table
    const tbody = document.getElementById("rep_findings_body");
    tbody.innerHTML = (rep.findings || []).map((f, i) => {
      const isCovered = f.included_in_claim !== false;
      const total = (Number(f.parts_cost_inr) || 0) + (Number(f.labor_cost_inr) || 0);

      return `
        <tr style="${!isCovered ? 'opacity: 0.5; text-decoration: line-through;' : ''}">
          <td style="font-weight: 700; text-align: center;">${i + 1}</td>
          <td><span class="badge-tag">${f.side}</span></td>
          <td><strong>${f.component}</strong></td>
          <td>${f.damage_type}</td>
          <td>${f.repair_action}</td>
          <td style="font-family: var(--font-mono); text-align: right;">${this.formatINR(f.parts_cost_inr)}</td>
          <td style="font-family: var(--font-mono); text-align: right;">${this.formatINR(f.labor_cost_inr)}</td>
          <td style="font-family: var(--font-mono); text-align: right; font-weight: 700; color: var(--accent-cyan);">${this.formatINR(total)}</td>
          <td style="text-align: center;">
            <span class="badge-tag ${isCovered ? 'badge-Minor' : 'badge-Severe'}">
              ${isCovered ? 'Covered' : 'Disallowed'}
            </span>
          </td>
        </tr>
      `;
    }).join("");

    // Financial Recapitulation
    document.getElementById("rep_fin_parts").textContent = this.formatINR(cost.parts_cost_inr);
    document.getElementById("rep_fin_labor").textContent = this.formatINR(cost.labor_cost_inr);
    document.getElementById("rep_fin_gross").textContent = this.formatINR(cost.gross_total_inr);
    document.getElementById("rep_fin_deductible").textContent = "- " + this.formatINR(cost.policy_deductible_inr);
    document.getElementById("rep_fin_depreciation").textContent = "- " + this.formatINR(cost.depreciation_inr);
    document.getElementById("rep_fin_net").textContent = this.formatINR(cost.net_payable_inr);

    // Fraud check & adjuster recommendation
    document.getElementById("rep_fraud_check").textContent = rep.fraud_consistency_check || "Physical evidence is consistent with stated accident.";
    document.getElementById("rep_adjuster_rec").textContent = rep.adjuster_recommendation || "Approved for claim settlement under standard guidelines.";
  }

  displayExistingReport(fullDoc) {
    this.switchTab("inspect");
    this.displayOfficialReport(fullDoc);
    this.goToStage(4);
  }

  downloadReportJson() {
    if (!this.currentReport) return;
    const blob = new Blob([JSON.stringify(this.currentReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.currentReport.inspection_id}_survey_report.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  resetWizard() {
    if (!confirm("Start a new survey? All current inputs will be reset.")) return;

    this.photos = {
      front: { image_b64: null, annotated_image_b64: null, annotations: [] },
      rear: { image_b64: null, annotated_image_b64: null, annotations: [] },
      left: { image_b64: null, annotated_image_b64: null, annotations: [] },
      right: { image_b64: null, annotated_image_b64: null, annotations: [] }
    };
    this.lossFindings = [];
    this.currentReport = null;
    this.autoDetectedOnce = false;

    this.sides.forEach(s => {
      document.getElementById(`fileInput_${s}`).value = "";
      this._updateCardUI(s);
    });

    document.querySelectorAll(".questionnaire-container input, .questionnaire-container textarea").forEach(el => el.value = "");
    document.querySelectorAll(".questionnaire-container select").forEach(el => el.selectedIndex = 0);

    if (this.allQuestionsSkipped) this.toggleSkipQuestionnaire();

    this.goToStage(1);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.appController = new AutoClaimApp();
});
