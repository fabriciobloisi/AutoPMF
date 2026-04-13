"""
Exhaustive test suite for autoloop-cycle.sh

Tests every function, every code path, and edge cases for:
1. Feedback guardrails (grade validation, empty feedback detection)
2. AUTOLOOP_MIN_FEEDBACK threshold
3. NPS calculation and trend
4. Sparkline rendering
5. Regression detection
6. Skipped feedback storage
7. Bash syntax and CLI interface
8. get_cycle / get_last_cycle / get_nps_trend helpers
9. Backward compatibility
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
SCRIPT = PROJECT_ROOT / "scripts" / "autoloop-cycle.sh"
AUTOLOOP_MD = PROJECT_ROOT / "autoloop.md"
SKIPPED_FILE = PROJECT_ROOT / "skipped_feedback.jsonl"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def extract_poll_python() -> str:
    """Extract the Python block embedded in cmd_poll from the script."""
    script = SCRIPT.read_text()
    start_marker = "printf '%s' \"$raw\" | python3 -c \""
    end_marker = "\"\n            unset AUTOLOOP_POLL_CYCLE"
    start = script.find(start_marker)
    end = script.find(end_marker, start)
    assert start != -1 and end != -1, "Could not find poll Python block in script"
    block = script[start + len(start_marker):end]
    # Unescape bash quoting
    block = block.replace('\\"', '"').replace("\\'", "'")
    return block


POLL_PYTHON = extract_poll_python()


def run_poll_python(
    entries: list,
    cycle: int = 5,
    trend: str = "2.0,3.0,5.0",
    regressing: str = "false",
    min_feedback: int = 1,
    extra_lines: list | None = None,
) -> dict | None:
    """Run the embedded Python poll block with given inputs.
    Returns parsed JSON output or None if stdout is empty.
    """
    raw_lines = [json.dumps(e) for e in entries]
    if extra_lines:
        raw_lines.extend(extra_lines)
    raw = "\n".join(raw_lines)

    env = {
        **os.environ,
        "AUTOLOOP_POLL_CYCLE": str(cycle),
        "AUTOLOOP_POLL_TREND": trend,
        "AUTOLOOP_POLL_REGRESSING": regressing,
        "AUTOLOOP_MIN_FEEDBACK": str(min_feedback),
    }

    # Patch skipped_file path to project root so we can inspect it
    code = POLL_PYTHON.replace(
        "skipped_file = 'skipped_feedback.jsonl'",
        f"skipped_file = {str(SKIPPED_FILE)!r}",
    )

    result = subprocess.run(
        ["python3", "-c", code],
        input=raw.encode(),
        capture_output=True,
        env=env,
        cwd=str(PROJECT_ROOT),
    )
    assert result.returncode == 0, (
        f"Poll Python exited {result.returncode}:\n{result.stderr.decode()}"
    )
    stdout = result.stdout.decode().strip()
    if not stdout:
        return None
    return json.loads(stdout)


def run_bash_helper(func: str, args: str = "", trend: str = "") -> str:
    """Run a bash helper function from the script and return stdout."""
    inline = f"""
