import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"


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


def main():
    current = read_version()
    next_ver = bump_patch(current)

    answer = input(f"Current version is \033[1;33m{current}\033[0m. Bump to \033[1;32m{next_ver}\033[0m? [Y/n] ").strip().lower()
    if answer not in ("n", "no"):
        update_version(next_ver)
        print(f"\033[1;32mVersion bumped to {next_ver}\033[0m")
    else:
        print(f"Keeping version {current}")

    cmd = "cargo tauri build"
    print(f"\033[1;36mRunning: {cmd}\033[0m")
    print("-" * 40)
    result = subprocess.run(cmd, shell=True)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
