import base64
import numpy as np
from PIL import Image
import io
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

print("=== 1. Testing /health ===")
with client:
    health_res = client.get("/health")
    print("Health Status:", health_res.status_code)
    print("Health Response:", health_res.json())

    print("\n=== 2. Testing Predictions ===")
    test_suite = [
        ("test-TomatoHealthy1.JPG", "tomato", "Tier A Tomato Healthy"),
        ("test-TomatoYellowCurlVirus1.JPG", "tomato", "Tier A Tomato Yellow Leaf Curl Virus"),
        ("test-PotatoEarlyBlight1.JPG", "potato", "PlantVillage Potato Early Blight"),
        ("test-AppleCedarRust1.JPG", "apple", "PlantVillage Apple Cedar Rust"),
        ("test-CornCommonRust1.JPG", "maize", "PlantVillage Corn Common Rust"),
    ]

    for filename, crop_type, desc in test_suite:
        with open(filename, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")

        res = client.post("/predict", json={"image_b64": b64, "crop_type": crop_type})
        assert res.status_code == 200, f"Failed for {filename}: {res.text}"
        data = res.json()
        print(f"\n[{desc}] (Crop: {crop_type})")
        print(f"  Class: {data['class_name']}")
        print(f"  Confidence: {data['confidence'] * 100:.2f}%")
        print(f"  Model Version: {data['model_version']}")
        print(f"  Fallback Recommended: {data['fallback_recommended']}")
        print(f"  Top 3: {[(t['class_name'], t['confidence']) for t in data['top_k'][:3]]}")

    print("\n=== 3. Testing Fallback on Ambiguous/Blank Image ===")
    blank_img = Image.fromarray(np.zeros((288, 288, 3), dtype=np.uint8))
    buf = io.BytesIO()
    blank_img.save(buf, format="JPEG")
    blank_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    res = client.post("/predict", json={"image_b64": blank_b64, "crop_type": "rice"})
    assert res.status_code == 200
    blank_data = res.json()
    print(f"Blank image prediction: {blank_data['class_name']} ({blank_data['confidence'] * 100:.2f}%)")
    print(f"Fallback recommended? -> {blank_data['fallback_recommended']} (Threshold: {blank_data['confidence_threshold']})")
    assert blank_data['fallback_recommended'] is True, "Fallback should be recommended for ambiguous image!"
    print("\nAll tests passed successfully!")
