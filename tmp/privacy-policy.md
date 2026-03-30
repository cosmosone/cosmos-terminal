# Privacy Policy

**Last Updated:** 31 March 2026
**Effective Date:** 31 March 2026

---

## 1. Introduction

**Cosmos Terminal** ("we", "our", or "the App"), operated by Cosmos One, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your information when you use Cosmos Terminal.

Cosmos Terminal is a native Windows desktop application that runs entirely on your device. All data is processed and stored locally — no backend server, no user accounts, no cloud storage. The only external network communication occurs when you explicitly use the optional AI commit message feature (which connects to OpenAI) or navigate to websites in the embedded browser.

By using Cosmos Terminal, you agree to the practices described in this Privacy Policy.

## 2. Overview

Cosmos Terminal is a lightweight terminal application for Windows built with Tauri v2 and Rust. It provides project workspaces, split terminal panes, an embedded browser, a file browser and editor, Git integration, and AI agent session support — all in a single window.

**Key Points:**

- **Local-first design** — All your data (settings, workspace state, terminal output) stays on your machine. There is no cloud storage, no user accounts, and no server-side processing.
- **No analytics or telemetry** — Cosmos Terminal does not track your usage, collect device identifiers, send crash reports, or phone home in any way.
- **Optional OpenAI integration** — If you choose to use AI-generated commit messages, your git diffs are sent to OpenAI's API using your own API key. This is the only feature that transmits your data to an external service, and it only activates when you explicitly trigger it.
- **Embedded browser** — The built-in browser uses Microsoft WebView2, which manages its own cookies and cache independently. Cosmos Terminal does not read, control, or transmit this data.
- **No advertising, no tracking, no data selling** — We do not serve ads, track your behaviour, or sell or share your data with anyone.
- **Free and open source** — Cosmos Terminal is MIT-licensed with no monetisation, subscriptions, or in-app purchases.

## 3. Information We Collect

### 3.1 Information You Provide

- **Settings and preferences** — Shell path, font choices, keybindings, UI preferences, browser homepage, and run command configuration. All stored locally on your device.
- **OpenAI API key** (optional) — If you choose to use the AI commit message feature, you provide your own OpenAI API key, which is stored in the local settings file.
- **Terminal input** — Commands you type are sent to your local shell (PowerShell, CMD, Git Bash, etc.) via the Windows ConPTY interface. This data never leaves your machine.
- **Files** — Files you open, edit, or create through the built-in file browser and editor. All operations are local.

### 3.2 Automatically Generated Data

- **Workspace state** — Open projects, terminal sessions, file tabs, browser tabs, split pane layouts, and their arrangement. Persisted locally so your workspace restores on restart.
- **Process metrics** — Cosmos Terminal's own CPU and memory usage, displayed in the status bar. These metrics are about the app's own process only and are held in memory (not persisted or transmitted).
- **Debug logs** (opt-in) — If you enable debug logging, entries are held in an in-memory buffer (max 1,000 entries) with automatic expiry. Logs are never written to disk or transmitted. Sensitive patterns (passwords, tokens, API keys, credentials) are automatically redacted.

### 3.3 Data Sent to External Services

- **Git diffs** (optional, user-initiated) — When you use the AI commit message feature, the staged and unstaged changes in your git repository are sent to OpenAI's API (`api.openai.com`). Diffs are truncated at 500 KB. No metadata about your project, repository, or identity is included beyond the diff content itself.
- **Git push** (user-initiated) — When you push from the Git sidebar, Cosmos Terminal executes `git push` to your configured remote. Credentials embedded in remote URLs are redacted from any displayed output.

### 3.4 Information We Do NOT Collect

- Personal information (name, email, phone number, address)
- Device identifiers or hardware fingerprints
- Location data
- Usage analytics or behavioural data
- Crash reports or diagnostic telemetry
- Browsing history from the embedded browser
- Clipboard contents
- Keystroke logs

## 4. How We Use Your Information

### 4.1 Core Functionality

- **Settings** — To configure and restore your terminal environment, editor preferences, keybindings, and workspace layout.
- **Terminal sessions** — To relay your input to the local shell and display output.
- **File operations** — To open, edit, save, and search files within your project directories.
- **Git operations** — To display repository status, stage files, generate diffs, create commits, and push to remotes.
- **AI commit messages** — To send your git diff to OpenAI and return a generated commit message (only when you explicitly request it).
- **Browser tabs** — To render web pages you navigate to using the embedded WebView2 engine.
- **Process monitoring** — To display Cosmos Terminal's own resource usage in the status bar.

### 4.2 We Do NOT Use Your Data For

