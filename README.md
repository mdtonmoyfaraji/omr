# OMR Auto Scoring Website

This repository now includes a complete website to:

- Upload an **answer key sheet** image
- Upload a **student OMR sheet** image
- Automatically detect marked bubbles from variable layouts
- Calculate **correct / wrong / blank / review needed** instantly

It is designed to work without fixed coordinates (layout-free row and bubble grouping), so you can scan different OMR styles quickly.

## Stack

- Frontend: HTML + JS (served by FastAPI)
- Backend: FastAPI + OpenCV + NumPy
- Test: Pytest

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open: `http://127.0.0.1:8000`

## API

### `POST /api/score`

Form-data fields:

- `answer_key` (image file)
- `omr_sheet` (image file)

Response contains:

- `summary` (total, correct, wrong, blank, review_needed)
- `results` (per question verdict)
- `warnings` (low-confidence or mismatch notes)

## Notes

- Works best on clear scans with good lighting.
- Blurry or lightly filled bubbles are flagged as review-needed via confidence checks.
- For full production “any layout, any quality” support, you can add a trained detection model fallback (YOLO/Document AI) on top of this base.
