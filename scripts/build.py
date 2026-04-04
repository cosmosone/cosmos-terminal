"""Unified build script for Cosmos Terminal.

Usage:
    python scripts/build.py              # Interactive build (smart detect)
    python scripts/build.py --dev        # Fast local build (smart detect, silent install)
    python scripts/build.py --release    # Silent release build (auto bump, tag if backend)
    python scripts/build.py --release --force  # Force full rebuild + tag + release
    python scripts/build.py --local      # Dev server with hot reload (cargo tauri dev)
"""

import argparse
import hashlib
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
RUST_HASH_FILE = ROOT / "src-tauri" / "target" / ".rust-build-hash"
APP_DIR_ENV = os.environ.get("COSMOS_TERMINAL_APP_DIR")

# ANSI helpers
RESET = "\033[0m"
BOLD = "\033[1m"
CYAN = "\033[1;36m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
RED = "\033[1;31m"
DIM = "\033[2m"

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


# --- Smart build detection ---------------------------------------------------


def compute_rust_hash() -> str:
    """Hash all Rust source files and build config (excluding version fields)."""
    hasher = hashlib.sha256()

    # Hash all .rs files (sorted for determinism)
    src_dir = ROOT / "src-tauri" / "src"
    for rs_file in sorted(src_dir.rglob("*.rs")):
        hasher.update(rs_file.read_bytes())

    # Hash Cargo.toml with version line stripped
    cargo_text = CARGO_TOML.read_text(encoding="utf-8")
    cargo_text = re.sub(
        r'^version\s*=\s*"[^"]*"',
        "",
        cargo_text,
        count=1,
        flags=re.MULTILINE,
    )
    hasher.update(cargo_text.encode("utf-8"))

    # Hash Cargo.lock with own-package version stripped (version bumps should
    # not trigger a full rebuild)
    cargo_lock = ROOT / "src-tauri" / "Cargo.lock"
    if cargo_lock.exists():
        lock_text = cargo_lock.read_text(encoding="utf-8")
        lock_text = re.sub(
            r'(name\s*=\s*"cosmos-terminal"\s*\n)version\s*=\s*"[^"]*"',
            r"\1",
            lock_text,
            count=1,
        )
        hasher.update(lock_text.encode("utf-8"))

    # Hash build.rs
    build_rs = ROOT / "src-tauri" / "build.rs"
    if build_rs.exists():
        hasher.update(build_rs.read_bytes())

    # Hash tauri.conf.json with version field stripped
    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    conf.pop("version", None)
    hasher.update(json.dumps(conf, sort_keys=True).encode("utf-8"))

    return hasher.hexdigest()


_cached_rust_hash: str | None = None


def detect_build_type() -> str:
    """Determine if a full (Rust + frontend) or frontend-only build is needed.

    Returns 'full' or 'frontend'.  Caches the computed hash for
    ``save_rust_hash()`` to reuse.
    """
    global _cached_rust_hash

    # Guard: if exe has never been built, force full build
    if not EXE_SRC.exists():
        print(f"{DIM}No existing exe found — full build required{RESET}")
        return "full"

    # Guard: if app dir is set but exe not present there, force full build
    if APP_DIR_ENV:
        app_exe = Path(APP_DIR_ENV) / "cosmos-terminal.exe"
        if not app_exe.exists():
            print(f"{DIM}No exe in app folder — full build required{RESET}")
            return "full"

    # Compare hash with saved hash from last Rust build
    if not RUST_HASH_FILE.exists():
        print(f"{DIM}No previous Rust build hash — full build required{RESET}")
        return "full"

    saved_hash = RUST_HASH_FILE.read_text(encoding="utf-8").strip()
    _cached_rust_hash = compute_rust_hash()

    if saved_hash != _cached_rust_hash:
        print(f"{DIM}Rust source changes detected — full build required{RESET}")
        return "full"

    print(f"{DIM}No Rust changes detected — frontend-only build{RESET}")
    return "frontend"


def save_rust_hash() -> None:
    """Save the current Rust hash after a successful build."""
    RUST_HASH_FILE.parent.mkdir(parents=True, exist_ok=True)
    rust_hash = _cached_rust_hash or compute_rust_hash()
    RUST_HASH_FILE.write_text(rust_hash, encoding="utf-8")


# --- Git + release -----------------------------------------------------------


def clear_git_lock() -> None:
    lock = ROOT / ".git" / "index.lock"
    if lock.exists():
        lock.unlink()
        print(f"{YELLOW}Removed stale .git/index.lock from a previous failed run{RESET}")


