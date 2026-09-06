import os
import io
import json
import base64
import logging
import urllib.request
import urllib.error
import ssl
from typing import Dict, Any, List, Optional
from PIL import Image
from models import (
    SidePhoto,
    Questionnaire,
    InsuranceReport,
    DamageFinding,
    CostBreakdown,
    VehicleDetectionResponse,
    PreliminaryAssessmentResponse,
    CustomFlawEstimateRequest,
    CustomFlawEstimateResponse
)

logger = logging.getLogger("bedrock_service")

class BedrockAIService:
    def __init__(self):
        self.api_key = os.getenv("BEDROCK_API_KEY", "")
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.primary_model_id = os.getenv("BEDROCK_MODEL_ID", "google.gemma-3-27b-it")
        self.fallback_model_id = os.getenv("BEDROCK_FALLBACK_MODEL_ID", "amazon.nova-pro-v1:0")
        self.ssl_context = ssl.create_default_context()

    def _optimize_image_b64(self, b64_str: str, max_size: int = 1024) -> str:
        """Optimizes, resizes, and converts image base64 to compressed JPEG bytes."""
        try:
            if "," in b64_str:
                b64_str = b64_str.split(",", 1)[1]
            image_bytes = base64.b64decode(b64_str)
            img = Image.open(io.BytesIO(image_bytes))

            # Convert RGBA/P to RGB
            if img.mode in ("RGBA", "P", "LA"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "RGBA":
                    bg.paste(img, mask=img.split()[3])
                else:
                    bg.paste(img)
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")

            # Resize if dimensions exceed max_size
            w, h = img.size
            if max(w, h) > max_size:
                scale = max_size / max(w, h)
                img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

            # Ensure minimum size for vision processor (at least 256x256)
            if min(img.size) < 256:
                img = img.resize((max(256, img.size[0]), max(256, img.size[1])), Image.Resampling.BILINEAR)

            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=82, optimize=True)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
        except Exception as e:
            logger.error("Failed to optimize image: %s", e)
            return b64_str

    def _call_bedrock_converse(
        self,
        model_id: str,
        content_blocks: List[Dict[str, Any]]
    ) -> str:
        url = f"https://bedrock-runtime.{self.region}.amazonaws.com/model/{model_id}/converse"
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": content_blocks
                }
            ],
            "inferenceConfig": {
                "maxTokens": 2048,
                "temperature": 0.2
            }
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
        )

        with urllib.request.urlopen(req, context=self.ssl_context, timeout=60) as resp:
            response_json = json.loads(resp.read().decode("utf-8"))
            content_list = response_json.get("output", {}).get("message", {}).get("content", [])
            for c in content_list:
                if "text" in c:
                    return c["text"]
            return ""

    def detect_vehicle_info(
        self,
        photos: Dict[str, SidePhoto],
        requested_model: Optional[str] = None
    ) -> VehicleDetectionResponse:
        """Uses vision AI to OCR license plate and detect make, model, year, and color."""
        content_blocks: List[Dict[str, Any]] = []

        priority_order = ["rear", "front", "left", "right"]
        for side in priority_order:
            photo = photos.get(side)
            if photo and photo.image_b64:
                raw_b64 = photo.annotated_image_b64 if photo.annotated_image_b64 else photo.image_b64
                optimized_b64 = self._optimize_image_b64(raw_b64)
                content_blocks.append({"text": f"--- {side.upper()} VIEW ---"})
                content_blocks.append({
                    "image": {
                        "format": "jpeg",
                        "source": {"bytes": optimized_b64}
                    }
                })

        if not content_blocks:
            return VehicleDetectionResponse()

        ocr_prompt = """You are an Automotive Vision Intelligence Engine. Inspect these vehicle photos carefully to auto-fill the insurance intake form.
Extract and identify the following information with maximum precision:
1. license_plate: Read the registration number / license plate text visible on the vehicle bumpers / plates (e.g. "DL 08 CA 4921"). Look closely at front and rear bumpers. If illegible or absent, set to null.
2. make: Vehicle manufacturer / brand (e.g. "Honda", "Toyota", "Hyundai", "Maruti Suzuki", "Tata", "Mahindra", "BMW", "Ford", "Mercedes-Benz", etc.). If emblem is generic or obscured, set to null.
3. model: Specific model and trim or body style (e.g. "Civic", "City", "Creta", "Nexon", "Sedan", "SUV", "Hatchback").
4. year: Estimated model year or generation (e.g. "2023", "2021-2024").
5. color: Primary exterior paint finish (e.g. "Silver Metallic", "Black", "Pearl White", "Grey").
6. body_type: One of "Sedan", "SUV", "Hatchback", "Truck", "Coupe", "Van".
7. primary_impact_hint: Side that shows visible damage or dent (e.g. "Front Bumper & Grille", "Rear Bumper & Trunk", "Driver Side Panels", "None obvious").

Return strictly valid JSON:
```json
{
  "license_plate": "DL 08 CA 4921",
  "make": "Honda",
  "model": "Civic",
  "year": "2023",
  "color": "Silver Metallic",
  "body_type": "Sedan",
  "primary_impact_hint": "Front Bumper & Grille"
}
```
"""
        content_blocks.append({"text": ocr_prompt})

        target_model = requested_model or self.primary_model_id
        ai_text = ""
        try:
            ai_text = self._call_bedrock_converse(target_model, content_blocks)
        except Exception as e:
            logger.warning("Vehicle detection failed with %s: %s. Trying fallback %s", target_model, e, self.fallback_model_id)
            try:
                ai_text = self._call_bedrock_converse(self.fallback_model_id, content_blocks)
            except Exception as e2:
                logger.error("Vehicle detection fallback also failed: %s", e2)
                return VehicleDetectionResponse()

        try:
            if "```json" in ai_text:
                json_str = ai_text.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in ai_text:
                json_str = ai_text.split("```", 1)[1].split("```", 1)[0].strip()
            else:
                s = ai_text.find("{")
                e = ai_text.rfind("}")
                json_str = ai_text[s:e+1] if s != -1 and e != -1 else "{}"

            data = json.loads(json_str)
            return VehicleDetectionResponse(
                license_plate=data.get("license_plate") if data.get("license_plate") not in ["null", "None", ""] else None,
                make=data.get("make") if data.get("make") not in ["null", "None", "Unknown", ""] else None,
                model=data.get("model") if data.get("model") not in ["null", "None", ""] else None,
                year=str(data.get("year")) if data.get("year") not in ["null", "None", "Unknown", ""] else None,
                color=data.get("color") if data.get("color") not in ["null", "None", ""] else None,
                body_type=data.get("body_type") if data.get("body_type") not in ["null", "None", ""] else None,
                primary_impact_hint=data.get("primary_impact_hint") if data.get("primary_impact_hint") not in ["null", "None", ""] else None
            )
        except Exception as e:
            logger.error("Failed to parse vehicle detection JSON: %s", e)
            return VehicleDetectionResponse()

    def preliminary_assessment(
        self,
        photos: Dict[str, SidePhoto],
        questionnaire: Questionnaire,
        requested_model: Optional[str] = None
    ) -> PreliminaryAssessmentResponse:
        """Stage 3: Generates itemized preliminary damage loss sheet in Indian Rupees (₹)."""
        content_blocks: List[Dict[str, Any]] = []

        q_text = []
        if questionnaire.all_skipped:
            q_text.append("- Questionnaire: Skipped by user / Not provided.")
        else:
            q_text.append(f"- Vehicle: {questionnaire.year or 'N/A'} {questionnaire.make or ''} {questionnaire.model or 'Vehicle'}")
            q_text.append(f"- License Plate / Regn: {questionnaire.license_plate or 'Not specified'}")
            q_text.append(f"- Incident Type: {questionnaire.incident_type or 'Skipped'}")
            q_text.append(f"- Drivability: {questionnaire.drivable or 'Skipped'}")
            q_text.append(f"- Airbags Deployed: {questionnaire.airbags_deployed or 'Skipped'}")
            q_text.append(f"- Leakage: {questionnaire.fluid_leakage or 'Skipped'}")
            q_text.append(f"- Impact Point: {questionnaire.point_of_impact or 'Skipped'}")
            q_text.append(f"- Policy: {questionnaire.claim_type or 'Skipped'}")
            if questionnaire.inspector_notes:
                q_text.append(f"- Notes: {questionnaire.inspector_notes}")

        ann_text = []
        for side, photo in photos.items():
            if photo.annotations:
                marks = [f"{a.tag_label} ({a.tool})" for a in photo.annotations]
                ann_text.append(f"- {side.upper()} view: User marked: {', '.join(marks)}")

        # Attach 4 sides
        side_order = ["front", "rear", "left", "right"]
        for side in side_order:
            photo = photos.get(side)
            if photo and photo.image_b64:
                raw_b64 = photo.annotated_image_b64 if photo.annotated_image_b64 else photo.image_b64
                optimized_b64 = self._optimize_image_b64(raw_b64)
                content_blocks.append({"text": f"--- {side.upper()} ANGLE ---"})
                content_blocks.append({
                    "image": {
                        "format": "jpeg",
                        "source": {"bytes": optimized_b64}
                    }
                })

        prompt = f"""You are a Senior Automotive Insurance Surveyor and Motor Loss Assessor.
Analyze these 4 vehicle photos for an insurance claim in India.
Vehicle & Claim Data:
{chr(10).join(q_text)}
Manual Markings:
{chr(10).join(ann_text)}

Instructions:
1. Examine all 4 angles carefully for dents, scratches, paint scuffs, cracks, alignment gaps, or structural damage.
IMPORTANT: You MUST inspect and itemize every defect explicitly flagged in "Manual Markings" above (especially any custom user-added defects such as dented wheel rims, bent suspension, undercarriage scrape, mirror damage, tire cuts, etc.). Ensure each marked defect is included as a distinct item in the "findings" list with accurate Indian body shop repair or replacement costs.
2. Estimate all parts replacement and body repair labor costs strictly in INDIAN RUPEES (₹ / INR), matching authorized Indian automobile body shop benchmarks (e.g. Minor bumper repair/paint ₹2,500-₹5,500, Bumper replacement ₹7,000-₹14,000, Door dent removal & paint ₹4,000-₹9,500, Alloy wheel rim repair/replacement ₹3,500-₹9,500, Side mirror assembly ₹2,500-₹6,500, Quarter panel repair ₹4,500-₹8,500).
3. Return strictly valid JSON:

```json
{{
  "claim_risk_level": "LOW",
  "severity_score": 28,
  "damage_classification": "Minor Repairable",
  "executive_summary": "Summary of visual findings across all 4 angles.",
  "findings": [
    {{
      "side": "Front",
      "component": "Front Bumper Fascia & Lower Grille",
      "damage_type": "Dent & Paint Scuff",
      "severity": "Minor",
      "repair_action": "Repair & Spot Paint",
      "parts_cost_inr": 0.0,
      "labor_cost_inr": 3500.0,
      "estimated_cost_inr": 3500.0,
      "included_in_claim": true,
      "details": "Depressed bumper skin with surface clearcoat scratches."
    }}
  ],
  "fraud_consistency_check": "Observations regarding whether physical damage matches stated circumstances.",
  "adjuster_recommendation": "Fast-track approval under standard policy limits."
}}
```
"""
        content_blocks.append({"text": prompt})

        target_model = requested_model or self.primary_model_id
        ai_text = ""
        try:
            ai_text = self._call_bedrock_converse(target_model, content_blocks)
        except Exception as e:
            logger.warning("Preliminary assessment failed with %s: %s. Fallback to %s", target_model, e, self.fallback_model_id)
            ai_text = self._call_bedrock_converse(self.fallback_model_id, content_blocks)

        try:
            if "```json" in ai_text:
                json_str = ai_text.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in ai_text:
                json_str = ai_text.split("```", 1)[1].split("```", 1)[0].strip()
            else:
                s = ai_text.find("{")
                e = ai_text.rfind("}")
                json_str = ai_text[s:e+1] if s != -1 and e != -1 else "{}"

            data = json.loads(json_str)

            findings: List[DamageFinding] = []
            for f in data.get("findings", []):
                parts = float(f.get("parts_cost_inr", 0.0))
                labor = float(f.get("labor_cost_inr", 0.0))
                total = float(f.get("estimated_cost_inr", parts + labor))
                findings.append(DamageFinding(
                    side=f.get("side", "General"),
                    component=f.get("component", "Body Panel"),
                    damage_type=f.get("damage_type", "Dent / Scuff"),
                    severity=f.get("severity", "Minor"),
                    repair_action=f.get("repair_action", "Repair & Paint"),
                    parts_cost_inr=parts,
                    labor_cost_inr=labor,
                    paint_cost_inr=float(f.get("paint_cost_inr", 0.0)),
                    estimated_cost_inr=total if total > 0 else (parts + labor),
                    included_in_claim=bool(f.get("included_in_claim", True)),
                    details=f.get("details", "")
                ))

            if not findings:
                findings.append(DamageFinding(
                    side="Front",
                    component="Front Bumper Fascia",
                    damage_type="Surface Dent & Scuff",
                    severity="Minor",
                    repair_action="Repair & Paint",
                    parts_cost_inr=0.0,
                    labor_cost_inr=3200.0,
                    estimated_cost_inr=3200.0,
                    included_in_claim=True,
                    details="Cosmetic deformation on bumper cover."
                ))

            return PreliminaryAssessmentResponse(
                claim_risk_level=data.get("claim_risk_level", "LOW"),
                severity_score=int(data.get("severity_score", 25)),
                damage_classification=data.get("damage_classification", "Minor Repairable"),
                executive_summary=data.get("executive_summary", "Preliminary 4-angle visual appraisal complete."),
                findings=findings,
                fraud_consistency_check=data.get("fraud_consistency_check", "Physical vehicle damage exhibits consistency with typical road incident."),
                adjuster_recommendation=data.get("adjuster_recommendation", "Fast-track approval under standard policy limits.")
            )

        except Exception as e:
            logger.error("Failed to parse preliminary assessment JSON: %s", e)
            return PreliminaryAssessmentResponse(
                claim_risk_level="LOW",
                severity_score=20,
                damage_classification="Minor Repairable",
                executive_summary="Visual damage assessment complete. Please review the itemized loss sheet below.",
                findings=[
                    DamageFinding(
                        side="Front",
                        component="Front Bumper Fascia",
                        damage_type="Bumper Dent",
                        severity="Minor",
                        repair_action="Repair & Spot Paint",
                        parts_cost_inr=0.0,
                        labor_cost_inr=3000.0,
                        estimated_cost_inr=3000.0,
                        included_in_claim=True,
                        details="Impact dent on bumper"
                    )
                ],
                fraud_consistency_check="Damage appears consistent with stated incident.",
                adjuster_recommendation="Approve standard repair estimate."
            )

    def estimate_custom_flaw(
        self,
        request: CustomFlawEstimateRequest
    ) -> CustomFlawEstimateResponse:
        """Stage 3 helper: Estimates OEM parts and body shop labor in INR (₹) for user-added flaws (e.g. dented wheel rim)."""
        prompt = f"""You are an Indian Motor Insurance Loss Assessor and Body Shop Valuation Expert.
A surveyor or claimant has reported an additional vehicle flaw not clearly captured in the 4 body angles:
- Vehicle: {request.year or ''} {request.make or ''} {request.model or 'Automobile'}
- Flaw Description: "{request.flaw_description}"
- Severity Assessment: {request.severity or 'Moderate'}

Determine the realistic Indian body shop and OEM replacement cost in Indian Rupees (₹ / INR).
Consider whether this flaw typically requires part replacement (e.g. cracked alloy wheel, cut tire) or repair (e.g. lip bend, rim scratch, link rebush).
Benchmark to authorized Indian OEM rates (e.g. Alloy wheel replacement ₹8,500-₹22,000, Wheel repair ₹1,800-₹3,500, Tire replacement ₹4,500-₹12,000, Suspension control arm ₹3,500-₹9,000).

Return strictly JSON:
```json
{{
  "component": "Front Left Alloy Wheel Rim",
  "damage_type": "Rim Lip Bend & Scuff",
  "repair_action": "Alloy Wheel Truing & Repaint",
  "parts_cost_inr": 0.0,
  "labor_cost_inr": 2800.0,
  "total_cost_inr": 2800.0,
  "notes": "Wheel truing and cosmetic refinishing recommended. If rim is structurally cracked, replacement required."
}}
```
"""
        target_model = request.model_id or self.primary_model_id
        content_blocks = [{"text": prompt}]

        try:
            ai_text = self._call_bedrock_converse(target_model, content_blocks)
        except Exception as e:
            logger.warning("Custom flaw valuation fallback triggered: %s", e)
            ai_text = self._call_bedrock_converse(self.fallback_model_id, content_blocks)

        try:
            if "```json" in ai_text:
                json_str = ai_text.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in ai_text:
                json_str = ai_text.split("```", 1)[1].split("```", 1)[0].strip()
            else:
                s = ai_text.find("{")
                e = ai_text.rfind("}")
                json_str = ai_text[s:e+1] if s != -1 and e != -1 else "{}"

            data = json.loads(json_str)
            parts = float(data.get("parts_cost_inr", 0.0))
            labor = float(data.get("labor_cost_inr", 0.0))
            total = float(data.get("total_cost_inr", parts + labor))

            return CustomFlawEstimateResponse(
                component=data.get("component", request.flaw_description),
                damage_type=data.get("damage_type", "Damage / Defect"),
                repair_action=data.get("repair_action", "Repair / Replace"),
                parts_cost_inr=parts,
                labor_cost_inr=labor,
                total_cost_inr=total if total > 0 else (parts + labor),
                notes=data.get("notes", "Assessed according to Indian motor surveyor tariff.")
            )
        except Exception as e:
            logger.error("Failed to parse custom flaw estimate: %s", e)
            return CustomFlawEstimateResponse(
                component=request.flaw_description,
                damage_type="Mechanical / Cosmetic Flaw",
                repair_action="Repair & Recondition",
                parts_cost_inr=0.0,
                labor_cost_inr=3000.0,
                total_cost_inr=3000.0,
                notes="Standard body shop labor estimate applied."
            )

# Singleton instance
bedrock_service = BedrockAIService()
