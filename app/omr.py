from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import List, Optional

import cv2
import numpy as np


@dataclass
class Bubble:
    x: int
    y: int
    radius: int


@dataclass
class QuestionResult:
    question_id: int
    selected_index: Optional[int]
    option_count: int
    status: str
    confidence: float


@dataclass
class SheetParseResult:
    questions: List[QuestionResult]
    warnings: List[str]


def _preprocess(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        8,
    )
    kernel = np.ones((3, 3), np.uint8)
    return cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)


def _find_bubbles(binary: np.ndarray) -> List[Bubble]:
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = binary.shape[0] * binary.shape[1]
    min_area = max(30, int(image_area * 0.00002))
    max_area = int(image_area * 0.002)

    bubbles: List[Bubble] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue

        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            continue

        circularity = 4 * np.pi * area / (perimeter * perimeter)
        if circularity < 0.6:
            continue

        (x, y), radius = cv2.minEnclosingCircle(contour)
        radius_int = int(radius)
        if radius_int < 4:
            continue

        bubbles.append(Bubble(x=int(x), y=int(y), radius=radius_int))

    return bubbles


def _group_rows(bubbles: List[Bubble]) -> List[List[Bubble]]:
    if not bubbles:
        return []

    bubbles_sorted = sorted(bubbles, key=lambda b: b.y)
    radii = [b.radius for b in bubbles_sorted]
    row_tolerance = max(8, int(median(radii) * 1.8))

    rows: List[List[Bubble]] = []
    current_row: List[Bubble] = [bubbles_sorted[0]]

    for bubble in bubbles_sorted[1:]:
        row_mean = int(sum(b.y for b in current_row) / len(current_row))
        if abs(bubble.y - row_mean) <= row_tolerance:
            current_row.append(bubble)
        else:
            rows.append(sorted(current_row, key=lambda b: b.x))
            current_row = [bubble]

    rows.append(sorted(current_row, key=lambda b: b.x))

    filtered = [row for row in rows if len(row) >= 2]
    return filtered


def _fill_ratio(binary: np.ndarray, bubble: Bubble) -> float:
    mask = np.zeros(binary.shape, dtype=np.uint8)
    cv2.circle(mask, (bubble.x, bubble.y), max(2, int(bubble.radius * 0.75)), 255, -1)
    selected_pixels = cv2.bitwise_and(binary, binary, mask=mask)

    white_pixels = cv2.countNonZero(selected_pixels)
    area = max(1, cv2.countNonZero(mask))
    return white_pixels / area


def parse_sheet(image: np.ndarray) -> SheetParseResult:
    binary = _preprocess(image)
    bubbles = _find_bubbles(binary)
    rows = _group_rows(bubbles)

    warnings: List[str] = []
    if not rows:
        return SheetParseResult(questions=[], warnings=["No OMR rows detected. Try a clearer scan."])

    questions: List[QuestionResult] = []
    for idx, row in enumerate(rows, start=1):
        ratios = [_fill_ratio(binary, bubble) for bubble in row]

        best_i = int(np.argmax(ratios))
        sorted_ratios = sorted(ratios, reverse=True)
        best = sorted_ratios[0]
        second = sorted_ratios[1] if len(sorted_ratios) > 1 else 0.0

        min_mark_threshold = 0.2
        ambiguous_gap = 0.05

        if best < min_mark_threshold:
            status = "blank"
            selected_index = None
            confidence = 1 - best
        elif best - second < ambiguous_gap:
            status = "multiple"
            selected_index = None
            confidence = max(0.0, best - second)
            warnings.append(f"Q{idx}: multiple/unclear mark detected")
        else:
            status = "marked"
            selected_index = best_i
            confidence = min(1.0, best - second)

        questions.append(
            QuestionResult(
                question_id=idx,
                selected_index=selected_index,
                option_count=len(row),
                status=status,
                confidence=round(float(confidence), 3),
            )
        )

    return SheetParseResult(questions=questions, warnings=warnings)


def score_sheets(answer_key: SheetParseResult, student: SheetParseResult) -> dict:
    max_questions = min(len(answer_key.questions), len(student.questions))
    results = []

    summary = {
        "total": max_questions,
        "correct": 0,
        "wrong": 0,
        "blank": 0,
        "review_needed": 0,
    }

    for i in range(max_questions):
        key_q = answer_key.questions[i]
        student_q = student.questions[i]

        if key_q.status != "marked" or key_q.selected_index is None:
            verdict = "key_invalid"
            summary["review_needed"] += 1
        elif student_q.status == "blank":
            verdict = "blank"
            summary["blank"] += 1
        elif student_q.status != "marked" or student_q.selected_index is None:
            verdict = "review_needed"
            summary["review_needed"] += 1
        elif student_q.selected_index == key_q.selected_index:
            verdict = "correct"
            summary["correct"] += 1
        else:
            verdict = "wrong"
            summary["wrong"] += 1

        results.append(
            {
                "question": i + 1,
                "key_option_index": key_q.selected_index,
                "student_option_index": student_q.selected_index,
                "option_count": min(key_q.option_count, student_q.option_count),
                "verdict": verdict,
                "student_confidence": student_q.confidence,
            }
        )

    extra_key = len(answer_key.questions) - max_questions
    extra_student = len(student.questions) - max_questions
    warnings = [*answer_key.warnings, *student.warnings]
    if extra_key:
        warnings.append(f"Answer sheet has {extra_key} extra questions not matched.")
    if extra_student:
        warnings.append(f"Student sheet has {extra_student} extra questions not matched.")

    return {
        "summary": summary,
        "results": results,
        "warnings": warnings,
    }
