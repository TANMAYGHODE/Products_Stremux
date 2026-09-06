# AutoClaim Pro - Motor Insurance Survey & Damage Valuation System

An enterprise automotive damage appraisal and motor loss assessment system built for insurance claims adjusters, surveyors, and policyholders.

---

## 🌟 Key Features

1. **4-Angle Photographic Loss Intake & Zero-Effort OCR**
   - Dedicated dropzones for **Front**, **Rear**, **Left Side (Driver)**, and **Right Side (Passenger)**.
   - Intelligent OCR scans bumper plates to transcribe registration numbers (e.g. `DL 08 CA 4921`) and identify Make, Model, and Year automatically.

2. **Interactive Damage Annotation Studio**
   - Built-in HTML5 canvas editor allowing users to directly mark damage spots:
     - ⭕ **Circle / Ellipse Tool** (specifically designed for circling dents, scratches, missing paint)
     - ◻️ **Bounding Box Tool**
     - ✏️ **Freehand Highlighter Brush**
     - ↗️ **Arrow Pointer**
   - Multi-category damage labeling: *Dent / Depression*, *Paint Scratch / Color Loss*, *Glass Crack*, *Panel Gap / Misalignment*, *Structural Crush*, *Rust / Corrosion*.
   - Full Undo / Redo / Clear and high-res composite export.

3. **Stage 3: Adjuster Loss Assessment & Price Schedule (₹)**
   - Itemized damage schedule with parts and labor costs in Indian Rupees (`₹`).
   - Live editable parts and labor inputs with instant row total calculation.
   - Coverage toggle checkboxes to include or exclude specific items as wear & tear or disallowed.
   - **Add Custom Damage Item (e.g. Dented Alloy Wheel Rim, Tire Slash, Suspension Bend)** with an **"⚡ Auto-Estimate Cost (₹)"** button that calls the AI valuation engine to calculate realistic OEM parts and body shop labor rates.
   - **Settlement Recapitulation Calculator**: Policy Compulsory Deductible / Excess deduction, Depreciation on parts slider, and real-time Net Claim Payable calculation.

4. **Stage 4: Certified Motor Insurance Survey Report & A4 PDF**
   - Standard motor insurance survey report structure.
   - Two-column Insured & Vehicle Schedule table.
   - 4-photo loss evidence grid sized appropriately without awkward page breaks.
   - Certified Bill of Assessment with Indian Rupee (₹) breakdown.
   - Financial Loss Recapitulation box.
   - Surveyor Declaration, Seal, and Signature block.
   - High-hygiene print stylesheet for clean, professional A4 PDF export.

5. **White-Labeled & Cloud-Synced**
   - Zero exposure of internal tech stack or model names in public UI, headers, and exports.
   - Every survey dossier is securely archived in the cloud database with search, filter, and export capabilities.

---

## 🚀 Quick Start

### 1. Requirements
- Python 3.10+
- Installed packages:
  ```bash
  pip install -r requirements.txt
  ```

### 2. Environment Configuration
Verify `.env` in the repository root:
```ini
BEDROCK_API_KEY=...
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=google.gemma-3-27b-it
MONGODB_URI=...
MONGODB_DB_NAME=stremux_insurance
HOST=0.0.0.0
PORT=8000
```

### 3. Launch Application
Run the launcher from repository root:
```bash
python run.py
```
Open your browser at:
👉 **`http://localhost:8000`**

Interactive API Documentation:
👉 **`http://localhost:8000/docs`**

---

## 📡 REST API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | Validates cloud database and AI engine connectivity |
| `/api/auto-detect-vehicle` | `POST` | Vision OCR extracts plate number, make, model, and year |
| `/api/preliminary-assessment` | `POST` | Generates Stage 3 preliminary loss sheet in Indian Rupees (₹) |
| `/api/estimate-custom-flaw` | `POST` | AI valuation engine calculates parts & labor in ₹ for user-added flaws |
| `/api/finalize-report` | `POST` | Compiles adjuster-modified findings, calculates net settlement, saves to DB |
| `/api/inspections` | `GET` | Lists recent survey records with search and severity filters |
| `/api/inspections/{id}` | `GET` | Returns complete survey dossier |
| `/api/inspections/{id}` | `DELETE` | Deletes a survey record from cloud vault |
