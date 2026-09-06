from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class AnnotationItem(BaseModel):
    tool: str = "circle"  # "circle", "rect", "pen", "arrow"
    tag: str = "dent"     # "dent", "scratch", "crack", "misalignment", "crush", "rust", "other"
    tag_label: str = "Dent"
    color: str = "#ff3b30"
    points: Optional[List[Dict[str, float]]] = None
    bbox: Optional[Dict[str, float]] = None
    notes: Optional[str] = None

class SidePhoto(BaseModel):
    view: str  # "front", "rear", "left", "right"
    image_b64: str  # Original image base64 data
    annotated_image_b64: Optional[str] = None  # With drawn circles/boxes overlaid
    annotations: List[AnnotationItem] = []

class VehicleDetectionRequest(BaseModel):
    photos: Dict[str, SidePhoto]
    model_id: Optional[str] = None

class VehicleDetectionResponse(BaseModel):
    license_plate: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[str] = None
    color: Optional[str] = None
    body_type: Optional[str] = None
    primary_impact_hint: Optional[str] = None

class Questionnaire(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[str] = None
    license_plate: Optional[str] = None
    odometer: Optional[str] = None
    incident_type: Optional[str] = "Skipped"
    drivable: Optional[str] = "Skipped"
    airbags_deployed: Optional[str] = "Skipped"
    fluid_leakage: Optional[str] = "Skipped"
    point_of_impact: Optional[str] = "Skipped"
    claim_type: Optional[str] = "Skipped"
    inspector_notes: Optional[str] = None
    all_skipped: bool = False

class DamageFinding(BaseModel):
    side: str = "General"  # Front, Rear, Left, Right, Wheel / Underbody, Custom
    component: str = "Component"  # Bumper, Wheel Rim, Fender, Door, etc.
    damage_type: str = "Dent / Deformation"  # Dent, Scratch, Crack, Displaced, etc.
    severity: str = "Minor"  # Minor, Moderate, Severe
    repair_action: str = "Repair & Paint"  # Repair, Paint/Refinish, Replace, PDR
    parts_cost_inr: float = 0.0
    labor_cost_inr: float = 0.0
    paint_cost_inr: float = 0.0
    estimated_cost_inr: float = 0.0
    included_in_claim: bool = True
    is_custom_added: bool = False
    user_marked: bool = False
    details: str = ""

class CostBreakdown(BaseModel):
    parts_cost_inr: float = 0.0
    labor_cost_inr: float = 0.0
    paint_refinish_inr: float = 0.0
    gross_total_inr: float = 0.0
    policy_deductible_inr: float = 1000.0
    depreciation_inr: float = 0.0
    net_payable_inr: float = 0.0

class PreliminaryAssessmentRequest(BaseModel):
    photos: Dict[str, SidePhoto]
    questionnaire: Questionnaire = Field(default_factory=Questionnaire)
    model_id: Optional[str] = None

class PreliminaryAssessmentResponse(BaseModel):
    claim_risk_level: str = "LOW"
    severity_score: int = 25
    damage_classification: str = "Minor Repairable"
    executive_summary: str = ""
    findings: List[DamageFinding] = []
    fraud_consistency_check: str = ""
    adjuster_recommendation: str = ""

class CustomFlawEstimateRequest(BaseModel):
    flaw_description: str
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[str] = None
    severity: Optional[str] = "Moderate"
    model_id: Optional[str] = None

class CustomFlawEstimateResponse(BaseModel):
    component: str
    damage_type: str
    repair_action: str
    parts_cost_inr: float = 0.0
    labor_cost_inr: float = 0.0
    total_cost_inr: float = 0.0
    notes: str = ""

class FinalizeReportRequest(BaseModel):
    inspection_id: Optional[str] = None
    photos: Dict[str, SidePhoto]
    questionnaire: Questionnaire = Field(default_factory=Questionnaire)
    findings: List[DamageFinding] = []
    policy_deductible_inr: float = 1000.0
    depreciation_percent: float = 0.0
    surveyor_notes: Optional[str] = None
    claim_risk_level: Optional[str] = "LOW"
    severity_score: Optional[int] = 25
    damage_classification: Optional[str] = "Moderate Repairable"
    executive_summary: Optional[str] = None
    fraud_consistency_check: Optional[str] = None
    adjuster_recommendation: Optional[str] = None
    model_id: Optional[str] = None

class InsuranceReport(BaseModel):
    inspection_id: str
    created_at: str
    claim_risk_level: str = "LOW"  # LOW, MEDIUM, HIGH, CRITICAL
    severity_score: int = 15  # 0 to 100
    damage_classification: str = "Minor Repairable"
    executive_summary: str
    findings: List[DamageFinding] = []
    cost_breakdown: CostBreakdown = Field(default_factory=CostBreakdown)
    fraud_consistency_check: str = "Consistent with user reported circumstances."
    adjuster_recommendation: str = "Fast-track estimate approval."
    raw_markdown: str = ""

class InspectionRecord(BaseModel):
    inspection_id: str
    created_at: str
    status: str = "COMPLETED"
    vehicle_title: str = "Vehicle Inspection"
    license_plate: Optional[str] = None
    questionnaire: Dict[str, Any] = {}
    photos_meta: Dict[str, Any] = {}
    report: Optional[Dict[str, Any]] = None