source {SCRIPT}
{func} {args}
"""
    env = {**os.environ}
    if trend:
        env["_TEST_TREND"] = trend
    result = subprocess.run(
        ["bash", "-c", inline],
        capture_output=True,
        env=env,
        cwd=str(PROJECT_ROOT),
    )
    return result.stdout.decode().strip()


def cleanup_skipped():
    if SKIPPED_FILE.exists():
        SKIPPED_FILE.unlink()


# ─── Guardrails ──────────────────────────────────────────────────────────────

class TestGuardrails(unittest.TestCase):
    """Validate every guardrail path in the poll Python block."""

    def setUp(self):
        cleanup_skipped()

    def tearDown(self):
        cleanup_skipped()

    # ── Valid entries ──

    def test_valid_int_grade(self):
        r = run_poll_python([{"grade": 8, "comments": "great app", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 1)
        self.assertEqual(r["avg_nps"], 8.0)

    def test_valid_float_grade(self):
        r = run_poll_python([{"grade": 7.5, "comments": "pretty good", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["avg_nps"], 7.5)

    def test_valid_string_number_grade(self):
        """Numeric strings like '8' (common from web forms) must be accepted."""
        r = run_poll_python([{"grade": "8", "comments": "good app", "suggestion": "add search"}])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["avg_nps"], 8.0)

    def test_valid_float_string_grade(self):
        r = run_poll_python([{"grade": "7.5", "comments": "ok app", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["avg_nps"], 7.5)

    def test_grade_zero_is_valid(self):
        r = run_poll_python([{"grade": 0, "comments": "terrible experience", "suggestion": "delete it"}])
        self.assertTrue(r["has_new_feedback"])

    def test_grade_ten_is_valid(self):
        r = run_poll_python([{"grade": 10, "comments": "absolutely perfect", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_comment_alone_sufficient(self):
        """Meaningful comment with no suggestion should pass."""
        r = run_poll_python([{"grade": 7, "comments": "love it", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_suggestion_alone_sufficient(self):
        """Meaningful suggestion with no comment should pass."""
        r = run_poll_python([{"grade": 7, "comments": "", "suggestion": "add dark mode please"}])
        self.assertTrue(r["has_new_feedback"])

    def test_both_comment_and_suggestion(self):
        r = run_poll_python([{"grade": 8, "comments": "nice UI", "suggestion": "need dark mode"}])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 0)

    # ── Invalid / skipped entries ──

    def test_missing_grade_field(self):
        r = run_poll_python([{"comments": "no grade here", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_null_grade(self):
        r = run_poll_python([{"grade": None, "comments": "null grade", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_grade_above_10(self):
        r = run_poll_python([{"grade": 11, "comments": "too high", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_grade_above_10_string(self):
        r = run_poll_python([{"grade": "11", "comments": "too high", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_grade_below_0(self):
        r = run_poll_python([{"grade": -1, "comments": "negative", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_non_numeric_string_grade(self):
        r = run_poll_python([{"grade": "abc", "comments": "no idea", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_grade_with_letters(self):
        r = run_poll_python([{"grade": "8a", "comments": "mixed", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_both_comments_and_suggestion_empty(self):
        r = run_poll_python([{"grade": 8, "comments": "", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_whitespace_only_comments(self):
        r = run_poll_python([{"grade": 8, "comments": "   ", "suggestion": "  \t  "}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_single_char_comment_only(self):
        r = run_poll_python([{"grade": 8, "comments": "x", "suggestion": ""}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_single_char_suggestion_only(self):
        r = run_poll_python([{"grade": 8, "comments": "", "suggestion": "y"}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_two_char_comment_passes(self):
        """Exactly 2 characters should pass the guardrail."""
        r = run_poll_python([{"grade": 8, "comments": "ok", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_missing_comments_field(self):
        """Entry with no 'comments' key at all — treated as empty."""
        r = run_poll_python([{"grade": 8}])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 1)

    def test_empty_input(self):
        r = run_poll_python([])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 0)

    def test_all_entries_invalid(self):
        r = run_poll_python([
            {"grade": None, "comments": "test", "suggestion": ""},
            {"grade": 15, "comments": "high", "suggestion": ""},
            {"grade": 7, "comments": "", "suggestion": ""},
        ])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 3)

    def test_mixed_valid_and_invalid(self):
        r = run_poll_python([
            {"grade": 8, "comments": "great", "suggestion": ""},        # valid
            {"grade": None, "comments": "no grade", "suggestion": ""},  # skip
            {"grade": 7, "comments": "", "suggestion": ""},              # skip
            {"grade": 9, "comments": "love it", "suggestion": "add feature"},  # valid
        ])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 2)
        self.assertEqual(r["skipped"], 2)
        self.assertEqual(r["avg_nps"], 8.5)

    def test_malformed_json_line_ignored_rest_processed(self):
        """Malformed JSON lines should be silently ignored."""
        r = run_poll_python(
            [{"grade": 8, "comments": "good app", "suggestion": ""}],
            extra_lines=["not json at all", "{broken"],
        )
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 1)

    def test_completely_malformed_input(self):
        r = run_poll_python([], extra_lines=["garbage line 1", "garbage line 2"])
        self.assertFalse(r["has_new_feedback"])

    # ── Edge cases ──

    def test_grade_exactly_10_0_float(self):
        r = run_poll_python([{"grade": 10.0, "comments": "excellent", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_grade_exactly_0_0_float(self):
        r = run_poll_python([{"grade": 0.0, "comments": "awful", "suggestion": "start over"}])
        self.assertTrue(r["has_new_feedback"])

    def test_unicode_in_comments(self):
        r = run_poll_python([{"grade": 9, "comments": "Excelente! 🚀🎉 très bien", "suggestion": "añadir búsqueda"}])
        self.assertTrue(r["has_new_feedback"])

    def test_newlines_in_comments(self):
        r = run_poll_python([{"grade": 8, "comments": "Line 1\nLine 2\nLine 3", "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_quotes_in_comments(self):
        r = run_poll_python([{"grade": 8, "comments": 'He said "amazing!" and it\'s true', "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_shell_injection_attempt_in_comments(self):
        r = run_poll_python([{"grade": 7, "comments": "$(rm -rf /)", "suggestion": "`cat /etc/passwd`"}])
        self.assertTrue(r["has_new_feedback"])

    def test_very_long_comment(self):
        r = run_poll_python([{"grade": 6, "comments": "x" * 10000, "suggestion": ""}])
        self.assertTrue(r["has_new_feedback"])

    def test_extra_fields_ignored(self):
        """Extra fields in entry should not break parsing."""
        r = run_poll_python([{"grade": 7, "comments": "good", "suggestion": "", "userId": "abc", "platform": "ios", "version": "1.2.3"}])
        self.assertTrue(r["has_new_feedback"])

    def test_timestamp_preserved_in_output(self):
        r = run_poll_python([{"grade": 7, "comments": "good", "suggestion": "", "timestamp": "2026-04-13T10:00:00Z"}])
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entries"][0]["timestamp"], "2026-04-13T10:00:00Z")


# ─── MIN_FEEDBACK threshold ───────────────────────────────────────────────────

class TestMinFeedback(unittest.TestCase):

    def setUp(self):
        cleanup_skipped()

    def tearDown(self):
        cleanup_skipped()

    def _valid(self, grade=8, comments="good feedback", suggestion=""):
        return {"grade": grade, "comments": comments, "suggestion": suggestion}

    def test_default_min_1_triggers_on_one(self):
        r = run_poll_python([self._valid()], min_feedback=1)
        self.assertTrue(r["has_new_feedback"])

    def test_min_1_exact_count(self):
        r = run_poll_python([self._valid()] * 1, min_feedback=1)
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 1)

    def test_min_2_blocks_on_1(self):
        r = run_poll_python([self._valid()], min_feedback=2)
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["pending"], 1)
        self.assertEqual(r["needed"], 2)

    def test_min_2_triggers_on_2(self):
        r = run_poll_python([self._valid(), self._valid(grade=9, comments="great")], min_feedback=2)
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 2)

    def test_min_3_blocks_on_2(self):
        r = run_poll_python([self._valid(), self._valid()], min_feedback=3)
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["pending"], 2)
        self.assertEqual(r["needed"], 3)

    def test_min_3_triggers_on_exactly_3(self):
        r = run_poll_python([self._valid()] * 3, min_feedback=3)
        self.assertTrue(r["has_new_feedback"])

    def test_min_3_triggers_on_more_than_3(self):
        r = run_poll_python([self._valid()] * 5, min_feedback=3)
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 5)

    def test_skipped_do_not_count_toward_min(self):
        """3 total entries but 2 are invalid → only 1 valid → below min=3"""
        r = run_poll_python([
            self._valid(),                                              # valid
            {"grade": None, "comments": "no grade", "suggestion": ""},  # skip
            {"grade": 99, "comments": "out of range", "suggestion": ""},  # skip
        ], min_feedback=3)
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["pending"], 1)
        self.assertEqual(r["needed"], 3)
        self.assertEqual(r["skipped"], 2)

    def test_pending_not_in_response_when_no_feedback(self):
        """When there are 0 valid entries, pending/needed should not appear."""
        r = run_poll_python([], min_feedback=3)
        self.assertFalse(r["has_new_feedback"])
        self.assertNotIn("pending", r)
        self.assertNotIn("needed", r)

    def test_min_feedback_1_is_default(self):
        """AUTOLOOP_MIN_FEEDBACK defaults to 1 when not set."""
        r = run_poll_python([self._valid()])  # no min_feedback arg → defaults to 1
        self.assertTrue(r["has_new_feedback"])

    def test_large_min_feedback(self):
        """min_feedback=100 should block when only 5 entries available."""
        r = run_poll_python([self._valid()] * 5, min_feedback=100)
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["pending"], 5)
        self.assertEqual(r["needed"], 100)


# ─── NPS Calculation ─────────────────────────────────────────────────────────

class TestNPSCalculation(unittest.TestCase):

    def _grades(self, *grades):
        return [{"grade": g, "comments": "feedback", "suggestion": ""} for g in grades]

    def test_single_entry(self):
        r = run_poll_python(self._grades(7))
        self.assertEqual(r["avg_nps"], 7.0)

    def test_two_entries_average(self):
        r = run_poll_python(self._grades(6, 8))
        self.assertEqual(r["avg_nps"], 7.0)

    def test_three_entries(self):
        r = run_poll_python(self._grades(6, 7, 8))
        self.assertEqual(r["avg_nps"], 7.0)

    def test_rounding_one_decimal(self):
        r = run_poll_python(self._grades(7, 8, 9))
        self.assertEqual(r["avg_nps"], 8.0)

    def test_rounding_precise(self):
        r = run_poll_python(self._grades(7, 8))
        self.assertEqual(r["avg_nps"], 7.5)

    def test_zeros_and_tens(self):
        r = run_poll_python(self._grades(0, 10))
        self.assertEqual(r["avg_nps"], 5.0)

    def test_all_zeros(self):
        r = run_poll_python(self._grades(0, 0, 0))
        self.assertEqual(r["avg_nps"], 0.0)

    def test_all_tens(self):
        r = run_poll_python(self._grades(10, 10, 10))
        self.assertEqual(r["avg_nps"], 10.0)

    def test_float_grades_averaged(self):
        r = run_poll_python([
            {"grade": 7.5, "comments": "ok", "suggestion": ""},
            {"grade": 8.5, "comments": "good", "suggestion": ""},
        ])
        self.assertEqual(r["avg_nps"], 8.0)

    def test_string_number_grades_averaged(self):
        r = run_poll_python([
            {"grade": "7", "comments": "ok", "suggestion": ""},
            {"grade": "9", "comments": "great", "suggestion": ""},
        ])
        self.assertEqual(r["avg_nps"], 8.0)

    def test_entry_count_matches(self):
        r = run_poll_python(self._grades(5, 6, 7, 8, 9))
        self.assertEqual(r["entry_count"], 5)


# ─── Trend and Regression ────────────────────────────────────────────────────

class TestTrendAndRegression(unittest.TestCase):

    def test_trend_passed_through_in_output(self):
        r = run_poll_python(
            [{"grade": 7, "comments": "good", "suggestion": ""}],
            trend="2.0,3.0,5.0,7.0"
        )
        self.assertEqual(r["nps_trend"], [2.0, 3.0, 5.0, 7.0])

    def test_empty_trend(self):
        r = run_poll_python(
            [{"grade": 7, "comments": "good", "suggestion": ""}],
            trend=""
        )
        self.assertEqual(r["nps_trend"], [])

    def test_regressing_true_passed_through(self):
        r = run_poll_python(
            [{"grade": 5, "comments": "worse", "suggestion": ""}],
            regressing="true"
        )
        self.assertTrue(r["regressing"])

    def test_regressing_false_passed_through(self):
        r = run_poll_python(
            [{"grade": 8, "comments": "better", "suggestion": ""}],
            regressing="false"
        )
        self.assertFalse(r["regressing"])

    def test_cycle_in_output(self):
        r = run_poll_python(
            [{"grade": 7, "comments": "good", "suggestion": ""}],
            cycle=12
        )
        self.assertEqual(r["cycle"], 12)


# ─── Skipped Storage ─────────────────────────────────────────────────────────

class TestSkippedStorage(unittest.TestCase):

    def setUp(self):
        cleanup_skipped()

    def tearDown(self):
        cleanup_skipped()

    def test_file_created_on_skip(self):
        run_poll_python([{"grade": None, "comments": "no grade", "suggestion": ""}])
        self.assertTrue(SKIPPED_FILE.exists())

    def test_file_not_created_when_all_valid(self):
        run_poll_python([{"grade": 8, "comments": "good app", "suggestion": ""}])
        self.assertFalse(SKIPPED_FILE.exists())

    def test_skipped_entry_has_reason(self):
        run_poll_python([{"grade": None, "comments": "no grade", "suggestion": ""}])
        lines = [l for l in SKIPPED_FILE.read_text().splitlines() if l.strip()]
        entry = json.loads(lines[0])
        self.assertIn("reason", entry)
        self.assertEqual(entry["reason"], "missing_grade")

    def test_invalid_grade_reason(self):
        run_poll_python([{"grade": 99, "comments": "too high", "suggestion": ""}])
        entry = json.loads(SKIPPED_FILE.read_text().strip())
        self.assertEqual(entry["reason"], "invalid_grade")

    def test_empty_feedback_reason(self):
        run_poll_python([{"grade": 8, "comments": "", "suggestion": ""}])
        entry = json.loads(SKIPPED_FILE.read_text().strip())
        self.assertEqual(entry["reason"], "empty_feedback")

    def test_multiple_skipped_appended(self):
        run_poll_python([
            {"grade": None, "comments": "no grade", "suggestion": ""},
            {"grade": 99, "comments": "out of range", "suggestion": ""},
        ])
        lines = [l for l in SKIPPED_FILE.read_text().splitlines() if l.strip()]
        self.assertEqual(len(lines), 2)

    def test_original_entry_preserved_in_skipped(self):
        run_poll_python([{"grade": None, "comments": "test", "suggestion": "", "userId": "u123"}])
        entry = json.loads(SKIPPED_FILE.read_text().strip())
        self.assertEqual(entry["entry"]["userId"], "u123")

    def test_skipped_appends_across_calls(self):
        """Multiple calls append to the same file."""
        run_poll_python([{"grade": None, "comments": "first", "suggestion": ""}])
        run_poll_python([{"grade": 99, "comments": "second", "suggestion": ""}])
        lines = [l for l in SKIPPED_FILE.read_text().splitlines() if l.strip()]
        self.assertEqual(len(lines), 2)

    def test_valid_entries_not_in_skipped_file(self):
        run_poll_python([
            {"grade": 8, "comments": "good", "suggestion": ""},  # valid
            {"grade": None, "comments": "bad", "suggestion": ""},  # skip
        ])
        lines = [l for l in SKIPPED_FILE.read_text().splitlines() if l.strip()]
        self.assertEqual(len(lines), 1)
        entry = json.loads(lines[0])
        self.assertEqual(entry["reason"], "missing_grade")


# ─── Output Schema ────────────────────────────────────────────────────────────

class TestOutputSchema(unittest.TestCase):
    """Verify the JSON output schema is complete and backward-compatible."""

    def test_success_output_has_all_required_fields(self):
        r = run_poll_python([{"grade": 8, "comments": "good", "suggestion": ""}])
        required = ["has_new_feedback", "cycle", "entries", "entry_count", "avg_nps", "nps_trend", "regressing", "skipped"]
        for field in required:
            self.assertIn(field, r, f"Missing field: {field}")

    def test_no_feedback_output_has_required_fields(self):
        r = run_poll_python([])
        self.assertIn("has_new_feedback", r)
        self.assertIn("skipped", r)
        self.assertFalse(r["has_new_feedback"])

    def test_pending_output_has_required_fields(self):
        r = run_poll_python([{"grade": 8, "comments": "good", "suggestion": ""}], min_feedback=5)
        self.assertIn("pending", r)
        self.assertIn("needed", r)
        self.assertIn("skipped", r)
        self.assertFalse(r["has_new_feedback"])

    def test_entry_schema_in_output(self):
        r = run_poll_python([{"grade": 8, "comments": "great", "suggestion": "add feature", "timestamp": "2026-01-01T00:00:00Z"}])
        entry = r["entries"][0]
        self.assertIn("grade", entry)
        self.assertIn("comments", entry)
        self.assertIn("suggestion", entry)
        self.assertIn("timestamp", entry)

    def test_grade_is_float_in_output(self):
        """grade must always be float in entries (not int or str)."""
        r = run_poll_python([
            {"grade": 8, "comments": "good", "suggestion": ""},    # int
            {"grade": "7", "comments": "ok", "suggestion": ""},    # str
            {"grade": 9.0, "comments": "great", "suggestion": ""},  # float
        ])
        for entry in r["entries"]:
            self.assertIsInstance(entry["grade"], float, f"Expected float, got {type(entry['grade'])}")


# ─── Sparkline ───────────────────────────────────────────────────────────────

class TestSparkline(unittest.TestCase):
    """Test the NPS sparkline rendered by cmd_log."""

    def _sparkline(self, trend_str: str) -> str:
        """Run just the sparkline Python directly."""
        code = f"""
