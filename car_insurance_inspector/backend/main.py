import os
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root or current folder
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from models import (
    SidePhoto,
    Questionnaire,
    DamageFinding,
    CostBreakdown,
    InsuranceReport,
    InspectionRecord,
    VehicleDetectionRequest,
    VehicleDetectionResponse,
    PreliminaryAssessmentRequest,
    PreliminaryAssessmentResponse,
    CustomFlawEstimateRequest,
    CustomFlawEstimateResponse,
    FinalizeReportRequest
)
from db_service import db_service
from bedrock_service import bedrock_service

app = FastAPI(
    title="AutoClaim Pro - Automotive Insurance Survey API",
    description="Enterprise 4-angle automotive damage appraisal and motor loss assessment system.",
    version="2.0.0"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

@app.get("/api/health")
async def health_check():
    db_status = db_service.ping()
    ai_status = "online" if bedrock_service.api_key else "offline"
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "database": "connected" if db_status.get("status") == "connected" else "error",
        "ai_engine": ai_status
    }

@app.post("/api/auto-detect-vehicle", response_model=VehicleDetectionResponse)
async def auto_detect_vehicle(payload: VehicleDetectionRequest):
    if not payload.photos:
        raise HTTPException(
            status_code=400,
            detail="At least one vehicle photo is required for AI auto-detection."
        )

    try:
        detection = bedrock_service.detect_vehicle_info(
            photos=payload.photos,
            requested_model=payload.model_id
        )
        return detection
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Vehicle auto-detection failed: {str(e)}"
        )

@app.post("/api/preliminary-assessment", response_model=PreliminaryAssessmentResponse)
async def preliminary_assessment(payload: PreliminaryAssessmentRequest):
    """Stage 3: Analyzes 4-angle photos and returns preliminary itemized findings in INR."""
    required_sides = ["front", "rear", "left", "right"]
    missing = [side for side in required_sides if side not in payload.photos]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"All 4 vehicle sides are required. Missing: {', '.join(missing)}"
        )

    try:
        res = bedrock_service.preliminary_assessment(
            photos=payload.photos,
            questionnaire=payload.questionnaire,
            requested_model=payload.model_id
        )
        return res
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Preliminary loss assessment failed: {str(e)}"
        )

@app.post("/api/estimate-custom-flaw", response_model=CustomFlawEstimateResponse)
async def estimate_custom_flaw(payload: CustomFlawEstimateRequest):
    """Stage 3 helper: Dynamically estimates OEM parts & body shop labor in INR for user-added flaws."""
    if not payload.flaw_description.strip():
        raise HTTPException(status_code=400, detail="Flaw description cannot be empty.")

    try:
        res = bedrock_service.estimate_custom_flaw(payload)
        return res
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Custom flaw valuation failed: {str(e)}"
        )

@app.post("/api/finalize-report")
async def finalize_report(payload: FinalizeReportRequest):
    """Stage 4: Compiles adjuster-modified findings, calculates net settlement, saves to DB, returns dossier."""
    # Generate unique inspection ID
    unique_suffix = uuid.uuid4().hex[:6].upper()
    now = datetime.utcnow()
    inspection_id = payload.inspection_id or f"SURV-{now.strftime('%Y%m%d')}-{unique_suffix}"
    created_at_iso = now.isoformat() + "Z"

    # Calculate settlement figures from approved findings
    parts_total = 0.0
    labor_total = 0.0
    paint_total = 0.0

    for f in payload.findings:
        if f.included_in_claim:
            parts_total += float(f.parts_cost_inr)
            labor_total += float(f.labor_cost_inr)
            paint_total += float(f.paint_cost_inr)

    gross_total = parts_total + labor_total + paint_total
    deductible = float(payload.policy_deductible_inr)
    depreciation_rate = float(payload.depreciation_percent) / 100.0
    depreciation_amount = round(parts_total * depreciation_rate, 2)
    net_payable = max(0.0, round(gross_total - deductible - depreciation_amount, 2))

    cost_breakdown = CostBreakdown(
        parts_cost_inr=round(parts_total, 2),
        labor_cost_inr=round(labor_total, 2),
        paint_refinish_inr=round(paint_total, 2),
        gross_total_inr=round(gross_total, 2),
        policy_deductible_inr=round(deductible, 2),
        depreciation_inr=round(depreciation_amount, 2),
        net_payable_inr=round(net_payable, 2)
    )

    q = payload.questionnaire
    vehicle_title = f"{q.year or ''} {q.make or ''} {q.model or 'Automobile'}".strip()
    if not vehicle_title or vehicle_title == "Automobile":
        vehicle_title = f"Motor Claim #{unique_suffix}"

    report = InsuranceReport(
        inspection_id=inspection_id,
        created_at=created_at_iso,
        claim_risk_level=payload.claim_risk_level or "LOW",
        severity_score=payload.severity_score or 25,
        damage_classification=payload.damage_classification or "Repairable Damage",
        executive_summary=payload.executive_summary or "Official motor loss appraisal completed across all vehicle aspects.",
        findings=payload.findings,
        cost_breakdown=cost_breakdown,
        fraud_consistency_check=payload.fraud_consistency_check or "Physical loss exhibits high consistency with typical road usage.",
        adjuster_recommendation=payload.adjuster_recommendation or "Approved for standard policy claim settlement.",
        raw_markdown=""
    )

    doc = {
        "inspection_id": inspection_id,
        "created_at": created_at_iso,
        "status": "COMPLETED",
        "vehicle_title": vehicle_title,
        "license_plate": q.license_plate or "N/A",
        "questionnaire": q.model_dump(),
        "photos": {k: v.model_dump() for k, v in payload.photos.items()},
        "report": report.model_dump()
    }

    try:
        db_service.save_inspection(doc)
    except Exception as e:
        doc["db_save_error"] = str(e)

    return doc

@app.get("/api/inspections")
async def list_inspections(
    limit: int = Query(default=30, le=100),
    skip: int = Query(default=0, ge=0),
    query: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None)
):
    results = db_service.get_inspections(limit=limit, skip=skip, query=query, severity_filter=severity)
    return {
        "count": len(results),
        "inspections": results
    }

@app.get("/api/inspections/{inspection_id}")
async def get_inspection(inspection_id: str):
    record = db_service.get_inspection_by_id(inspection_id)
    if not record:
        raise HTTPException(status_code=404, detail="Inspection dossier not found")
    return record

@app.delete("/api/inspections/{inspection_id}")
async def delete_inspection(inspection_id: str):
    deleted = db_service.delete_inspection(inspection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found or could not be deleted")
    return {"status": "success", "inspection_id": inspection_id, "deleted": True}

# Static file serving
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
    if (FRONTEND_DIR / "css").exists():
        app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
    if (FRONTEND_DIR / "js").exists():
        app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")
    if (FRONTEND_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(FRONTEND_DIR / "index.html"))

    @app.get("/{catchall:path}")
    async def serve_frontend_spa(catchall: str):
        target = FRONTEND_DIR / catchall
        if target.is_file():
            return FileResponse(str(target))
        return FileResponse(str(FRONTEND_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)
