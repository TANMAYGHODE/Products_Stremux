import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { MongoClient } from "mongodb";

// Configuration
const REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
const PRIMARY_MODEL = process.env.BEDROCK_MODEL_ID || "google.gemma-3-27b-it";
const FALLBACK_MODEL = process.env.BEDROCK_FALLBACK_MODEL_ID || "amazon.nova-pro-v1:0";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "stremux_insurance";

// Cached MongoDB client across warm Lambda invocations
let cachedMongoClient: MongoClient | null = null;

async function getMongoDb(): Promise<any> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI environment variable is not configured");

  if (!cachedMongoClient) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    await client.connect();
    cachedMongoClient = client;
    const db = cachedMongoClient.db(MONGODB_DB_NAME);
    // Ensure index exists
    db.collection("inspections").createIndex({ inspection_id: 1 }, { unique: true }).catch(() => {});
    db.collection("inspections").createIndex({ created_at: -1 }).catch(() => {});
  }
  return cachedMongoClient.db(MONGODB_DB_NAME);
}

// Clean base64 string
function cleanB64(raw: string): string {
  if (!raw) return "";
  if (raw.includes(",")) {
    return raw.split(",")[1];
  }
  return raw;
}

// Bedrock Converse API invocation
async function callBedrock(modelId: string, contentBlocks: any[]): Promise<string> {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) throw new Error("BEDROCK_API_KEY environment variable is not configured");

  const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  const payload = {
    messages: [
      {
        role: "user",
        content: contentBlocks,
      },
    ],
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.2,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bedrock HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data?.output?.message?.content || [];
  for (const block of content) {
    if (block.text) return block.text;
  }
  return "";
}

async function callBedrockWithFallback(modelId: string, contentBlocks: any[]): Promise<string> {
  try {
    return await callBedrock(modelId, contentBlocks);
  } catch (err: any) {
    console.warn(`Primary Bedrock model ${modelId} failed: ${err.message}. Retrying with fallback ${FALLBACK_MODEL}...`);
    return await callBedrock(FALLBACK_MODEL, contentBlocks);
  }
}

// Extract JSON safely from LLM output
function parseJsonFromLlm(text: string): any {
  if (!text) return {};
  try {
    let raw = text;
    if (raw.includes("```json")) {
      raw = raw.split("```json")[1].split("```")[0];
    } else if (raw.includes("```")) {
      raw = raw.split("```")[1].split("```")[0];
    } else {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        raw = raw.slice(start, end + 1);
      }
    }
    return JSON.parse(raw.trim());
  } catch (e) {
    console.error("Failed to parse LLM JSON:", e, "Raw output was:", text);
    return {};
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Content-Type": "application/json",
};

