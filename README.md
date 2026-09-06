# Products_Stremux 🚀

Welcome to **Products_Stremux** — a collection of AI-driven, cloud-backed enterprise and consumer applications.

---

## 📦 Products Portfolio

### 1. ⚡ [AutoClaim Pro - Motor Insurance Survey & Loss Assessment System](./car_insurance_inspector)
*Enterprise Automotive Loss Assessment System*
- **Description**: Upload 4-angle vehicle photos (Front, Rear, Left, Right), visually annotate damage (circle dents, scratches, missing paint, cracks), add custom defect classifications with instant AI cost calculation, edit line-item loss schedules in Indian Rupees (₹), and compile official certified survey reports.
- **Directory**: [`./car_insurance_inspector`](./car_insurance_inspector)
- **Run**: `python run.py`

*(Additional products will be cataloged here as they are released).*

---

## 🛠️ Quick Launch

### Local Run
```bash
# 1. Install dependencies
pip install -r car_insurance_inspector/requirements.txt

# 2. Copy and configure environment variables
cp .env.example .env

# 3. Launch application
python run.py
```
Then visit `http://localhost:8000` in your browser.

### Docker Run
```bash
docker build -t autoclaim-pro .
docker run -p 8000:8000 --env-file .env autoclaim-pro
```

---

## ☁️ Cloud Deployment (Single-Stack via AWS Amplify)

AutoClaim Pro is configured for **zero-server, single-stack deployment on AWS Amplify (Gen 2)**:
- **100% Serverless & Integrated**: Frontend static distribution + AWS Lambda serverless function API deployed automatically from GitHub in a single step.
- **No separate servers**: No EC2 instances, containers, or standalone services to manage.
- **Environment Variables in Amplify Console**:
  Set `BEDROCK_API_KEY`, `MONGODB_URI`, and `AWS_REGION` under **App settings &rarr; Environment variables**.