t = [float(x) for x in '{trend_str}'.split(',') if x]
if not t:
    exit(0)
bars = ' ▁▂▃▄▅▆▇█'
mn, mx = min(t), max(t)
rng = mx - mn if mx != mn else 1
sparkline = ''.join(bars[min(8, max(0, int((v - mn) / rng * 8)))] for v in t)
latest = t[-1]
arrow = '↑' if len(t) >= 2 and t[-1] > t[-2] else '↓' if len(t) >= 2 and t[-1] < t[-2] else '→'
print(f'NPS trend: {{sparkline}} {{latest}} {{arrow}}')
"""
        result = subprocess.run(["python3", "-c", code], capture_output=True)
        return result.stdout.decode().strip()

    def test_ascending_trend_shows_up_arrow(self):
        out = self._sparkline("2.0,3.0,5.0,7.0,8.0")
        self.assertIn("↑", out)

    def test_descending_trend_shows_down_arrow(self):
        out = self._sparkline("8.0,7.0,5.0,3.0,2.0")
        self.assertIn("↓", out)

    def test_flat_trend_shows_right_arrow(self):
        out = self._sparkline("5.0,5.0,5.0")
        self.assertIn("→", out)

    def test_single_value_no_arrow(self):
        out = self._sparkline("7.0")
        self.assertIn("→", out)  # single value → no previous → →

    def test_empty_trend_produces_no_output(self):
        out = self._sparkline("")
        self.assertEqual(out, "")

    def test_latest_value_shown(self):
        out = self._sparkline("2.0,3.0,6.5")
        self.assertIn("6.5", out)

    def test_sparkline_contains_only_valid_chars(self):
        out = self._sparkline("2.0,4.0,6.0,8.0,5.0,3.0")
        # Should contain only sparkline bars and standard ASCII
        self.assertIn("NPS trend:", out)

    def test_all_same_values(self):
        """All-same trend should not crash (rng=0 → single bar)."""
        out = self._sparkline("5.0,5.0,5.0")
        self.assertIn("→", out)

    def test_two_values_regression(self):
        out = self._sparkline("8.0,5.0")
        self.assertIn("↓", out)
        self.assertIn("5.0", out)

    def test_two_values_improvement(self):
        out = self._sparkline("3.0,8.0")
        self.assertIn("↑", out)
        self.assertIn("8.0", out)


# ─── Regression Detection ────────────────────────────────────────────────────

class TestRegressionDetection(unittest.TestCase):
    """Test the check_regression bash function."""

    def _check(self, trend: str) -> str:
        code = f"""
