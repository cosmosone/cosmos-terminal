import subprocess
import sys

def main():
    cmd = "cargo tauri build"
    print(f"\033[1;36mRunning: {cmd}\033[0m")
    print("-" * 40)
    result = subprocess.run(cmd, shell=True)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