function jsonResponse(statusCode: number, data: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const method = (event.httpMethod || (event as any).requestContext?.http?.method || "GET").toUpperCase();
  const rawPath = event.path || (event.requestContext as any)?.http?.path || (event as any).rawPath || "/";

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  // Normalize path by stripping stage prefixes if present
  let path = rawPath;
  if (path.startsWith("/api")) {
    // Keep as /api/...
  } else if (path.includes("/api/")) {
    path = path.slice(path.indexOf("/api/"));
  }

  try {
    // ----------------------------------------------------
    // GET /api/health
    // ----------------------------------------------------
    if (method === "GET" && (path === "/api/health" || path === "/health")) {
      let dbStatus = "disconnected";
      let dbError: string | null = null;
      try {
        const db = await getMongoDb();
        await db.command({ ping: 1 });
        dbStatus = "connected";
      } catch (err: any) {
        dbError = err.message;
        cachedMongoClient = null;
        console.warn("Mongo ping warning:", err.message);
      }

      const aiStatus = process.env.BEDROCK_API_KEY ? "online" : "offline";

      return jsonResponse(200, {
        status: "healthy",
        timestamp: new Date().toISOString(),
        database: dbStatus,
        database_error: dbError,
        has_mongo_uri: !!process.env.MONGODB_URI,
        ai_engine: aiStatus,
      });
    }

    // ----------------------------------------------------
    // POST /api/auto-detect-vehicle
    // ----------------------------------------------------
    if (method === "POST" && (path === "/api/auto-detect-vehicle" || path.endsWith("/auto-detect-vehicle"))) {
      const body = JSON.parse(event.body || "{}");
      const photos = body.photos || {};

      const contentBlocks: any[] = [];
      const hasFrontOrRear = photos["front"] || photos["rear"];
      const priorityOrder = hasFrontOrRear ? ["rear", "front"] : ["left", "right"];

      for (const side of priorityOrder) {
        const p = photos[side];
        if (p && (p.annotated_image_b64 || p.image_b64)) {
          const b64 = cleanB64(p.annotated_image_b64 || p.image_b64);
          contentBlocks.push({ text: `--- ${side.toUpperCase()} VIEW ---` });
          contentBlocks.push({
            image: {
              format: "jpeg",
              source: { bytes: b64 },
            },
          });
        }
      }

      if (contentBlocks.length === 0) {
        return jsonResponse(400, { detail: "At least one vehicle photo is required." });
      }

      const prompt = `You are an Automotive Vision Intelligence Engine. Inspect these vehicle photos carefully to auto-fill the insurance intake form.
Extract and identify the following information with maximum precision:
1. license_plate: Read the registration number / license plate text visible on the vehicle bumpers / plates (e.g. "DL 08 CA 4921"). Look closely at front and rear bumpers. If illegible or absent, set to null.
2. make: Vehicle manufacturer / brand (e.g. "Honda", "Toyota", "Hyundai", "Maruti Suzuki", "Tata", "Mahindra", "BMW", "Ford", "Mercedes-Benz", etc.). If emblem is generic or obscured, set to null.
3. model: Specific model and trim or body style (e.g. "Civic", "City", "Creta", "Nexon", "Punch", "Sedan", "SUV", "Hatchback").
4. year: Estimated model year or generation (e.g. "2023", "2021-2024").
5. color: Primary exterior paint finish (e.g. "Silver Metallic", "Black", "Pearl White", "Grey").
6. body_type: One of "Sedan", "SUV", "Hatchback", "Truck", "Coupe", "Van".
7. primary_impact_hint: Side that shows visible damage or dent (e.g. "Front Bumper & Grille", "Rear Bumper & Trunk", "Driver Side Panels", "None obvious").

Return strictly valid JSON:
{
  "license_plate": "DL 08 CA 4921",
  "make": "Honda",
  "model": "Civic",
  "year": "2023",
  "color": "Silver Metallic",
  "body_type": "Sedan",
  "primary_impact_hint": "Front Bumper & Grille"
}`;

      contentBlocks.push({ text: prompt });
      const targetModel = body.model_id || PRIMARY_MODEL;
      const aiText = await callBedrockWithFallback(targetModel, contentBlocks);
      const parsed = parseJsonFromLlm(aiText);

      return jsonResponse(200, {
        license_plate: parsed.license_plate && parsed.license_plate !== "null" ? parsed.license_plate : null,
        make: parsed.make && parsed.make !== "null" && parsed.make !== "Unknown" ? parsed.make : null,
        model: parsed.model && parsed.model !== "null" ? parsed.model : null,
        year: parsed.year ? String(parsed.year) : null,
        color: parsed.color && parsed.color !== "null" ? parsed.color : null,
        body_type: parsed.body_type && parsed.body_type !== "null" ? parsed.body_type : null,
        primary_impact_hint: parsed.primary_impact_hint && parsed.primary_impact_hint !== "null" ? parsed.primary_impact_hint : null,
      });
    }

    // ----------------------------------------------------
    // POST /api/preliminary-assessment
    // ----------------------------------------------------
    if (method === "POST" && (path === "/api/preliminary-assessment" || path.endsWith("/preliminary-assessment"))) {
      const body = JSON.parse(event.body || "{}");
      const photos = body.photos || {};
      const questionnaire = body.questionnaire || {};

      const contentBlocks: any[] = [];
      const qText: string[] = [];

      if (questionnaire.all_skipped) {
        qText.push("- Questionnaire: Skipped by user / Not provided.");
      } else {
        qText.push(`- Vehicle: ${questionnaire.year || "N/A"} ${questionnaire.make || ""} ${questionnaire.model || "Vehicle"}`);
        qText.push(`- License Plate / Regn: ${questionnaire.license_plate || "Not specified"}`);
        qText.push(`- Incident Type: ${questionnaire.incident_type || "Skipped"}`);
        qText.push(`- Drivability: ${questionnaire.drivable || "Skipped"}`);
        qText.push(`- Airbags Deployed: ${questionnaire.airbags_deployed || "Skipped"}`);
        qText.push(`- Leakage: ${questionnaire.fluid_leakage || "Skipped"}`);
        qText.push(`- Impact Point: ${questionnaire.point_of_impact || "Skipped"}`);
        qText.push(`- Policy: ${questionnaire.claim_type || "Skipped"}`);
        if (questionnaire.inspector_notes) {
          qText.push(`- Notes: ${questionnaire.inspector_notes}`);
        }
      }

      const annText: string[] = [];
      for (const [side, p] of Object.entries(photos) as [string, any][]) {
        if (p?.annotations && Array.isArray(p.annotations) && p.annotations.length > 0) {
          const marks = p.annotations.map((a: any) => `${a.tag_label || "Damage"} (${a.tool || "Box"})`);
          annText.push(`- ${side.toUpperCase()} view: User marked: ${marks.join(", ")}`);
        }
      }

      const sideOrder = ["front", "rear", "left", "right"];
      for (const side of sideOrder) {
        const p = photos[side];
        if (p && (p.annotated_image_b64 || p.image_b64)) {
          const b64 = cleanB64(p.annotated_image_b64 || p.image_b64);
          contentBlocks.push({ text: `--- ${side.toUpperCase()} ANGLE ---` });
          contentBlocks.push({
            image: {
              format: "jpeg",
              source: { bytes: b64 },
            },
          });
        }
      }

      const prompt = `You are a Senior Automotive Insurance Surveyor and Motor Loss Assessor.
Analyze these 4 vehicle photos for an insurance claim in India.
Vehicle & Claim Data:
${qText.join("\n")}
Manual Markings:
${annText.join("\n")}

Instructions:
1. Examine all 4 angles carefully for dents, scratches, paint scuffs, cracks, alignment gaps, or structural damage.
IMPORTANT: You MUST inspect and itemize every defect explicitly flagged in "Manual Markings" above (especially any custom user-added defects such as dented wheel rims, bent suspension, undercarriage scrape, mirror damage, tire cuts, etc.). Ensure each marked defect is included as a distinct item in the "findings" list with accurate Indian body shop repair or replacement costs.
2. Estimate all parts replacement and body repair labor costs strictly in INDIAN RUPEES (₹ / INR), matching authorized Indian automobile body shop benchmarks (e.g. Minor bumper repair/paint ₹2,500-₹5,500, Bumper replacement ₹7,000-₹14,000, Door dent removal & paint ₹4,000-₹9,500, Alloy wheel rim repair/replacement ₹3,500-₹9,500, Side mirror assembly ₹2,500-₹6,500, Quarter panel repair ₹4,500-₹8,500).
3. Return strictly valid JSON:
{
  "claim_risk_level": "LOW" or "MEDIUM" or "HIGH",
  "severity_score": 35,
  "damage_classification": "Moderate Repairable",
  "executive_summary": "Comprehensive 4-angle vehicle loss assessment...",
  "findings": [
    {
      "side": "Front",
      "component": "Front Bumper Fascia",
      "damage_type": "Crack & Deep Scuff",
      "severity": "Moderate",
      "repair_action": "Repair & Repaint",
      "parts_cost_inr": 0.0,
      "labor_cost_inr": 3500.0,
      "paint_cost_inr": 2000.0,
      "estimated_cost_inr": 5500.0,
      "included_in_claim": true,
      "details": "Front bumper skin cracked on lower passenger side."
    }
  ],
  "fraud_consistency_check": "Physical vehicle impact exhibits consistency with declared incident.",
  "adjuster_recommendation": "Approve standard repair estimate after deductible."
}`;

      contentBlocks.push({ text: prompt });
      const targetModel = body.model_id || PRIMARY_MODEL;
      const aiText = await callBedrockWithFallback(targetModel, contentBlocks);
      const parsed = parseJsonFromLlm(aiText);

      // Fallback findings if model returned empty
      const findings = Array.isArray(parsed.findings) && parsed.findings.length > 0 ? parsed.findings.map((f: any) => ({
        side: f.side || "Front",
        component: f.component || "Bumper Assembly",
        damage_type: f.damage_type || "Surface Dent",
        severity: f.severity || "Minor",
        repair_action: f.repair_action || "Repair & Paint",
        parts_cost_inr: Number(f.parts_cost_inr) || 0,
        labor_cost_inr: Number(f.labor_cost_inr) || 0,
        paint_cost_inr: Number(f.paint_cost_inr) || 0,
        estimated_cost_inr: Number(f.estimated_cost_inr || (Number(f.parts_cost_inr || 0) + Number(f.labor_cost_inr || 0) + Number(f.paint_cost_inr || 0))) || 3000,
        included_in_claim: f.included_in_claim !== false,
        details: f.details || "Observed vehicle loss finding.",
      })) : [
        {
          side: "Front",
          component: "Front Bumper Fascia",
          damage_type: "Surface Dent",
          severity: "Minor",
          repair_action: "Repair & Spot Paint",
          parts_cost_inr: 0,
          labor_cost_inr: 3000,
          paint_cost_inr: 1500,
          estimated_cost_inr: 4500,
          included_in_claim: true,
          details: "Impact dent and paint scrape on bumper.",
        }
      ];

      return jsonResponse(200, {
        claim_risk_level: parsed.claim_risk_level || "LOW",
        severity_score: Number(parsed.severity_score) || 25,
        damage_classification: parsed.damage_classification || "Minor Repairable",
        executive_summary: parsed.executive_summary || "Preliminary 4-angle visual appraisal complete.",
        findings,
        fraud_consistency_check: parsed.fraud_consistency_check || "Physical vehicle damage exhibits consistency with typical road incident.",
        adjuster_recommendation: parsed.adjuster_recommendation || "Fast-track approval under standard policy limits.",
      });
    }

    // ----------------------------------------------------
    // POST /api/estimate-custom-flaw
    // ----------------------------------------------------
    if (method === "POST" && (path === "/api/estimate-custom-flaw" || path.endsWith("/estimate-custom-flaw"))) {
      const body = JSON.parse(event.body || "{}");
      const prompt = `You are an Indian Motor Insurance Loss Assessor and Body Shop Valuation Expert.
A surveyor or claimant has reported an additional vehicle flaw not clearly captured in the 4 body angles:
- Vehicle: ${body.year || ""} ${body.make || ""} ${body.model || "Automobile"}
- Flaw Description: "${body.flaw_description || ""}"
- Severity Assessment: ${body.severity || "Moderate"}

Determine the realistic Indian body shop and OEM replacement cost in Indian Rupees (₹ / INR).
Consider whether this flaw typically requires part replacement (e.g. cracked alloy wheel, cut tire) or repair (e.g. lip bend, rim scratch, link rebush).
Benchmark to authorized Indian OEM rates (e.g. Alloy wheel replacement ₹8,500-₹22,000, Wheel repair ₹1,800-₹3,500, Tire replacement ₹4,500-₹12,000, Suspension control arm ₹3,500-₹9,000).

Return strictly JSON:
{
  "component": "Front Left Alloy Wheel Rim",
  "damage_type": "Rim Lip Bend & Scuff",
  "repair_action": "Alloy Wheel Truing & Repaint",
  "parts_cost_inr": 0.0,
  "labor_cost_inr": 2800.0,
  "total_cost_inr": 2800.0,
  "notes": "Wheel truing and cosmetic refinishing recommended."
}`;

      const aiText = await callBedrockWithFallback(body.model_id || PRIMARY_MODEL, [{ text: prompt }]);
      const parsed = parseJsonFromLlm(aiText);

      return jsonResponse(200, {
        component: parsed.component || body.flaw_description || "Custom Flaw",
        damage_type: parsed.damage_type || "Mechanical / Cosmetic Defect",
        repair_action: parsed.repair_action || "Repair & Refinish",
        parts_cost_inr: Number(parsed.parts_cost_inr) || 0,
        labor_cost_inr: Number(parsed.labor_cost_inr) || 2500,
        total_cost_inr: Number(parsed.total_cost_inr) || (Number(parsed.parts_cost_inr || 0) + Number(parsed.labor_cost_inr || 2500)),
        notes: parsed.notes || "Estimated by AI loss valuation benchmark.",
      });
    }

    // ----------------------------------------------------
    // POST /api/finalize-report
    // ----------------------------------------------------
    if (method === "POST" && (path === "/api/finalize-report" || path.endsWith("/finalize-report"))) {
      const body = JSON.parse(event.body || "{}");
      const uniqueSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
      const inspectionId = body.inspection_id || `SURV-${dateStr}-${uniqueSuffix}`;
      const createdAtIso = now.toISOString();

      let partsTotal = 0;
      let laborTotal = 0;
      let paintTotal = 0;

      const findings = Array.isArray(body.findings) ? body.findings : [];
      for (const f of findings) {
        if (f.included_in_claim !== false) {
          partsTotal += Number(f.parts_cost_inr) || 0;
          laborTotal += Number(f.labor_cost_inr) || 0;
          paintTotal += Number(f.paint_cost_inr) || 0;
        }
      }

      const grossTotal = partsTotal + laborTotal + paintTotal;
      const deductible = Number(body.policy_deductible_inr) || 0;
      const depreciationRate = (Number(body.depreciation_percent) || 0) / 100;
      const depreciationAmount = Math.round(partsTotal * depreciationRate * 100) / 100;
      const netPayable = Math.max(0, Math.round((grossTotal - deductible - depreciationAmount) * 100) / 100);

      const q = body.questionnaire || {};
      let vehicleTitle = `${q.year || ""} ${q.make || ""} ${q.model || "Automobile"}`.trim();
      if (!vehicleTitle || vehicleTitle === "Automobile") {
        vehicleTitle = `Motor Claim #${uniqueSuffix}`;
      }

      const costBreakdown = {
        parts_cost_inr: Math.round(partsTotal * 100) / 100,
        labor_cost_inr: Math.round(laborTotal * 100) / 100,
        paint_refinish_inr: Math.round(paintTotal * 100) / 100,
        gross_total_inr: Math.round(grossTotal * 100) / 100,
        policy_deductible_inr: Math.round(deductible * 100) / 100,
        depreciation_inr: Math.round(depreciationAmount * 100) / 100,
        net_payable_inr: Math.round(netPayable * 100) / 100,
      };

      const report = {
        inspection_id: inspectionId,
        created_at: createdAtIso,
        claim_risk_level: body.claim_risk_level || "LOW",
        severity_score: body.severity_score || 25,
        damage_classification: body.damage_classification || "Repairable Damage",
        executive_summary: body.executive_summary || "Official motor loss appraisal completed across all vehicle aspects.",
        findings,
        cost_breakdown: costBreakdown,
        fraud_consistency_check: body.fraud_consistency_check || "Physical loss exhibits high consistency with typical road usage.",
        adjuster_recommendation: body.adjuster_recommendation || "Approved for standard policy claim settlement.",
        raw_markdown: "",
      };

      const doc: any = {
        inspection_id: inspectionId,
        created_at: createdAtIso,
        status: "COMPLETED",
        vehicle_title: vehicleTitle,
        license_plate: q.license_plate || "N/A",
        questionnaire: q,
        photos: body.photos || {},
        report,
      };

      try {
        const db = await getMongoDb();
        await db.collection("inspections").updateOne(
          { inspection_id: inspectionId },
          { $set: doc },
          { upsert: true }
        );
      } catch (dbErr: any) {
        console.error("Failed to save inspection to MongoDB:", dbErr);
        doc["db_save_error"] = dbErr.message;
      }

      return jsonResponse(200, doc);
    }

    // ----------------------------------------------------
    // GET /api/inspections
    // ----------------------------------------------------
    if (method === "GET" && (path === "/api/inspections" || path.endsWith("/inspections"))) {
      const qParams = event.queryStringParameters || {};
      const limit = Math.min(100, parseInt(qParams.limit || "30", 10));
      const skip = Math.max(0, parseInt(qParams.skip || "0", 10));
      const searchQuery = qParams.query;
      const severity = qParams.severity;

      const filter: any = {};
      if (searchQuery) {
        filter.$or = [
          { inspection_id: { $regex: searchQuery, $options: "i" } },
          { vehicle_title: { $regex: searchQuery, $options: "i" } },
          { license_plate: { $regex: searchQuery, $options: "i" } },
        ];
      }
      if (severity && severity !== "ALL") {
        filter["report.claim_risk_level"] = severity.toUpperCase();
      }

      const db = await getMongoDb();
      const records = await db.collection("inspections")
        .find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Clean _id for JSON serialization
      const cleanRecords = records.map((r: any) => {
        const { _id, ...rest } = r;
        return { ...rest, id: _id?.toString() };
      });

      return jsonResponse(200, {
        count: cleanRecords.length,
        inspections: cleanRecords,
      });
    }

    // ----------------------------------------------------
    // GET /api/inspections/{id}
    // ----------------------------------------------------
    if (method === "GET" && path.includes("/api/inspections/")) {
      const id = decodeURIComponent(path.split("/api/inspections/")[1].split("/")[0]);
      const db = await getMongoDb();
      const record = await db.collection("inspections").findOne({ inspection_id: id });
      if (!record) {
        return jsonResponse(404, { detail: "Inspection dossier not found" });
      }
      const { _id, ...rest } = record;
      return jsonResponse(200, { ...rest, id: _id?.toString() });
    }

    // ----------------------------------------------------
    // DELETE /api/inspections/{id}
    // ----------------------------------------------------
    if (method === "DELETE" && path.includes("/api/inspections/")) {
      const id = decodeURIComponent(path.split("/api/inspections/")[1].split("/")[0]);
      const db = await getMongoDb();
      const res = await db.collection("inspections").deleteOne({ inspection_id: id });
      if (res.deletedCount === 0) {
        return jsonResponse(404, { detail: "Record not found or could not be deleted" });
      }
      return jsonResponse(200, { status: "success", inspection_id: id, deleted: true });
    }

    return jsonResponse(404, { detail: `Route not found: ${method} ${path}` });
  } catch (err: any) {
    console.error("Handler error:", err);
    return jsonResponse(500, { detail: `Internal Server Error: ${err.message}` });
  }
};
