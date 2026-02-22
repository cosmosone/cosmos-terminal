import subprocess
import sys
import os

def main():
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    node_modules = os.path.join(project_root, "node_modules")

    if not os.path.isdir(node_modules):
        print("\033[1;33mnode_modules not found, running npm install...\033[0m")
        print("-" * 40)
        result = subprocess.run("npm install", shell=True, cwd=project_root)
        if result.returncode != 0:
            print("\033[1;31mnpm install failed\033[0m")
            sys.exit(result.returncode)
        print()

    cmd = "cargo tauri dev"
    print(f"\033[1;36mRunning: {cmd}\033[0m")
    print("-" * 40)
    try:
        result = subprocess.run(cmd, shell=True, cwd=project_root)
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print("\n\033[1;33mStopped.\033[0m")

if __name__ == "__main__":
    main()
