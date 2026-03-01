"""Unified build script for Cosmos Terminal.

Usage:
    python scripts/build.py          # Production release build (interactive)
    python scripts/build.py --dev    # Fast local build (no bundling)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# --- Constants ---------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
EXE_SRC = ROOT / "src-tauri" / "target" / "release" / "cosmos-terminal.exe"
BUNDLE_DIR = ROOT / "src-tauri" / "target" / "release" / "bundle"
PACKAGE_JSON = ROOT / "package.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
APP_DIR_ENV = os.environ.get("COSMOS_TERMINAL_APP_DIR")

# ANSI helpers
RESET = "\033[0m"
BOLD = "\033[1m"
CYAN = "\033[1;36m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
RED = "\033[1;31m"

# --- Version management ------------------------------------------------------


def read_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return data["version"]


def bump_patch(version: str) -> str:
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def update_version(new_version: str) -> None:
    # package.json
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    pkg["version"] = new_version
    PACKAGE_JSON.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")

    # src-tauri/tauri.conf.json
    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    conf["version"] = new_version
    TAURI_CONF.write_text(json.dumps(conf, indent=2) + "\n", encoding="utf-8")

    # src-tauri/Cargo.toml
    cargo = CARGO_TOML.read_text(encoding="utf-8")
    cargo = re.sub(
        r'^(version\s*=\s*")[\d.]+(")',
        rf"\g<1>{new_version}\2",
        cargo,
        count=1,
        flags=re.MULTILINE,
    )
    CARGO_TOML.write_text(cargo, encoding="utf-8")


# --- Git + release -----------------------------------------------------------


def commit_and_tag(version: str) -> None:
    tag = f"v{version}"
    subprocess.run(
        ["git", "add", "package.json", "src-tauri/Cargo.toml",
         "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"],
        cwd=ROOT, check=True,
    )
    has_staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT)
    if has_staged.returncode != 0:
        subprocess.run(
            ["git", "commit", "-m", f"chore: bump version to {version}"],
            cwd=ROOT, check=True,
        )
    else:
        print(f"{YELLOW}Version bump already committed — skipping commit{RESET}")
    subprocess.run(["git", "tag", tag], cwd=ROOT, check=True)
    subprocess.run(["git", "push"], cwd=ROOT, check=True)
    subprocess.run(["git", "push", "origin", tag], cwd=ROOT, check=True)
    print(f"{GREEN}Tagged {tag} and pushed{RESET}")


def get_changelog(count: int = 3) -> str:
    result = subprocess.run(
        ["git", "log", f"-{count * 3}", "--pretty=format:%s"],
        cwd=ROOT, capture_output=True, text=True,
    )
    lines = [
        line.strip() for line in result.stdout.splitlines()
        if line.strip() and not line.strip().startswith("chore: bump version")
    ]
    return "\n".join(f"- {line}" for line in lines[:count])


def create_release(version: str) -> None:
    tag = f"v{version}"
    nsis = BUNDLE_DIR / "nsis" / f"Cosmos Terminal_{version}_x64-setup.exe"
    msi = BUNDLE_DIR / "msi" / f"Cosmos Terminal_{version}_x64_en-US.msi"

    assets = [str(p) for p in (nsis, msi) if p.exists()]
    if not assets:
        print(f"{RED}No installer files found — skipping release{RESET}")
        return

    changelog = get_changelog()
    notes = ""
    if changelog:
        notes += f"## Changes\n\n{changelog}\n\n"
    notes += "## Downloads\n\n"
    if nsis.exists():
        notes += f"- **NSIS Installer** (recommended) — `{nsis.name}`\n"
    if msi.exists():
        notes += f"- **MSI Installer** — `{msi.name}`\n"

    cmd = ["gh", "release", "create", tag, "--title", f"{tag} Release",
           "--notes", notes] + assets
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode == 0:
        print(f"{GREEN}GitHub release {tag} created with {len(assets)} asset(s){RESET}")
    else:
        print(f"{RED}Failed to create GitHub release{RESET}")


# --- Build helpers -----------------------------------------------------------


def ensure_node_modules() -> None:
    if not (ROOT / "node_modules").exists():
        print(f"{YELLOW}node_modules not found — running npm install{RESET}")
        result = subprocess.run("npm install", shell=True, cwd=ROOT)
        if result.returncode != 0:
            print(f"{RED}npm install failed{RESET}")
            sys.exit(result.returncode)


def run_cargo_build(env_overrides: dict[str, str] | None = None,
                    no_bundle: bool = False) -> None:
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)

    cmd = "cargo tauri build"
    if no_bundle:
        cmd += " --no-bundle"

    print(f"{CYAN}Running: {cmd}{RESET}")
    print("-" * 40)
    result = subprocess.run(cmd, shell=True, env=env)

    if result.returncode != 0:
        print(f"{RED}Build failed{RESET}")
        sys.exit(result.returncode)


def copy_exe_prompt() -> None:
    if not EXE_SRC.exists():
        return
    if not APP_DIR_ENV:
        print(f"{YELLOW}COSMOS_TERMINAL_APP_DIR is not set — skipping exe copy.{RESET}")
        print("To enable, set the COSMOS_TERMINAL_APP_DIR environment variable.")
        return
    app_dir = Path(APP_DIR_ENV)
    answer = input(f"{YELLOW}Copy exe to app folder? [Y/n] {RESET}").strip().lower()
    if answer in ("", "y", "yes"):
        app_dir.mkdir(parents=True, exist_ok=True)
        dest = app_dir / "cosmos-terminal.exe"
        shutil.copy2(EXE_SRC, dest)
        print(f"{GREEN}Copied to {dest}{RESET}")


# --- Mode handlers -----------------------------------------------------------


def build_dev() -> None:
    print(f"{YELLOW}Local build (fast profile){RESET}")
    print("  LTO: thin | codegen-units: 8 | opt-level: 2 | incremental: on")
    print("  Bundling: skipped (exe only)")

    ensure_node_modules()
    run_cargo_build(
        env_overrides={
            "CARGO_PROFILE_RELEASE_LTO": "thin",
            "CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "8",
            "CARGO_PROFILE_RELEASE_OPT_LEVEL": "2",
            "CARGO_INCREMENTAL": "1",
        },
        no_bundle=True,
    )
    copy_exe_prompt()


def build_release() -> None:
    ensure_node_modules()

    # --- Version bump --------------------------------------------------------
    current = read_version()
    next_ver = bump_patch(current)
    bumped = False

    bump_choice = input(
        f"Current version is {YELLOW}{current}{RESET}. "
        f"Bump to {GREEN}{next_ver}{RESET}? [Y/n/custom] "
    ).strip()

    if bump_choice.lower() in ("n", "no"):
        version = current
        print(f"Keeping version {current}")
    elif bump_choice.lower() in ("", "y", "yes"):
        version = next_ver
        update_version(version)
        bumped = True
        print(f"{GREEN}Version bumped to {version}{RESET}")
    else:
        version = bump_choice
        update_version(version)
        bumped = True
        print(f"{GREEN}Version set to {version}{RESET}")

    # --- Build ---------------------------------------------------------------
    run_cargo_build()

    # --- Publish -------------------------------------------------------------
    if bumped:
        commit_and_tag(version)
        create_release(version)

    # --- Copy exe ------------------------------------------------------------
    copy_exe_prompt()


# --- Entry point -------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build Cosmos Terminal",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  python scripts/build.py          # Production release build\n"
               "  python scripts/build.py --dev    # Fast local build",
    )
    parser.add_argument(
        "--dev", action="store_true",
        help="Fast local build (thin LTO, no bundling, incremental)",
    )
    args = parser.parse_args()

    if args.dev:
        build_dev()
    else:
        build_release()


if __name__ == "__main__":
    main()
