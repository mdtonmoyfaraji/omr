import cv2
import numpy as np

from app.omr import parse_sheet, score_sheets


def _make_sheet(marked_indices, questions=5, options=4):
    img = np.full((questions * 70 + 40, options * 70 + 80, 3), 255, dtype=np.uint8)
    radius = 18

    for q in range(questions):
        y = 40 + q * 70
        for o in range(options):
            x = 50 + o * 70
            cv2.circle(img, (x, y), radius, (0, 0, 0), 2)
            if marked_indices[q] == o:
                cv2.circle(img, (x, y), radius - 5, (0, 0, 0), -1)
    return img


def test_parse_and_score_simple_case():
    key_img = _make_sheet([0, 1, 2, 3, 0])
    student_img = _make_sheet([0, 2, 2, 1, 0])

    key = parse_sheet(key_img)
    student = parse_sheet(student_img)

    assert len(key.questions) == 5
    assert len(student.questions) == 5

    scored = score_sheets(key, student)
    assert scored["summary"]["correct"] == 3
    assert scored["summary"]["wrong"] == 2
