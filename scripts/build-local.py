import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXE_SRC = ROOT / "src-tauri" / "target" / "release" / "cosmos-terminal.exe"
APP_DIR_ENV = os.environ.get("COSMOS_TERMINAL_APP_DIR")


def main():
    env = os.environ.copy()

    # Override release profile for faster local builds.
    # These only apply to this process — Cargo.toml and build-release.py are unaffected.
    env["CARGO_PROFILE_RELEASE_LTO"] = "thin"           # thin LTO vs full: ~2x faster link, near-identical output
    env["CARGO_PROFILE_RELEASE_CODEGEN_UNITS"] = "8"     # parallel codegen vs single: major compile speedup
    env["CARGO_PROFILE_RELEASE_OPT_LEVEL"] = "2"         # -O2 vs -O3: faster compile, negligible runtime difference
    env["CARGO_INCREMENTAL"] = "1"                        # incremental compilation: huge win for repeat builds

    # --no-bundle: skip NSIS/MSI installer generation, just build the exe.
    # Output: src-tauri/target/release/cosmos-terminal.exe (same location as build-release.py)
    cmd = "cargo tauri build --no-bundle"
    print("\033[1;33mLocal build (fast profile)\033[0m")
    print("  LTO: thin | codegen-units: 8 | opt-level: 2 | incremental: on")
    print("  Bundling: skipped (exe only)")
    print(f"\033[1;36mRunning: {cmd}\033[0m")
    print("-" * 40)
    result = subprocess.run(cmd, shell=True, env=env)

    if result.returncode != 0:
        sys.exit(result.returncode)

    if EXE_SRC.exists():
        if not APP_DIR_ENV:
            print("\033[1;33mCOSMOS_TERMINAL_APP_DIR is not set — skipping exe copy.\033[0m")
            print("To enable, set the COSMOS_TERMINAL_APP_DIR environment variable.")
        else:
            app_dir = Path(APP_DIR_ENV)
            answer = input(
                "\033[1;33mCopy exe to app folder? [Y/n] \033[0m"
            ).strip().lower()
            if answer in ("", "y", "yes"):
                app_dir.mkdir(parents=True, exist_ok=True)
                dest = app_dir / "cosmos-terminal.exe"
                shutil.copy2(EXE_SRC, dest)
                print(f"\033[1;32mCopied to {dest}\033[0m")

if __name__ == "__main__":
    main()
