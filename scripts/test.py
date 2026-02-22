import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
RUST_ROOT = ROOT / "src-tauri"
LOG_ROOT = ROOT / "logs" / "test"

# ANSI palette (minimal + readable)
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"


class Step:
    def __init__(self, name: str, cmd: str, cwd: Path, desc: str = ""):
        self.name = name
        self.cmd = cmd
        self.cwd = cwd
        self.desc = desc


ANSI_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


def safe_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def sec(duration: float) -> str:
    return f"{duration:.2f}s"


def hr() -> None:
    print(f"{DIM}{'-' * 64}{RESET}", flush=True)


def extract_hint(step: Step, output: str) -> Optional[str]:
    plain = strip_ansi(output)
    if "vitest run" in step.cmd:
        m = re.search(r"Tests\s+(\d+)\s+passed", plain)
        if m:
            return f"{m.group(1)} tests passed"
    if "cargo test" in step.cmd:
        m = re.search(r"test result: ok\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;", plain)
        if m:
            return f"{m.group(1)} passed, {m.group(2)} failed"
    if "cargo clippy" in step.cmd:
        if "Finished" in plain and "error:" not in plain.lower():
            return "no clippy errors"
    if "npm run build" in step.cmd:
        m = re.search(r"built in ([\d.]+s)", plain)
        if m:
            return f"vite built in {m.group(1)}"
    if "vitest bench" in step.cmd:
        m = re.search(r"output flush latency.*?mean\s+([\d.]+)", plain, flags=re.S)
        if m:
            return f"flush mean {m.group(1)}ms"
    return None


def run_step(
    index: int,
    total: int,
    step: Step,
    run_log_dir: Path,
) -> Tuple[bool, int, float, Path]:
    print(f"{BOLD}{CYAN}[{index}/{total}] {step.name}{RESET}", flush=True)
    if step.desc:
        print(f"{DIM}    {step.desc}{RESET}", flush=True)
    print(f"{DIM}$ {step.cmd}{RESET}", flush=True)

    started = time.perf_counter()
    result = subprocess.run(
        step.cmd,
        shell=True,
        cwd=step.cwd,
        check=False,
        capture_output=True,
    )
    duration = time.perf_counter() - started
    output = (result.stdout or b"") + (result.stderr or b"")
    output_text = output.decode("utf-8", errors="replace")

    log_file = run_log_dir / f"{index:02d}-{safe_name(step.name)}.log"
    log_file.write_text(output_text, encoding="utf-8", errors="replace")
    hint = extract_hint(step, output_text)

    if result.returncode == 0:
        line = f"{GREEN}PASS{RESET} {step.name} {DIM}({sec(duration)}){RESET}"
        if hint:
            line += f" {DIM}| {hint}{RESET}"
        print(line, flush=True)
        return True, 0, duration, log_file

    print(
        f"{RED}FAIL{RESET} {step.name} "
        f"{DIM}(exit {result.returncode}, {sec(duration)}){RESET}"
    , flush=True)
    print(f"{DIM}log: {log_file}{RESET}", flush=True)

    tail = strip_ansi(output_text).strip().splitlines()[-12:]
    if tail:
        print(f"{DIM}tail:{RESET}", flush=True)
        for line in tail:
            print(f"{DIM}  {line}{RESET}", flush=True)
    return False, result.returncode, duration, log_file


def print_summary(
    results: List[Tuple[Step, bool, int, float, Path]],
    total_duration: float,
    run_log_dir: Path,
) -> None:
    passed = sum(1 for _, ok, _, _, _ in results if ok)
    failed = len(results) - passed

    print()
    hr()
    print(f"{BOLD}Summary{RESET}", flush=True)
    print(
        f"  {GREEN}Passed:{RESET} {passed}  "
        f"{RED}Failed:{RESET} {failed}  "
        f"{DIM}Total: {len(results)} | Time: {sec(total_duration)}{RESET}",
        flush=True,
    )
    print(f"  {DIM}Logs: {run_log_dir}{RESET}", flush=True)

    if failed:
        print()
        print(f"{BOLD}{YELLOW}Failed Steps{RESET}", flush=True)
        for step, ok, code, duration, log_file in results:
            if ok:
                continue
            print(
                f"  {RED}- {step.name}{RESET} "
                f"{DIM}(exit {code}, {sec(duration)}){RESET}"
                f"\n    {DIM}{log_file}{RESET}",
                flush=True,
            )

    print()
    hr()


def main() -> int:
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_log_dir = LOG_ROOT / run_id
    run_log_dir.mkdir(parents=True, exist_ok=True)

    print()
    print(f"{BOLD}Cosmos Terminal Test Pipeline{RESET}", flush=True)
    print(f"{DIM}{ROOT}{RESET}", flush=True)
    hr()

    steps = [
        Step("ESLint", "npm run lint", ROOT,
             "Catches unused vars, bad patterns, and style violations across all TS files"),
        Step("Integration Tests", "npm run test:integration", ROOT,
             "IPC contract sync, markdown XSS hardening, CSS layout invariants, "
             "git sidebar rendering, file-tab lifecycle, and Tauri permission auditing"),
        Step("Stress Tests", "npm run test:stress", ROOT,
             "High-volume terminal output with scroll-pinning and position "
             "preservation under randomised burst/scroll/hide sequences"),
        Step("Frontend Benchmarks", "npm run bench:frontend", ROOT,
             "Measures output flush latency, resize/fit latency, "
             "and IPC dispatch counts to catch performance regressions"),
        Step("TypeScript Typecheck", "npx tsc --noEmit", ROOT,
             "Full strict-mode type check - catches type errors, "
             "unused locals/params, and missing annotations"),
        Step("Frontend Build", "npm run build", ROOT,
             "Vite production bundle - verifies no import errors, "
             "tree-shaking issues, or asset pipeline failures"),
        Step("Rust Clippy", "cargo clippy --all-targets --all-features", RUST_ROOT,
             "Rust linter catching correctness bugs, performance pitfalls, "
             "and non-idiomatic patterns in the backend"),
        Step("Rust Unit Tests", "cargo test --lib", RUST_ROOT,
             "FS security (path traversal, system dir rejection), directory listing, "
             "file search, binary detection, and shell path validation"),
    ]

    pipeline_started = time.perf_counter()
    results: List[Tuple[Step, bool, int, float, Path]] = []

    for idx, step in enumerate(steps, start=1):
        ok, code, duration, log_file = run_step(idx, len(steps), step, run_log_dir)
        results.append((step, ok, code, duration, log_file))
        hr()

    total_duration = time.perf_counter() - pipeline_started
    print_summary(results, total_duration, run_log_dir)

    any_failed = any(not ok for _, ok, _, _, _ in results)
    return 1 if any_failed else 0


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(main())
