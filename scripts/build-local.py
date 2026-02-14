import os
import subprocess
import sys

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
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
