#!/usr/bin/env python3
"""
Stremux AutoClaim - AI Car Insurance Inspector Launcher
Zero-config runner that verifies Atlas and Bedrock connections before booting Uvicorn.
"""

import sys
import os
from pathlib import Path
from dotenv import load_dotenv

# Ensure root directory and backend directory are in sys.path
BASE_DIR = Path(__file__).resolve().parent
PRODUCT_DIR = BASE_DIR / "car_insurance_inspector"
BACKEND_DIR = PRODUCT_DIR / "backend"

sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(BASE_DIR))

# Load .env
env_file = BASE_DIR / ".env"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

def print_banner():
    banner = """
  ========================================================================
     ⚡ AUTOCLAIM PRO - MOTOR INSURANCE SURVEY & LOSS ASSESSMENT ⚡
  ========================================================================
     • Vision Intelligence: Multimodal Damage Inspection Engine
     • Cloud Database:     Enterprise Survey & Claims Archive
     • Damage Studio:      Interactive Canvas Annotator (Circles/Boxes)
     • 4-Sided Dossier:    Front, Rear, Left Side, Right Side
  ========================================================================
    """
    print(banner)

def preflight_checks():
    print("[1/3] Checking environment & credentials...")
    bedrock_key = os.getenv("BEDROCK_API_KEY", "")
    mongo_uri = os.getenv("MONGODB_URI", "")

    if not bedrock_key or "your_" in bedrock_key:
        print("  ⚠️  BEDROCK_API_KEY not found or default template in .env")
    else:
        print(f"  ✓ Bedrock API key configured ({bedrock_key[:12]}...)")

    if not mongo_uri:
        print("  ⚠️  MONGODB_URI not found in .env")
    else:
        print("  ✓ MongoDB Atlas URI configured")

    print("\n[2/3] Verifying MongoDB Atlas connection...")
    try:
        from db_service import db_service
        ping_res = db_service.ping()
        if ping_res.get("status") == "connected":
            print(f"  ✓ MongoDB Atlas Connected (DB: {ping_res.get('database')})")
        else:
            print(f"  ⚠️  MongoDB Atlas Warning: {ping_res.get('message')}")
    except Exception as e:
        print(f"  ⚠️  Could not ping MongoDB Atlas: {e}")

    print("\n[3/3] Ready to launch server!")

def main():
    print_banner()
    preflight_checks()

    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))

    print(f"\n🚀 Server starting on http://localhost:{port}")
    print(f"   API Documentation: http://localhost:{port}/docs")
    print(f"   Press CTRL+C to stop.\n")

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        app_dir=str(BACKEND_DIR)
    )

if __name__ == "__main__":
    main()