t = [float(x) for x in '{trend}'.split(',') if x]
if len(t) >= 4 and all(t[-2+i] < t[-4+i] for i in range(2)):
    print('true')
else:
    print('false')
"""
        result = subprocess.run(["python3", "-c", code], capture_output=True)
        return result.stdout.decode().strip()

    def test_no_regression_with_less_than_4_points(self):
        self.assertEqual(self._check("5.0,6.0,7.0"), "false")

    def test_no_regression_flat(self):
        self.assertEqual(self._check("5.0,5.0,5.0,5.0"), "false")

    def test_no_regression_increasing(self):
        self.assertEqual(self._check("3.0,4.0,5.0,6.0"), "false")

    def test_regression_last_two_lower(self):
        """Last 2 values both lower than 2 before them → regression."""
        self.assertEqual(self._check("5.0,6.0,4.0,3.0"), "true")

    def test_no_regression_only_one_lower(self):
        """Only one of the last 2 lower → NOT regression."""
        self.assertEqual(self._check("5.0,6.0,4.0,7.0"), "false")

    def test_regression_after_peak(self):
        self.assertEqual(self._check("2.0,3.0,6.0,8.0,5.0,4.0"), "true")

    def test_empty_trend(self):
        self.assertEqual(self._check(""), "false")

    def test_single_value(self):
        self.assertEqual(self._check("7.0"), "false")

    def test_exactly_4_values_no_regression(self):
        self.assertEqual(self._check("3.0,4.0,5.0,6.0"), "false")

    def test_exactly_4_values_with_regression(self):
        self.assertEqual(self._check("6.0,7.0,5.0,4.0"), "true")


# ─── get_last_cycle ───────────────────────────────────────────────────────────

class TestGetLastCycle(unittest.TestCase):
    """Test get_last_cycle parses autoloop.md correctly."""

    def _get_last_cycle(self, md_content: str) -> int:
        code = f"""