def _stage_and_commit(version: str) -> None:
    """Stage version files and commit if there are changes."""
    clear_git_lock()
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


def commit_and_tag(version: str) -> None:
    _stage_and_commit(version)
    tag = f"v{version}"
    subprocess.run(["git", "tag", tag], cwd=ROOT, check=True)
    subprocess.run(["git", "push"], cwd=ROOT, check=True)
    subprocess.run(["git", "push", "origin", tag], cwd=ROOT, check=True)
    print(f"{GREEN}Tagged {tag} and pushed{RESET}")


def commit_and_push(version: str) -> None:
    """Commit version bump and push (no tag, no release)."""
    _stage_and_commit(version)
    subprocess.run(["git", "push"], cwd=ROOT, check=True)
    print(f"{GREEN}Pushed version bump to {version}{RESET}")


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
    result = subprocess.run(cmd, shell=True, env=env, cwd=ROOT)

    if result.returncode != 0:
        print(f"{RED}Build failed{RESET}")
        sys.exit(result.returncode)


def build_frontend_only() -> None:
    """Build frontend assets only (no Rust compilation)."""
    print(f"{CYAN}Building frontend only (npm run build){RESET}")
    print("-" * 40)
    result = subprocess.run("npm run build", shell=True, cwd=ROOT)
    if result.returncode != 0:
        print(f"{RED}Frontend build failed{RESET}")
        sys.exit(result.returncode)
    # Write version.json so the frontend hot-swap can show the new version
    dist_dir = ROOT / "dist"
    if dist_dir.is_dir():
        (dist_dir / "version.json").write_text(json.dumps({"version": read_version()}))
    print(f"{GREEN}Frontend build complete{RESET}")


# --- Install helpers ---------------------------------------------------------


def install_to_app_folder(build_type: str) -> bool:
    """Copy built assets to the app folder.

    Returns True on full success, False if the exe copy failed.
    """
    if not APP_DIR_ENV:
        return True

    app_dir = Path(APP_DIR_ENV)
    app_dir.mkdir(parents=True, exist_ok=True)
    dist_src = ROOT / "dist"
    frontend_dest = app_dir / "frontend"
    exe_failed = False

    # Always install frontend assets (clear contents, not the directory itself,
    # so the Rust FrontendWatcher keeps its file-system handle alive).
    if dist_src.is_dir():
        if frontend_dest.exists():
            for child in frontend_dest.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        else:
            frontend_dest.mkdir(parents=True)
        for child in dist_src.iterdir():
            dest_child = frontend_dest / child.name
            if child.is_dir():
                shutil.copytree(child, dest_child)
            else:
                shutil.copy2(child, dest_child)
        print(f"{GREEN}Installed frontend to {frontend_dest}{RESET}")
    else:
        print(f"{RED}dist/ directory not found — frontend not installed{RESET}")
        return False

    # Install exe only on full builds
    if build_type == "full":
        if EXE_SRC.exists():
            dest = app_dir / "cosmos-terminal.exe"
            try:
                shutil.copy2(EXE_SRC, dest)
                print(f"{GREEN}Installed exe to {dest}{RESET}")
            except PermissionError:
                exe_failed = True
                print(f"{YELLOW}Frontend installed successfully.{RESET}")
                print(f"{YELLOW}Exe could not be copied (app is running).{RESET}")
                print(f"{YELLOW}The app will offer a Restart button to apply the update.{RESET}")
        else:
            print(f"{RED}Exe not found at {EXE_SRC}{RESET}")
            exe_failed = True

    # Write version.json so the frontend hot-swap badge knows what to show.
    # exePending (path to new exe) tells the app a restart is needed.
    version_data: dict[str, object] = {"version": read_version()}
    if exe_failed:
        version_data["exePending"] = str(EXE_SRC)
    (frontend_dest / "version.json").write_text(json.dumps(version_data))

    return not exe_failed


def install_prompt(build_type: str) -> None:
    """Ask the user whether to install to app folder."""
    if not APP_DIR_ENV:
        print(f"{YELLOW}COSMOS_TERMINAL_APP_DIR is not set — skipping install.{RESET}")
        print("To enable, set the COSMOS_TERMINAL_APP_DIR environment variable.")
        return
    answer = input(f"{YELLOW}Install to app folder? [y/N] {RESET}").strip().lower()
    if answer in ("y", "yes"):
        install_to_app_folder(build_type)