- Advertising or ad targeting
- User profiling or behavioural analytics
- Machine learning model training
- Sharing with third parties (beyond the OpenAI API call you initiate)
- Marketing or promotional communications
- Any purpose beyond the core functionality described above

## 5. Data Storage and Security

### 5.1 Storage Architecture

Cosmos Terminal does NOT transmit your settings, workspace state, or terminal data to external servers. All persistent data is stored locally on your Windows machine.

| Component | Location | Protection |
|-----------|----------|------------|
| Settings (including API key) | `%APPDATA%\com.cosmos.terminal\settings.json` | Windows file system permissions (NTFS ACLs) |
| Workspace state | Same settings file | Same as above |
| Terminal output | RAM only (not persisted) | Cleared on session close |
| Debug logs | RAM only (max 1,000 entries) | Auto-expiry; sensitive data redacted |
| WebView2 data (cookies, cache) | `%LocalAppData%\EBWebView\` | Managed by Microsoft WebView2 |
| Git repository data | Your project directories | Your existing file permissions |

### 5.2 Security Measures

- **Path validation** — All file system operations are validated against directory traversal attacks. Writes to system directories (`C:\Windows`, `C:\Program Files`, etc.) are blocked. Symlink traversal is rejected in recursive operations.
- **Content Security Policy** — The app's CSP restricts network connections to OpenAI's API and local IPC only. No other external domains are permitted.
- **Credential redaction** — Git push output is filtered to remove embedded credentials (e.g., `https://user:token@host` is displayed as `https://***@host`).
- **Log sanitisation** — Debug logs automatically redact values matching sensitive patterns (password, token, secret, api_key, authorisation, credential).
- **Input validation** — Branch names, file paths, terminal dimensions, and shell paths are validated at IPC boundaries to prevent injection attacks.
- **Minimal attack surface** — Built with Tauri v2 (Rust backend), not Electron. No bundled Chromium. No remote code execution vectors.

### 5.3 OpenAI API Key

Your OpenAI API key is stored in plaintext within the local settings file. While the settings file is protected by your Windows user account permissions, we recommend:

- Using a dedicated API key with spending limits for Cosmos Terminal
- Regularly rotating your API key
- Ensuring your Windows user account is password-protected
- Considering full-disk encryption (BitLocker) for additional protection

## 6. Data Sharing and Disclosure

### 6.1 Data NOT Shared

Your settings, workspace state, terminal output, file contents, and git history are never transmitted to any external server or third party. This data stays on your machine.

### 6.2 Third-Party Data Sharing

| Third Party | Data Shared | When |
|-------------|-------------|------|
| OpenAI | Git diffs (code changes only) | Only when you use AI commit message generation |
| User's git remote (e.g., GitHub) | Git commits and branches | Only when you push from the Git sidebar |
| Websites visited in embedded browser | Standard HTTP request data | Only when you navigate in browser tabs |

### 6.3 User-Initiated Data Sharing

Data only leaves your machine through actions you explicitly perform:
- Using the AI commit message feature (sends diffs to OpenAI)
- Pushing git commits to your remote repository
- Navigating to websites in the embedded browser
- Exporting debug logs (saved to a location you choose)

### 6.4 Denials

- We do **NOT** sell your data to anyone
- We do **NOT** share your data with data brokers
- We do **NOT** share your data with advertisers
- We do **NOT** share your data with any party not listed above
- We may disclose information if required by law, but given that we hold no data on any server, there is nothing for us to disclose

## 7. Third-Party Services

Cosmos Terminal integrates with the following third-party services. Each operates under its own privacy policy:

### 7.1 OpenAI (Optional)

