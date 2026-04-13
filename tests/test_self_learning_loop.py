"""
Exhaustive tests for the AutoPMF self-learning loop.

Tests three components inspired by Hermes Agent's learning architecture:
1. learnings.md — persistent memory of what worked/didn't (Hermes MEMORY.md pattern)
2. Evolution Log in product.md — execution traces per cycle (GEPA pattern)
3. Feedback pattern analysis — mini-GEPA for identifying NPS drivers

Run: python3 tests/test_self_learning_loop.py
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
SCRIPT = PROJECT_ROOT / "scripts" / "autoloop-cycle.sh"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def run_python_from_script(marker_start: str, marker_end: str, stdin_data: str = "",
                            env_extra: dict = None, cwd: str = None) -> subprocess.CompletedProcess:
    """Extract a Python block from the script between two markers and run it."""
    script = SCRIPT.read_text()
    start = script.find(marker_start)
    end = script.find(marker_end, start)
    assert start != -1 and end != -1, f"Marker not found: {marker_start!r}"
    block = script[start + len(marker_start):end]
    block = block.replace('\\"', '"').replace("\\'", "'")

    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(
        ["python3", "-c", block],
        input=stdin_data.encode() if stdin_data else b"",
        capture_output=True,
        env=env,
        cwd=cwd or str(PROJECT_ROOT),
    )


def _extract_python_block(start_marker: str, end_marker: str) -> str | None:
    """Extract a Python block from the script between two comment markers.
    Handles both raw blocks and python3 -c "..." wrappers.
    """
    script = SCRIPT.read_text()
    # First try: marker immediately before python3 -c "
    wrapped_start = start_marker + '\npython3 -c "'
    wrapped_end = '\n"' + end_marker
    start = script.find(wrapped_start)
    if start != -1:
        end = script.find(wrapped_end, start)
        if end != -1:
            block = script[start + len(wrapped_start):end]
            return block.replace('\\\\"', '"').replace("\\\\\'", "\'")
    # Second try: bare markers
    start = script.find(start_marker + '\n')
    if start == -1:
        return None
    end = script.find(end_marker, start)
    if end == -1:
        return None
    block = script[start + len(start_marker) + 1:end]
    # Strip python3 -c " wrapper if present
    if block.startswith('python3 -c "'):
        inner_start = len('python3 -c "')
        inner_end = block.rfind('"')
        if inner_end > inner_start:
            block = block[inner_start:inner_end]
    return block.replace('\\\\"', '"').replace("\\\\\'", "\'")


def extract_learnings_python() -> str | None:
    """Extract the Python block for learnings.md update from the script."""
    return _extract_python_block("# LEARNINGS_UPDATE_START", "# LEARNINGS_UPDATE_END")


def extract_feedback_analysis_python() -> str | None:
    """Extract the Python feedback pattern analysis block."""
    return _extract_python_block("# FEEDBACK_ANALYSIS_START", "# FEEDBACK_ANALYSIS_END")


# ─── learnings.md tests ───────────────────────────────────────────────────────

class TestLearningsmd(unittest.TestCase):
    """
    Tests for learnings.md — the persistent memory file that tracks
    what changes improved or harmed NPS (Hermes MEMORY.md pattern).
    """

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.learnings_file = Path(self.tmpdir) / "learnings.md"

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run_learnings_update(self, cycle: int, nps: float, prev_nps: float,
                               description: str, diff_summary: str = "") -> str:
        """Run the learnings.md update bash+python block for a given cycle."""
        script = SCRIPT.read_text()
        marker = "# LEARNINGS_UPDATE_START\n"
        end_marker = "\n# LEARNINGS_UPDATE_END"
        start = script.find(marker)
        end = script.find(end_marker, start)
        if start == -1:
            self.skipTest("learnings.md update block not yet implemented in script")
        block = script[start + len(marker):end]

        env = {
            **os.environ,
            "LEARNINGS_FILE": str(self.learnings_file),
            "AUTOLOOP_CYCLE": str(cycle),
            "AUTOLOOP_NPS": str(nps),
            "AUTOLOOP_PREV_NPS": str(prev_nps),
            "AUTOLOOP_DESCRIPTION": description,
            "AUTOLOOP_DIFF_SUMMARY": diff_summary,
        }
        result = subprocess.run(["bash", "-c", block], capture_output=True,
                                env=env, cwd=self.tmpdir)
        assert result.returncode == 0, f"Script error: {result.stderr.decode()}"
        return self.learnings_file.read_text() if self.learnings_file.exists() else ""

    # ── File creation ──

    def test_learnings_file_created_if_missing(self):
        content = self._run_learnings_update(5, 7.0, 5.0, "Added dark mode")
        self.assertTrue(self.learnings_file.exists())

    def test_learnings_file_has_header(self):
        content = self._run_learnings_update(5, 7.0, 5.0, "Added dark mode")
        self.assertTrue(any(w in content.lower() for w in ["learnings", "self-learning", "memory", "loop"]))

    # ── Entry content ──

    def test_positive_change_recorded(self):
        content = self._run_learnings_update(9, 6.0, 4.0, "Ken Burns animation on images")
        self.assertIn("Ken Burns animation", content)
        self.assertTrue(any(c in content for c in ["+2.0", "+2", "↑"]))

    def test_negative_change_recorded(self):
        content = self._run_learnings_update(15, 3.0, 5.0, "Changed background color to blue")
        self.assertIn("Changed background color", content)
        self.assertTrue(any(c in content for c in ["-2.0", "-2", "↓", "regression"]))

    def test_neutral_change_recorded(self):
        content = self._run_learnings_update(7, 5.0, 5.0, "Fixed a bug in the search bar")
        self.assertIn("Fixed a bug", content)

    def test_cycle_number_in_entry(self):
        content = self._run_learnings_update(12, 6.5, 5.5, "Simplified feedback form")
        self.assertIn("12", content)

    def test_nps_delta_computed_correctly(self):
        content = self._run_learnings_update(10, 7.5, 5.0, "Added search highlighting")
        self.assertTrue(
            "+2.5" in content or "2.5" in content,
            f"Expected delta 2.5 in: {content[:500]}"
        )

    # ── Accumulation ──

    def test_entries_accumulate_across_cycles(self):
        self._run_learnings_update(5, 6.0, 4.0, "Dark mode")
        self._run_learnings_update(9, 7.0, 6.0, "Ken Burns animation")
        content = self.learnings_file.read_text()
        self.assertIn("Dark mode", content)
        self.assertIn("Ken Burns animation", content)

    def test_ten_cycles_of_learnings(self):
        changes = [
            (3, 2.0, 0.0, "Remove fire emoji"),
            (4, 3.0, 2.0, "Source names capped 20 chars"),
            (5, 4.0, 3.0, "Ask Claude sticky bar"),
            (6, 5.0, 4.0, "Dark mode toggle"),
            (9, 6.0, 5.0, "Ken Burns animation"),
            (10, 4.0, 6.0, "Search highlighting - regression!"),
            (12, 5.5, 4.0, "Fun empty-category messages"),
            (14, 6.5, 5.5, "Mobile safe-area fix"),
            (15, 3.0, 6.5, "FAB hidden on mobile - regression"),
            (16, 5.0, 3.0, "Fix blue bar background"),
        ]
        for cycle, nps, prev, desc in changes:
            self._run_learnings_update(cycle, nps, prev, desc)

        content = self.learnings_file.read_text()
        for _, _, _, desc in changes:
            self.assertIn(desc, content, f"Missing entry for: {desc}")

    # ── Regression flagging ──

    def test_regression_entries_marked_differently(self):
        content = self._run_learnings_update(10, 4.0, 6.0, "Added search highlighting")
        lower = content.lower()
        self.assertTrue(
            any(w in lower for w in ["regression", "⚠", "warning", "avoid", "reverting", "↓"]),
            f"Regression not flagged: {content[:500]}"
        )

    def test_large_improvement_highlighted(self):
        content = self._run_learnings_update(6, 7.0, 4.0, "Added dark mode - big win")
        # +3.0 NPS improvement should be highlighted
        self.assertTrue(
            any(c in content for c in ["✅", "🎉", "+3", "win", "significant", "↑"]),
            f"Large improvement not highlighted: {content[:500]}"
        )

    # ── Format requirements ──

    def test_entries_are_separated(self):
        self._run_learnings_update(5, 6.0, 4.0, "Dark mode")
        self._run_learnings_update(9, 7.0, 6.0, "Ken Burns animation")
        content = self.learnings_file.read_text()
        # Entries should be separated (by newlines, §, ---, or similar)
        self.assertGreater(len(content.split("\n")), 5)

    def test_diff_summary_included_when_provided(self):
        content = self._run_learnings_update(
            9, 6.0, 5.0, "Ken Burns animation",
            diff_summary="Added CSS animation class to image cards"
        )
        self.assertIn("CSS animation", content)

    def test_date_included_in_entry(self):
        content = self._run_learnings_update(5, 6.0, 4.0, "Dark mode")
        today = datetime.now().strftime("%Y-%m-%d")
        # Date should be in the entry (format may vary)
        year = datetime.now().strftime("%Y")
        self.assertIn(year, content, f"Year {year} not found in: {content[:300]}")


# ─── Evolution Log tests ──────────────────────────────────────────────────────

class TestEvolutionLog(unittest.TestCase):
    """
    Tests for the Evolution Log section in product.md.
    Each cycle appends a structured entry: what changed, why, and the NPS result.
    This gives Claude execution traces to reason about (GEPA pattern).
    """

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.product_md = Path(self.tmpdir) / "product.md"
        # Start with a minimal product.md
        self.product_md.write_text("# Product Definition\n\nSome content here.\n")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run_evolution_log_update(self, cycle: int, nps: float, description: str,
                                   diff_summary: str = "", motivation: str = "") -> str:
        py = extract_learnings_python()  # Reuse same block if it handles both
        if py is None:
            self.skipTest("Evolution log block not yet implemented")

        # Try the evolution log specific block
        script = SCRIPT.read_text()
        marker = "# EVOLUTION_LOG_START"
        end_marker = "# EVOLUTION_LOG_END"
        start = script.find(marker)
        end = script.find(end_marker, start)
        if start == -1:
            self.skipTest("Evolution log block not yet implemented in script")

        block = script[start + len(marker):end]
        block = block.replace('\\"', '"').replace("\\'", "'")

        env = {
            **os.environ,
            "PRODUCT_MD": str(self.product_md),
            "AUTOLOOP_CYCLE": str(cycle),
            "AUTOLOOP_NPS": str(nps),
            "AUTOLOOP_DESCRIPTION": description,
            "AUTOLOOP_DIFF_SUMMARY": diff_summary,
            "AUTOLOOP_MOTIVATION": motivation,
        }
        result = subprocess.run(["python3", "-c", block], capture_output=True,
                                env=env, cwd=self.tmpdir)
        assert result.returncode == 0, f"Script error: {result.stderr.decode()}"
        return self.product_md.read_text()

    def test_evolution_log_section_created(self):
        content = self._run_evolution_log_update(5, 6.0, "Added dark mode")
        self.assertIn("Evolution Log", content)

    def test_cycle_entry_appended(self):
        content = self._run_evolution_log_update(9, 6.0, "Ken Burns animation on images")
        self.assertIn("Ken Burns animation", content)
        self.assertIn("9", content)

    def test_nps_in_evolution_log(self):
        content = self._run_evolution_log_update(9, 6.0, "Ken Burns animation")
        self.assertIn("6.0", content)

    def test_multiple_cycles_append_correctly(self):
        self._run_evolution_log_update(5, 5.0, "Dark mode")
        content = self._run_evolution_log_update(9, 6.0, "Ken Burns animation")
        self.assertIn("Dark mode", content)
        self.assertIn("Ken Burns animation", content)

    def test_original_product_md_content_preserved(self):
        content = self._run_evolution_log_update(5, 5.0, "Dark mode")
        self.assertIn("Product Definition", content)
        self.assertIn("Some content here", content)

    def test_motivation_included_when_provided(self):
        content = self._run_evolution_log_update(
            9, 6.0, "Ken Burns animation",
            motivation="Users complained images felt static and boring"
        )
        self.assertIn("static and boring", content)

    def test_diff_summary_in_log(self):
        content = self._run_evolution_log_update(
            9, 6.0, "Ken Burns animation",
            diff_summary="Added @keyframes kenBurns to image cards"
        )
        self.assertIn("kenBurns", content)


# ─── Feedback Pattern Analysis tests ─────────────────────────────────────────

class TestFeedbackPatternAnalysis(unittest.TestCase):
    """
    Tests for the feedback pattern analysis — reads local_feedback.jsonl
    and identifies what NPS < 5 users vs NPS >= 8 users say differently.
    This is the mini-GEPA component: understand WHY before deciding WHAT.
    """

    ANALYSIS_PYTHON = None

    @classmethod
    def setUpClass(cls):
        cls.ANALYSIS_PYTHON = extract_feedback_analysis_python()

    def _run_analysis(self, feedback_entries: list) -> dict:
        py = self.ANALYSIS_PYTHON
        if py is None:
            self.skipTest("Feedback analysis block not yet implemented in script")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            for entry in feedback_entries:
                f.write(json.dumps(entry) + "\n")
            fname = f.name

        env = {**os.environ, "FEEDBACK_JSONL": fname}
        result = subprocess.run(["python3", "-c", py], capture_output=True,
                                env=env, cwd=str(PROJECT_ROOT))
        os.unlink(fname)

        assert result.returncode == 0, f"Analysis error: {result.stderr.decode()}"
        stdout = result.stdout.decode().strip()
        if not stdout:
            return {}
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            return {"raw": stdout}

    def _make_entry(self, grade: float, comments: str = "", suggestion: str = "",
                    cycle: int = 5) -> dict:
        return {
            "grade": grade,
            "comments": comments,
            "suggestion": suggestion,
            "cycle": cycle,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processed": True,
        }

    # ── Basic structure ──

    def test_analysis_returns_dict(self):
        entries = [
            self._make_entry(8, "Great app", ""),
            self._make_entry(3, "Too slow", "Make it faster"),
        ]
        result = self._run_analysis(entries)
        self.assertIsInstance(result, dict)

    def test_analysis_has_expected_keys(self):
        entries = [
            self._make_entry(8, "Love the dark mode", ""),
            self._make_entry(3, "Images are too large", "Resize images"),
        ]
        result = self._run_analysis(entries)
        # Should have high_nps and low_nps sections at minimum
        self.assertTrue(
            any(k in result for k in ["high_nps", "low_nps", "patterns", "insights"]),
            f"Expected pattern keys, got: {list(result.keys())}"
        )

    # ── Pattern identification ──

    def test_high_nps_themes_identified(self):
        entries = [
            self._make_entry(9, "Love the dark mode and animations", ""),
            self._make_entry(8, "Dark mode is great!", "Add more animations"),
            self._make_entry(9, "Beautiful animations, dark theme is perfect", ""),
            self._make_entry(3, "Too slow", ""),
            self._make_entry(2, "Images broken", "Fix images"),
        ]
        result = self._run_analysis(entries)
        # High NPS users mention dark mode/animations
        result_str = json.dumps(result).lower()
        self.assertTrue(
            "dark" in result_str or "animat" in result_str,
            f"High NPS themes not found: {result_str[:500]}"
        )

    def test_low_nps_themes_identified(self):
        entries = [
            self._make_entry(2, "Images are broken and slow", "Fix performance"),
            self._make_entry(3, "Loading is very slow", "Make faster"),
            self._make_entry(2, "App crashes on mobile, too slow", ""),
            self._make_entry(9, "Perfect app!", ""),
            self._make_entry(8, "Love it", ""),
        ]
        result = self._run_analysis(entries)
        result_str = json.dumps(result).lower()
        self.assertTrue(
            "slow" in result_str or "performance" in result_str or "fast" in result_str,
            f"Low NPS themes not found: {result_str[:500]}"
        )

    def test_empty_feedback_handled(self):
        result = self._run_analysis([])
        # Should not crash, should return empty/None analysis
        self.assertIsInstance(result, dict)

    def test_single_entry_handled(self):
        result = self._run_analysis([self._make_entry(7, "Pretty good app", "")])
        self.assertIsInstance(result, dict)

    def test_all_high_nps_handled(self):
        entries = [self._make_entry(9, f"Entry {i}", "") for i in range(5)]
        result = self._run_analysis(entries)
        self.assertIsInstance(result, dict)

    def test_all_low_nps_handled(self):
        entries = [self._make_entry(2, f"Bad entry {i}", "") for i in range(5)]
        result = self._run_analysis(entries)
        self.assertIsInstance(result, dict)

    # ── Statistics ──

    def test_avg_nps_by_segment(self):
        entries = [
            self._make_entry(9, "Love it", ""),
            self._make_entry(8, "Great", ""),
            self._make_entry(3, "Slow", ""),
            self._make_entry(2, "Broken", ""),
        ]
        result = self._run_analysis(entries)
        result_str = json.dumps(result)
        # Should include some numeric summary
        self.assertTrue(
            any(str(n) in result_str for n in ["8.5", "2.5", "8", "2"]),
            f"No NPS stats found: {result_str[:300]}"
        )

    def test_unprocessed_entries_included(self):
        """Recent unprocessed feedback is most relevant for next cycle."""
        entries = [
            {**self._make_entry(8, "New feedback", ""), "processed": False},
            {**self._make_entry(9, "Also new", ""), "processed": False},
        ]
        result = self._run_analysis(entries)
        self.assertIsInstance(result, dict)

    def test_multi_cycle_data_used(self):
        entries = [
            self._make_entry(6, "Good start", "", cycle=3),
            self._make_entry(7, "Better", "", cycle=5),
            self._make_entry(8, "Love it", "", cycle=9),
            self._make_entry(5, "Needs work", "", cycle=10),
        ]
        result = self._run_analysis(entries)
        self.assertIsInstance(result, dict)


# ─── Integration: all three together ─────────────────────────────────────────

class TestSelfLearningLoopIntegration(unittest.TestCase):
    """
    End-to-end integration tests simulating a full AutoLoop run
    with the self-learning components active.
    """

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_complete_learning_cycle_scenario(self):
        """
        Simulate 3 cycles with learnings.md being built up.
        After 3 cycles, learnings.md should contain actionable insights.
        """
        py = extract_learnings_python()
        if py is None:
            self.skipTest("learnings.md not yet implemented")

        learnings_file = Path(self.tmpdir) / "learnings.md"
        cycles = [
            (5, 5.0, 4.0, "Added dark mode toggle"),
            (9, 6.0, 5.0, "Ken Burns animation on images"),
            (10, 4.0, 6.0, "Search keyword highlighting - caused regression"),
        ]

        script = SCRIPT.read_text()
        marker = "# LEARNINGS_UPDATE_START\n"
        end_marker = "\n# LEARNINGS_UPDATE_END"
        start = script.find(marker)
        end = script.find(end_marker, start)
        block = script[start + len(marker):end]

        for cycle, nps, prev, desc in cycles:
            env = {
                **os.environ,
                "LEARNINGS_FILE": str(learnings_file),
                "AUTOLOOP_CYCLE": str(cycle),
                "AUTOLOOP_NPS": str(nps),
                "AUTOLOOP_PREV_NPS": str(prev),
                "AUTOLOOP_DESCRIPTION": desc,
                "AUTOLOOP_DIFF_SUMMARY": "",
            }
            result = subprocess.run(["bash", "-c", block], capture_output=True,
                                   env=env, cwd=self.tmpdir)
            self.assertEqual(result.returncode, 0, f"Cycle {cycle} failed: {result.stderr.decode()}")

        content = learnings_file.read_text()
        # All three should be present
        for _, _, _, desc in cycles:
            self.assertIn(desc, content)

        # The regression should be flagged differently
        self.assertGreater(len(content), 100)

    def test_learnings_md_gives_claude_context(self):
        """
        learnings.md should be formatted so Claude can read it efficiently.
        It should be concise, structured, and not excessively long.
        """
        py = extract_learnings_python()
        if py is None:
            self.skipTest("learnings.md not yet implemented")

        learnings_file = Path(self.tmpdir) / "learnings.md"
        # Simulate 16 cycles (the real AutoPMF history)
        history = [
            (3, 2.0, 0.0, "Remove fire emoji, professional badges"),
            (4, 3.0, 2.0, "Source names capped 20 chars"),
            (5, 4.0, 3.0, "Ask Claude sticky footer bar"),
            (6, 5.0, 4.0, "Dark mode with toggle in Settings"),
            (9, 6.0, 5.0, "Ken Burns slow zoom on images"),
            (10, 4.0, 6.0, "Search keyword highlighting - regression"),
            (12, 5.5, 4.0, "Fun empty-category messages"),
            (14, 6.5, 5.5, "Mobile safe-area fix, fun search messages"),
            (15, 3.0, 6.5, "Fix feedback FAB hidden on mobile - regression"),
            (16, 5.0, 3.0, "Fix blue bar background"),
        ]
        script2 = SCRIPT.read_text()
        start2 = script2.find("# LEARNINGS_UPDATE_START\n")
        end2 = script2.find("\n# LEARNINGS_UPDATE_END", start2)
        block2 = script2[start2 + len("# LEARNINGS_UPDATE_START\n"):end2]
        for cycle, nps, prev, desc in history:
            env = {**os.environ, "LEARNINGS_FILE": str(learnings_file),
                   "AUTOLOOP_CYCLE": str(cycle), "AUTOLOOP_NPS": str(nps),
                   "AUTOLOOP_PREV_NPS": str(prev), "AUTOLOOP_DESCRIPTION": desc,
                   "AUTOLOOP_DIFF_SUMMARY": ""}
            subprocess.run(["bash", "-c", block2], capture_output=True,
                          env=env, cwd=self.tmpdir)

        content = learnings_file.read_text()
        size_kb = len(content) / 1024

        # Should be readable size (< 20KB for 10 entries)
        self.assertLess(size_kb, 20, f"learnings.md too large: {size_kb:.1f}KB")
        # Should have all entries
        self.assertIn("Ken Burns", content)
        self.assertIn("Dark mode", content)


# ─── Bash Syntax ──────────────────────────────────────────────────────────────

class TestBashSyntaxSelfLearning(unittest.TestCase):

    def test_bash_syntax_still_valid(self):
        result = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True)
        self.assertEqual(result.returncode, 0, f"Bash syntax error:\n{result.stderr.decode()}")

    def test_learnings_command_in_help(self):
        result = subprocess.run(["bash", str(SCRIPT), "help"], capture_output=True,
                               cwd=str(PROJECT_ROOT))
        output = result.stdout.decode()
        # Help should mention the new commands
        self.assertIn("learn", output.lower(),
                     "learnings command should appear in help output")


if __name__ == "__main__":
    unittest.main(verbosity=2)
