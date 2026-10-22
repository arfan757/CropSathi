"""CropSathi ML Service — Dual-model Pure ONNX Plant Disease Detection.

Models loaded:
1. cropsathi_v1.onnx (Tier A): EfficientNetV2-S for Cotton, Rice, and Tomato (288x288, 27 classes, temperature-calibrated).
2. plantvillage_38.onnx: 14 PlantVillage crops (Apple, Maize, Potato, Grape, etc., 128x128, 38 classes).

Pure ONNX Runtime execution: lightweight, fast cold starts, zero TensorFlow dependencies.
"""

import base64
import io
import json
import os
from contextlib import asynccontextmanager
from typing import List, Optional

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

# Configuration paths
TIER_A_MODEL_PATH = os.environ.get("TIER_A_MODEL_PATH", "cropsathi_v1.onnx")
TIER_A_META_PATH = os.environ.get("TIER_A_META_PATH", "cropsathi_v1_meta.json")

PLANTVILLAGE_MODEL_PATH = os.environ.get("PLANTVILLAGE_MODEL_PATH", "plantvillage_38.onnx")
PLANTVILLAGE_META_PATH = os.environ.get("PLANTVILLAGE_META_PATH", "plantvillage_38_meta.json")

# Crop categories for model routing
TIER_A_CROPS = {"cotton", "rice", "tomato", "paddy", "dhan", "kapas"}
PLANTVILLAGE_CROPS = {
    "maize", "corn", "corn (maize)", "potato", "grapes", "grape", "apple",
    "blueberry", "cherry", "orange", "peach", "pepper", "bell pepper",
    "raspberry", "soybean", "squash", "strawberry"
}

_sessions = {}
_meta = {}


