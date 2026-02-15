import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
BUNDLE_DIR = ROOT / "src-tauri" / "target" / "release" / "bundle"
EXE_SRC = ROOT / "src-tauri" / "target" / "release" / "cosmos-terminal.exe"
APP_DIR = Path(r"D:\Apps\Cosmos-Terminal")


def read_version() -> str:
    """Read the current version from package.json."""
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return data["version"]


def bump_patch(version: str) -> str:
    """Increment the patch (last) segment: 0.1.0 -> 0.1.1"""
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def update_version(new_version: str) -> None:
    """Write the new version into all three config files."""
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


def commit_and_tag(version: str) -> None:
    """Commit version bump and create a git tag."""
    tag = f"v{version}"
    subprocess.run(
        ["git", "add", "package.json", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"],
        cwd=ROOT, check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", f"chore: bump version to {version}"],
        cwd=ROOT, check=True,
    )
    subprocess.run(["git", "tag", tag], cwd=ROOT, check=True)
    subprocess.run(["git", "push"], cwd=ROOT, check=True)
    subprocess.run(["git", "push", "origin", tag], cwd=ROOT, check=True)
    print(f"\033[1;32mCommitted, tagged {tag}, and pushed\033[0m")


def create_release(version: str) -> None:
    """Create a GitHub release with the built installers."""
    tag = f"v{version}"
    nsis = BUNDLE_DIR / "nsis" / f"Cosmos Terminal_{version}_x64-setup.exe"
    msi = BUNDLE_DIR / "msi" / f"Cosmos Terminal_{version}_x64_en-US.msi"

    assets = [str(p) for p in (nsis, msi) if p.exists()]
    if not assets:
        print(f"\033[1;31mNo installer files found — skipping release\033[0m")
        return

    notes = f"## Downloads\n\n"
    if nsis.exists():
        notes += f"- **NSIS Installer** (recommended) — `{nsis.name}`\n"
    if msi.exists():
        notes += f"- **MSI Installer** — `{msi.name}`\n"

    cmd = ["gh", "release", "create", tag, "--title", f"{tag} Release", "--notes", notes] + assets
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode == 0:
        print(f"\033[1;32mGitHub release {tag} created with {len(assets)} asset(s)\033[0m")
    else:
        print(f"\033[1;31mFailed to create GitHub release\033[0m")


def main():
    current = read_version()
    next_ver = bump_patch(current)
    bumped = False

    answer = input(f"Current version is \033[1;33m{current}\033[0m. Bump to \033[1;32m{next_ver}\033[0m? [Y/n] ").strip().lower()
    if answer not in ("n", "no"):
        update_version(next_ver)
        bumped = True
        version = next_ver
        print(f"\033[1;32mVersion bumped to {next_ver}\033[0m")
    else:
        version = current
        print(f"Keeping version {current}")

    cmd = "cargo tauri build"
    print(f"\033[1;36mRunning: {cmd}\033[0m")
    print("-" * 40)
    result = subprocess.run(cmd, shell=True)

    if result.returncode != 0:
        print(f"\033[1;31mBuild failed\033[0m")
        sys.exit(result.returncode)

    if bumped:
        commit_and_tag(version)
        create_release(version)

    if EXE_SRC.exists():
        answer = input(
            "\033[1;33mCopy exe to app folder? [Y/n] \033[0m"
        ).strip().lower()
        if answer in ("", "y", "yes"):
            APP_DIR.mkdir(parents=True, exist_ok=True)
            dest = APP_DIR / "cosmos-terminal.exe"
            shutil.copy2(EXE_SRC, dest)
            print(f"\033[1;32mCopied to {dest}\033[0m")


if __name__ == "__main__":
    main()