def try_silent_install(build_type: str) -> None:
    """Install to app folder without prompting."""
    if not APP_DIR_ENV:
        print(f"{YELLOW}COSMOS_TERMINAL_APP_DIR is not set — skipping install.{RESET}")
        return
    install_to_app_folder(build_type)


# --- Mode handlers -----------------------------------------------------------


def build_local() -> None:
    print(f"{CYAN}Starting local dev server (cargo tauri dev){RESET}")
    print("-" * 40)
    ensure_node_modules()
    try:
        result = subprocess.run("cargo tauri dev", shell=True, cwd=ROOT)
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Stopped.{RESET}")
        sys.exit(0)


def build_dev(force: bool = False) -> None:
    ensure_node_modules()

    if force:
        global _cached_rust_hash
        _cached_rust_hash = compute_rust_hash()
        build_type = "full"
        print(f"{YELLOW}Force flag set — full build regardless of changes{RESET}")
    else:
        build_type = detect_build_type()

    if build_type == "full":
        print(f"{YELLOW}Full build (Rust + frontend){RESET}")
        print("  LTO: thin | codegen-units: 8 | opt-level: 2 | incremental: on")
        print("  Bundling: skipped (exe only)")
        run_cargo_build(
            env_overrides={
                "CARGO_PROFILE_RELEASE_LTO": "thin",
                "CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "8",
                "CARGO_PROFILE_RELEASE_OPT_LEVEL": "2",
                "CARGO_INCREMENTAL": "1",
            },
            no_bundle=True,
        )
        save_rust_hash()
    else:
        print(f"{GREEN}Frontend-only build (no Rust changes){RESET}")
        build_frontend_only()

    try_silent_install(build_type)


def build_release(force: bool = False) -> None:
    ensure_node_modules()

    # Auto bump patch version (silent)
    current = read_version()
    version = bump_patch(current)
    update_version(version)
    print(f"{GREEN}Version bumped to {version}{RESET}")

    if force:
        global _cached_rust_hash
        _cached_rust_hash = compute_rust_hash()
        build_type = "full"
        print(f"{YELLOW}Force flag set — full build + tag + release regardless of changes{RESET}")
    else:
        build_type = detect_build_type()

    if build_type == "full":
        print(f"{YELLOW}Full build (Rust + frontend){RESET}")
        run_cargo_build()
        save_rust_hash()
        commit_and_tag(version)
        create_release(version)
    else:
        print(f"{GREEN}Frontend-only build (no Rust changes){RESET}")
        build_frontend_only()
        commit_and_push(version)

    try_silent_install(build_type)


def build_interactive() -> None:
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
    build_type = detect_build_type()

    if build_type == "frontend":
        force_full = input(
            f"{YELLOW}Force full rebuild anyway? [y/N] {RESET}"
        ).strip().lower()
        if force_full in ("y", "yes"):
            global _cached_rust_hash
            _cached_rust_hash = compute_rust_hash()
            build_type = "full"

    if build_type == "full":
        print(f"{YELLOW}Full build (Rust + frontend){RESET}")
        run_cargo_build()
        save_rust_hash()
    else:
        print(f"{GREEN}Frontend-only build (no Rust changes){RESET}")
        build_frontend_only()

    # --- Publish -------------------------------------------------------------
    if bumped:
        if build_type == "full":
            commit_and_tag(version)
            create_release(version)
        else:
            commit_and_push(version)

    # --- Install -------------------------------------------------------------
    install_prompt(build_type)


# --- Entry point -------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build Cosmos Terminal",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  python scripts/build.py              # Interactive build\n"
               "  python scripts/build.py --dev        # Fast local build\n"
               "  python scripts/build.py --release    # Silent release build\n"
               "  python scripts/build.py --local      # Dev server with hot reload",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--dev", action="store_true",
        help="Fast local build (smart detect, silent install)",
    )
    group.add_argument(
        "--release", action="store_true",
        help="Silent release build (auto bump, tag+release if backend changes)",
    )
    group.add_argument(
        "--local", action="store_true",
        help="Dev server with hot reload (cargo tauri dev)",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Force full Rust rebuild + tag + release (ignores smart detection)",
    )
    args = parser.parse_args()

    if args.force and not (args.dev or args.release):
        print(f"{YELLOW}--force has no effect without --dev or --release{RESET}")

    if args.local:
        build_local()
    elif args.dev:
        build_dev(force=args.force)
    elif args.release:
        build_release(force=args.force)
    else:
        build_interactive()


if __name__ == "__main__":
    main()