def load_model_and_meta(name: str, model_path: str, meta_path: str):
    if os.path.exists(model_path) and os.path.exists(meta_path):
        session = ort.InferenceSession(model_path)
        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
        _sessions[name] = session
        _meta[name] = metadata
        print(f"[ml-service] Loaded {name} from {model_path} ({len(metadata.get('classes', []))} classes)", flush=True)
    else:
        print(f"[ml-service] Warning: Missing files for {name} ({model_path}, {meta_path})", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model_and_meta("tier_a", TIER_A_MODEL_PATH, TIER_A_META_PATH)
    load_model_and_meta("plantvillage", PLANTVILLAGE_MODEL_PATH, PLANTVILLAGE_META_PATH)
    yield
    _sessions.clear()
    _meta.clear()


app = FastAPI(
    title="CropSathi Pure-ONNX ML Service",
    version="2.0.0",
    description="Dual-model ONNX microservice for crop disease classification with automatic Gemini fallback gating.",
    lifespan=lifespan
)


class PredictRequest(BaseModel):
    image_b64: str
    crop_type: Optional[str] = ""


class TopKItem(BaseModel):
    class_name: str
    confidence: float


class PredictResponse(BaseModel):
    class_name: str
    confidence: float
    top_k: List[TopKItem]
    model_version: str
    fallback_recommended: bool
    confidence_threshold: float


def run_tier_a_inference(img: Image.Image) -> PredictResponse:
    sess = _sessions["tier_a"]
    meta = _meta["tier_a"]

    img_size = meta.get("img_size", 288)
    resized = img.resize((img_size, img_size))
    arr = np.asarray(resized, dtype=np.float32) / 255.0

    mean = np.array(meta.get("mean", [0.485, 0.456, 0.406]), dtype=np.float32)
    std = np.array(meta.get("std", [0.229, 0.224, 0.225]), dtype=np.float32)
    arr = (arr - mean) / std
    # NCHW layout for EfficientNet
    arr = np.transpose(arr, (2, 0, 1))
    arr = np.expand_dims(arr, axis=0)

    input_name = sess.get_inputs()[0].name
    logits = sess.run(None, {input_name: arr})[0][0]

    # Temperature scaling
    temp = float(meta.get("temperature", 1.0))
    scaled = logits / temp
    exp_logits = np.exp(scaled - np.max(scaled))
    probs = exp_logits / np.sum(exp_logits)

    order = np.argsort(probs)[::-1]
    classes = meta["classes"]
    top_class = classes[order[0]]
    top_conf = round(float(probs[order[0]]), 4)
    threshold = float(meta.get("confidence_threshold", 0.90))

    top_k = [
        TopKItem(class_name=classes[i], confidence=round(float(probs[i]), 4))
        for i in order[:5]
    ]

    return PredictResponse(
        class_name=top_class,
        confidence=top_conf,
        top_k=top_k,
        model_version=f"cropsathi-v1-tierA ({meta.get('model', 'efficientnetv2')})",
        fallback_recommended=top_conf < threshold,
        confidence_threshold=threshold,
    )


def _crop_prefix(class_name: str) -> str:
    """Extract the crop name prefix from a class label (e.g. 'Tomato' from 'Tomato___Bacterial_spot')."""
    if "___" in class_name:
        return class_name.split("___")[0].strip().lower()
    if "__" in class_name:
        return class_name.split("__")[0].strip().lower()
    return ""


# Canonical crop-name aliases for mismatch detection
_CROP_ALIASES: dict[str, str] = {
    "corn_(maize)": "maize",
    "corn": "maize",
    "grape": "grapes",
    "pepper,_bell": "pepper",
    "bell pepper": "pepper",
    "cherry_(including_sour)": "cherry",
    "paddy": "rice",
    "dhan": "rice",
    "kapas": "cotton",
}


def _normalise_crop(name: str) -> str:
    s = name.strip().lower()
    return _CROP_ALIASES.get(s, s)


def run_plantvillage_inference(img: Image.Image, requested_crop: str = "") -> PredictResponse:
    sess = _sessions["plantvillage"]
    meta = _meta["plantvillage"]

    img_size = meta.get("img_size", 128)
    resized = img.resize((img_size, img_size))
    # Float32 in 0..255, NHWC layout
    arr = np.asarray(resized, dtype=np.float32)
    arr = np.expand_dims(arr, axis=0)

    input_name = sess.get_inputs()[0].name
    preds = sess.run(None, {input_name: arr})[0][0]

    # Softmax probabilities if not already normalized
    if np.abs(np.sum(preds) - 1.0) > 0.05:
        exp_preds = np.exp(preds - np.max(preds))
        probs = exp_preds / np.sum(exp_preds)
    else:
        probs = preds

    order = np.argsort(probs)[::-1]
    classes = meta["classes"]
    top_class = classes[order[0]]
    top_conf = round(float(probs[order[0]]), 4)
    threshold = float(meta.get("confidence_threshold", 0.85))

    top_k = [
        TopKItem(class_name=classes[i], confidence=round(float(probs[i]), 4))
        for i in order[:5]
    ]

    # Crop-mismatch guard: if the predicted class belongs to a different crop
    # than what was requested, force fallback so we don't return nonsense.
    fallback = top_conf < threshold
    if not fallback and requested_crop:
        predicted_crop = _normalise_crop(_crop_prefix(top_class))
        norm_requested = _normalise_crop(requested_crop)
        if predicted_crop and norm_requested and predicted_crop != norm_requested:
            print(
                f"[ml-service] Crop mismatch: requested={norm_requested!r}, "
                f"predicted={predicted_crop!r} ({top_class}) — forcing fallback",
                flush=True,
            )
            fallback = True

    return PredictResponse(
        class_name=top_class,
        confidence=top_conf,
        top_k=top_k,
        model_version="plantvillage-38-onnx",
        fallback_recommended=fallback,
        confidence_threshold=threshold,
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models": {
            name: {
                "loaded": name in _sessions,
                "classes": len(_meta[name].get("classes", [])) if name in _meta else 0,
                "version": _meta[name].get("version", "unknown") if name in _meta else "unknown",
            }
            for name in ["tier_a", "plantvillage"]
        },
        "supported_crops": list(TIER_A_CROPS | PLANTVILLAGE_CROPS),
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if not _sessions:
        raise HTTPException(status_code=503, detail="No ML models loaded")

    try:
        raw_bytes = base64.b64decode(req.image_b64)
        image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}") from exc

    norm_crop = (req.crop_type or "").strip().lower()

    # Route based on crop type
    has_tier_a = "tier_a" in _sessions
    has_pv = "plantvillage" in _sessions

    if norm_crop in TIER_A_CROPS and has_tier_a:
        return run_tier_a_inference(image)

    if norm_crop in PLANTVILLAGE_CROPS and has_pv:
        return run_plantvillage_inference(image, requested_crop=norm_crop)

    # If crop_type not provided or unmapped, run Tier A first if available, else PlantVillage
    if has_tier_a:
        tier_a_res = run_tier_a_inference(image)
        if not tier_a_res.fallback_recommended or not has_pv:
            return tier_a_res

        # If Tier A was low confidence and PlantVillage is available, evaluate PlantVillage
        pv_res = run_plantvillage_inference(image, requested_crop=norm_crop)
        return pv_res if pv_res.confidence > tier_a_res.confidence else tier_a_res

    if has_pv:
        return run_plantvillage_inference(image, requested_crop=norm_crop)

    raise HTTPException(status_code=503, detail="No suitable model available for inference")