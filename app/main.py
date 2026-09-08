from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.omr import parse_sheet, score_sheets


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"

app = FastAPI(title="AI OMR Scanner", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def _decode_image(file_bytes: bytes) -> np.ndarray:
    image_np = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_np, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode image. Upload JPG/PNG/PDF-converted image.")
    return image


@app.post("/api/score")
async def score(
    answer_key: UploadFile = File(...),
    omr_sheet: UploadFile = File(...),
) -> dict:
    key_data = await answer_key.read()
    omr_data = await omr_sheet.read()

    if not key_data or not omr_data:
        raise HTTPException(status_code=400, detail="Both answer key and OMR sheet files are required.")

    key_image = _decode_image(key_data)
    omr_image = _decode_image(omr_data)

    key_parse = parse_sheet(key_image)
    omr_parse = parse_sheet(omr_image)

    if not key_parse.questions:
        raise HTTPException(status_code=400, detail="Could not detect answer key bubbles.")
    if not omr_parse.questions:
        raise HTTPException(status_code=400, detail="Could not detect OMR bubbles on student sheet.")

    scored = score_sheets(key_parse, omr_parse)

    return {
        "message": "Scoring completed",
        **scored,
    }
