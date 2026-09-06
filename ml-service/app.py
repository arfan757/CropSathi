"""CropSathi ML service — plant disease detection CNN.

Serves `trained_plant_disease_model.keras` from
goutam-dev/crop-disease-detection (38 PlantVillage classes, 128x128 RGB input).

Preprocessing mirrors the upstream repo's `main.py` exactly so predictions
match what the model was validated with:
    load_img(target_size=(128,128)) -> img_to_array -> expand_dims -> predict
(i.e. float32 pixel values in 0..255, no extra normalization).

The Node backend calls this over HTTP; it is a separate Render service.
"""

import base64
import io
import os
from contextlib import asynccontextmanager

import numpy as np
import tensorflow as tf
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

MODEL_PATH = os.environ.get("MODEL_PATH", "trained_plant_disease_model.keras")

# Class order matches the model's output layer (from the upstream main.py).
CLASS_NAMES = [
    "Apple___Apple_scab", "Apple___Black_rot", "Apple___Cedar_apple_rust", "Apple___healthy",
    "Blueberry___healthy", "Cherry_(including_sour)___Powdery_mildew",
    "Cherry_(including_sour)___healthy", "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "Corn_(maize)___Common_rust_", "Corn_(maize)___Northern_Leaf_Blight", "Corn_(maize)___healthy",
    "Grape___Black_rot", "Grape___Esca_(Black_Measles)", "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)",
    "Grape___healthy", "Orange___Haunglongbing_(Citrus_greening)", "Peach___Bacterial_spot",
    "Peach___healthy", "Pepper,_bell___Bacterial_spot", "Pepper,_bell___healthy",
    "Potato___Early_blight", "Potato___Late_blight", "Potato___healthy",
    "Raspberry___healthy", "Soybean___healthy", "Squash___Powdery_mildew",
    "Strawberry___Leaf_scorch", "Strawberry___healthy", "Tomato___Bacterial_spot",
    "Tomato___Early_blight", "Tomato___Late_blight", "Tomato___Leaf_Mold",
    "Tomato___Septoria_leaf_spot", "Tomato___Spider_mites Two-spotted_spider_mite",
    "Tomato___Target_Spot", "Tomato___Tomato_Yellow_Leaf_Curl_Virus", "Tomato___Tomato_mosaic_virus",
    "Tomato___healthy",
]

_model = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _model
    _model = tf.keras.models.load_model(MODEL_PATH)
    print(f"[ml-service] model loaded: {MODEL_PATH}", flush=True)
    yield
    _model = None


app = FastAPI(title="CropSathi ML Service", version="1.0.0", lifespan=lifespan)


class PredictRequest(BaseModel):
    image_b64: str


class PredictResponse(BaseModel):
    class_name: str
    confidence: float
    top_k: list


@app.get("/health")
def health():
    return {
        "status": "ok",
        "classes": len(CLASS_NAMES),
        "model_loaded": _model is not None,
    }


@app.post("/predict")
def predict(req: PredictRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        image = (
            Image.open(io.BytesIO(base64.b64decode(req.image_b64)))
            .convert("RGB")
            .resize((128, 128))
        )
    except Exception as exc:  # noqa: BLE001 - surface any decode/resize failure
        raise HTTPException(status_code=400, detail=f"Invalid image payload: {exc}") from exc

    arr = np.asarray(image, dtype=np.float32)  # 0..255 floats, same as img_to_array
    arr = np.expand_dims(arr, axis=0)
    preds = _model.predict(arr, verbose=0)[0]
    order = np.argsort(preds)[::-1][:5]
    top_k = [
        {"class_name": CLASS_NAMES[i], "confidence": round(float(preds[i]), 4)}
        for i in order
    ]
    return PredictResponse(
        class_name=CLASS_NAMES[order[0]],
        confidence=round(float(preds[order[0]]), 4),
        top_k=top_k,
    )