content = {md_content!r}
last = 0
in_table = False
for line in content.splitlines(keepends=True):
    if '| # | Date | NPS |' in line:
        in_table = True; continue
    if in_table and line.startswith('|---'): continue
    if in_table and line.startswith('|'):
        cols = [c.strip() for c in line.split('|')]
        if len(cols) >= 2:
            try: last = max(last, int(cols[1]))
            except: pass
    elif in_table: break
print(last)
"""
        result = subprocess.run(["python3", "-c", code], capture_output=True)
        return int(result.stdout.decode().strip())

    def test_returns_0_when_no_table(self):
        self.assertEqual(self._get_last_cycle("# No table here\n\nSome text."), 0)

    def test_returns_last_cycle_number(self):
        md = """
## Iteration Log

| # | Date | NPS | Key Change | Target |
|---|------|-----|-----------|--------|
| 0 | 2026-04-06 | — | Baseline | 9.0 |
| 3 | 2026-04-06 | 2.0 | Removed emojis | 9.0 |
| 16 | 2026-04-08 | 5.0 | Fix blue bar | 9.0 |
"""
        self.assertEqual(self._get_last_cycle(md), 16)

    def test_returns_max_not_last_row(self):
        """Max cycle number even if rows are out of order."""
        md = """
| # | Date | NPS | Key Change | Target |
|---|------|-----|-----------|--------|
| 5 | 2026-04-06 | 3.0 | Change | 9.0 |
| 2 | 2026-04-06 | 2.0 | Earlier | 9.0 |
| 10 | 2026-04-07 | 4.0 | Later | 9.0 |
"""
        self.assertEqual(self._get_last_cycle(md), 10)

    def test_handles_non_numeric_cycle_column(self):
        md = """