- **Purpose**: Generate commit messages from git diffs
- **Data shared**: Git diff content (staged and unstaged changes, max 500 KB)
- **When**: Only when you explicitly trigger AI commit message generation
- **API model**: `gpt-5-nano`
- **Your responsibility**: You provide and manage your own API key. Review diffs before sending if they contain sensitive code.
- **Privacy policy**: [https://openai.com/policies/privacy-policy](https://openai.com/policies/privacy-policy)

### 7.2 Microsoft WebView2

- **Purpose**: Renders web pages in the embedded browser tabs
- **Data managed**: Cookies, cache, browsing history for sites you visit
- **Storage**: `%LocalAppData%\EBWebView\` (managed by WebView2, not by Cosmos Terminal)
- **Note**: Cosmos Terminal does not read, modify, or transmit WebView2's stored data
- **Privacy policy**: [https://privacy.microsoft.com/en-us/privacystatement](https://privacy.microsoft.com/en-us/privacystatement)

### 7.3 Client-Side Libraries

The following libraries run entirely on your device with no data transmitted externally:

- **xterm.js** — Terminal emulation and rendering
- **git2** (Rust) — Local git operations via libgit2
- **portable-pty** — Windows ConPTY interface
- **sysinfo** — Process CPU/memory metrics
- **notify** — Local filesystem change detection

## 8. Data Retention and Deletion

### 8.1 Retention

| Data | Retention | How to Delete |
|------|-----------|---------------|
| Settings and preferences | Until you change or delete them | Edit or delete `%APPDATA%\com.cosmos.terminal\settings.json` |
| Workspace state | Until you close projects/tabs | Close tabs/projects, or delete settings file |
| OpenAI API key | Until you remove it from settings | Clear the field in Settings (`Ctrl+,`) |
| Terminal output | Current session only (RAM) | Close the terminal session or restart the app |
| Debug logs | In-memory with auto-expiry (1h/8h/24h) | Disable debug logging, or restart the app |
| WebView2 data | Managed by WebView2 | Clear via browser dev tools or delete `%LocalAppData%\EBWebView\` |
| Git data | Managed by git in your repositories | Standard git operations |

### 8.2 Complete Removal

To remove all data associated with Cosmos Terminal:

1. **Uninstall the application** — Removes the program files
2. **Delete settings** — Remove `%APPDATA%\com.cosmos.terminal\`
3. **Delete WebView2 data** — Remove `%LocalAppData%\EBWebView\` (if not shared with other WebView2 apps)
4. **Revoke API key** — If you provided an OpenAI API key, revoke or rotate it via your OpenAI account

No server-side data exists to delete. There is no account deletion process because there are no accounts.

## 9. Your Privacy Rights

Because Cosmos Terminal stores all data locally on your device, you can exercise most privacy rights directly without contacting us:

- **Access** — Your settings file is a readable JSON file on your machine
- **Correction** — Edit settings directly in the app or in the settings file
- **Deletion** — Delete the settings file and WebView2 data directory (see §8.2)
- **Portability** — Copy your settings file to another machine
- **Restriction** — Disable specific features (e.g., remove API key to stop AI commit messages)

### 9.1 GDPR

Cosmos Terminal does not process personal information on any server. The only external data transmission (OpenAI API) is user-initiated and uses your own API key. No server-side personal data processing occurs under our control.

### 9.2 CCPA

We do not collect, sell, or disclose personal information as defined by the California Consumer Privacy Act. All data remains on your device under your control.

### 9.3 Contact

If you have privacy questions or concerns, contact us:

**Email:** [support@cosmosone.cloud](mailto:support@cosmosone.cloud)
**Subject Line:** Cosmos Terminal Privacy
**Website:** [https://cosmosone.cloud](https://cosmosone.cloud)
**Response Time:** Within 5 business days

## 10. Children's Privacy

Cosmos Terminal is a software development tool not directed at children. You must be at least **13 years of age** to use Cosmos Terminal. We do not knowingly collect any personal information from children under 13 — indeed, we do not collect personal information from anyone, as the app operates entirely locally.

## 11. International Data Transfers

Cosmos Terminal itself does not transfer any user data internationally. All data remains on your local machine.

When you use the optional AI commit message feature, your git diffs are sent to OpenAI's servers, which may be located in the United States. This transfer occurs under OpenAI's own privacy policy and data processing terms. You can avoid this transfer entirely by not using the AI commit message feature.

Websites you visit in the embedded browser may be hosted anywhere in the world, subject to standard web browsing data flows.

## 12. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last Updated" date at the top of this document. For significant changes, we will note them in the application's release notes.

Your continued use of Cosmos Terminal after changes constitutes acceptance of the updated Privacy Policy.

## 13. Contact Information

**Email:** [support@cosmosone.cloud](mailto:support@cosmosone.cloud)
**Subject Line:** Cosmos Terminal Privacy
**Website:** [https://cosmosone.cloud](https://cosmosone.cloud)
**Response Time:** Within 5 business days

## 14. Summary

| Aspect | Details |
|--------|---------|
| **Data storage** | All local — `%APPDATA%\com.cosmos.terminal\` for settings, RAM for terminal output and logs |
| **Data transmission** | None by default. Git diffs sent to OpenAI only when you use AI commit messages. Git push to your own remotes. |
| **User accounts** | None |
| **Advertising** | None |
| **Analytics / telemetry** | None |
| **Tracking** | None |
| **Data selling / sharing** | Never |
| **Third-party services** | OpenAI (optional, user-initiated), WebView2 (embedded browser), git (user's remotes) |
| **User control** | Full — all data is on your machine, deletable at any time |
| **Deletion method** | Delete app data directory and uninstall. No server-side data exists. |
