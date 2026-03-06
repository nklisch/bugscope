# Course Grading System

Computes weighted final grades for students across assignment categories with late penalties and drop-lowest logic.

## Files

- `models.py` — `Student`, `Assignment`, `CategoryConfig`, `CourseConfig`, `GradeReport` data structures
- `data.py` — test students and course configuration (Alice Chen, Bob Martinez, CS201)
- `grading.py` — weighted average calculation and letter grade assignment
- `late_policy.py` — late penalty computation
- `course.py` — `process_student_grades(student, assignments, config)` top-level function
- `transcripts.py` — transcript formatting utilities
- `test_grades.py` — test suite

## Running

```bash
python3 -m pytest test_grades.py -v
```