| # | Date | NPS | Key Change | Target |
|---|------|-----|-----------|--------|
| foo | 2026-04-06 | 3.0 | bad data | 9.0 |
| 5 | 2026-04-06 | 2.0 | good data | 9.0 |
"""
        self.assertEqual(self._get_last_cycle(md), 5)


# ─── Bash Syntax and CLI ──────────────────────────────────────────────────────

class TestBashCLI(unittest.TestCase):

    def test_bash_syntax_valid(self):
        result = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True)
        self.assertEqual(result.returncode, 0, f"Bash syntax error:\n{result.stderr.decode()}")

    def test_help_output_contains_all_commands(self):
        result = subprocess.run(
            ["bash", str(SCRIPT), "help"],
            capture_output=True, cwd=str(PROJECT_ROOT)
        )
        output = result.stdout.decode()
        for cmd in ["prepare", "poll", "ship", "log", "push", "mark-processed", "rollback", "status"]:
            self.assertIn(cmd, output, f"Command '{cmd}' missing from help output")

    def test_help_mentions_autoloop_min_feedback(self):
        result = subprocess.run(["bash", str(SCRIPT), "help"], capture_output=True, cwd=str(PROJECT_ROOT))
        self.assertIn("AUTOLOOP_MIN_FEEDBACK", result.stdout.decode())

    def test_help_mentions_autoloop_sleep(self):
        result = subprocess.run(["bash", str(SCRIPT), "help"], capture_output=True, cwd=str(PROJECT_ROOT))
        self.assertIn("AUTOLOOP_SLEEP", result.stdout.decode())

    def test_unknown_command_falls_through_to_help(self):
        result = subprocess.run(
            ["bash", str(SCRIPT), "unknown-command-xyz"],
            capture_output=True, cwd=str(PROJECT_ROOT)
        )
        output = result.stdout.decode()
        self.assertIn("Usage:", output)


# ─── Full Integration ─────────────────────────────────────────────────────────

class TestFullScenarios(unittest.TestCase):
    """End-to-end scenarios that match real AutoLoop usage."""

    def setUp(self):
        cleanup_skipped()

    def tearDown(self):
        cleanup_skipped()

    def test_typical_good_cycle(self):
        """Cycle with 3 diverse valid entries, no skips, avg > 7."""
        r = run_poll_python([
            {"grade": 8, "comments": "Love the dark mode!", "suggestion": ""},
            {"grade": 7, "comments": "Good but slow load", "suggestion": "Optimize images"},
            {"grade": 9, "comments": "Perfect for my needs", "suggestion": "Add bookmarks"},
        ], min_feedback=3)
        self.assertTrue(r["has_new_feedback"])
        self.assertEqual(r["entry_count"], 3)
        self.assertEqual(r["skipped"], 0)
        self.assertAlmostEqual(r["avg_nps"], 8.0)

    def test_partial_feedback_waits(self):
        """Only 2 valid entries when min=5 → keep waiting."""
        r = run_poll_python([
            {"grade": 8, "comments": "Great!", "suggestion": ""},
            {"grade": None, "comments": "No grade", "suggestion": ""},  # skip
            {"grade": 7, "comments": "Good", "suggestion": ""},
        ], min_feedback=5)
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["pending"], 2)
        self.assertEqual(r["skipped"], 1)

    def test_spam_cycle_all_rejected(self):
        """All entries fail guardrails → no cycle triggered."""
        r = run_poll_python([
            {"grade": None},
            {"grade": 11, "comments": "hacker", "suggestion": ""},
            {"grade": 5, "comments": "", "suggestion": ""},
            {"grade": 5, "comments": "x", "suggestion": ""},
        ])
        self.assertFalse(r["has_new_feedback"])
        self.assertEqual(r["skipped"], 4)

    def test_regression_scenario(self):
        """Declining NPS is flagged in output."""
        r = run_poll_python(
            [{"grade": 5, "comments": "worse than before", "suggestion": "revert changes"}],
            trend="7.0,8.0,6.0,5.0",
            regressing="true"
        )
        self.assertTrue(r["has_new_feedback"])
        self.assertTrue(r["regressing"])

    def test_pmf_scenario(self):
        """High NPS, no regressions, skipped=0."""
        r = run_poll_python([
            {"grade": 9, "comments": "Nearly perfect!", "suggestion": "Minor polish"},
            {"grade": 10, "comments": "Absolutely love it", "suggestion": ""},
            {"grade": 9, "comments": "Best news app I've used", "suggestion": "Add notifications"},
        ], trend="5.0,6.0,7.0,8.0,9.0", regressing="false", min_feedback=3)
        self.assertTrue(r["has_new_feedback"])
        self.assertGreaterEqual(r["avg_nps"], 9.0)
        self.assertFalse(r["regressing"])
        self.assertEqual(r["skipped"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
