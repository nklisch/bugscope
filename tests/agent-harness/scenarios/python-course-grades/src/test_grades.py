"""Visible tests for the course grading system."""

from course import process_student_grades
from data import bob, bob_assignments, cs201_config


def test_bob_final_grade():
    """Bob Martinez should receive a C+ — his scores are straightforward."""
    report = process_student_grades(bob, bob_assignments, cs201_config)
    assert report.letter_grade == "C+", (
        f"Expected C+ for Bob, got {report.letter_grade} "
        f"(numeric: {report.numeric_score:.2f})"
    )


def test_bob_numeric_score():
    """Bob's weighted score: 80×0.40 + 74×0.30 + 71×0.20 + 95×0.10 = 77.9."""
    report = process_student_grades(bob, bob_assignments, cs201_config)
    assert abs(report.numeric_score - 77.9) < 0.1, (
        f"Expected score ~77.9, got {report.numeric_score:.2f}"
    )
