# Terms and Conditions

**Last Updated:** 31 March 2026
**Effective Date:** 31 March 2026

---

## 1. Acceptance of Terms

By downloading, installing, or using **Cosmos Terminal** ("the App"), you agree to be bound by these Terms and Conditions ("Terms"). If you do not agree to these Terms, do not use the App.

These Terms constitute a legal agreement between you and Cosmos One ("we", "us", or "our"). We reserve the right to modify these Terms at any time. Continued use of the App after changes constitutes acceptance of the modified Terms.

You must be at least **13 years of age** to use Cosmos Terminal.

## 2. Description of Service

Cosmos Terminal is a free, open-source desktop terminal application for Windows, built with Tauri v2 and Rust. It provides:

- **Project workspaces** — Organise terminals, files, and browser tabs by project, with full state persistence across restarts
- **Terminal with split panes** — Multiple terminal sessions with horizontal and vertical splits, WebGL rendering, and ConPTY shell support
- **AI agent sessions** — Launch Claude, Codex, Gemini, or Cline directly from the terminal
- **Embedded browser** — Browse web pages in tabs alongside your terminals using WebView2
- **Git integration** — Stage files, review diffs, commit, push, and browse commit history with an optional AI commit message generator
- **File browser and editor** — Tree view navigation, built-in text editor, Markdown rendering, and find-in-document search
- **Customisation** — 22 configurable keybindings, font settings, and shell path selection

Cosmos Terminal runs entirely on your local machine. There is no backend server, no user accounts, and no cloud storage. The only external network communication occurs when you explicitly use the AI commit message feature (OpenAI API) or navigate to websites in the embedded browser.

## 3. Important Disclaimers

### 3.1 AI-Generated Content

The AI commit message feature uses OpenAI's `gpt-5-nano` model to generate commit messages from your git diffs. AI-generated content may be inaccurate, incomplete, or inappropriate. You are solely responsible for reviewing and approving all commit messages before committing.

### 3.2 Code and File Operations

Cosmos Terminal provides file editing, deletion, and git operations that modify your local files and repositories. These operations are irreversible in some cases (e.g., file deletion, force operations). You are responsible for maintaining backups of important data.

### 3.3 Embedded Browser

The embedded browser uses Microsoft WebView2 and is provided for convenience. It is not a full-featured web browser. We make no guarantees about website compatibility, security of visited sites, or the behaviour of web applications within the embedded browser.

### 3.4 Third-Party AI Agents

Cosmos Terminal can launch third-party AI coding agents (Claude, Codex, Gemini, Cline). These agents are third-party products with their own terms of service. We are not responsible for the output, actions, or behaviour of these agents. Use of AI agents is at your own risk.

### 3.5 Data Persistence

Your workspace state and settings are stored locally. Data may be lost due to file corruption, operating system issues, manual deletion, or application updates. We recommend keeping important work in version-controlled repositories.

## 4. Licence Grant

We grant you a limited, non-exclusive, non-transferable, revocable licence to download, install, and use Cosmos Terminal for personal and commercial purposes, subject to these Terms.

Cosmos Terminal is released under the **MIT Licence**. The full licence text is available in the `LICENSE` file included with the application. In the event of a conflict between these Terms and the MIT Licence, the MIT Licence governs with respect to the source code.

**Restrictions** — You shall not:
- Remove or alter any copyright, trademark, or attribution notices
- Use the App for any purpose that violates applicable law
- Misrepresent the origin of the software
- Use the Cosmos One or Cosmos Terminal name or branding to endorse derived products without permission

## 5. User Content

You retain full ownership of all content you create, edit, or manage using Cosmos Terminal, including but not limited to source code, text files, terminal sessions, and git commits.

You represent that you have the right to use, edit, and manage all content you access through the App.

You are solely responsible for:
- The content of files you create, edit, or delete
- Commands you execute in terminal sessions
- Code changes you commit and push to remote repositories
- Git diffs you send to OpenAI via the AI commit message feature
- Websites you visit in the embedded browser

Content created or edited in Cosmos Terminal never leaves your device unless you explicitly initiate a transfer (git push, AI commit message, or browser navigation).

## 6. Privacy

Your privacy is important to us. Please review our [Privacy Policy](privacy-policy.md) for details on how we handle your information.

**Key Points:**

- All data is stored locally on your machine — no cloud storage, no user accounts, no telemetry
- No analytics, advertising, or behavioural tracking of any kind
- The AI commit message feature sends git diffs to OpenAI only when you explicitly trigger it, using your own API key
- The embedded browser uses Microsoft WebView2, which manages its own cookies and cache independently
- We do not sell or share your data with anyone

## 7. Data Storage and Security

All application data (settings, workspace state, preferences) is stored locally on your Windows machine in your user application data directory. Terminal output is held in RAM only and not persisted to disk.

Your OpenAI API key, if provided, is stored in the local settings file. You are responsible for protecting access to your machine and this file.

The embedded browser's data (cookies, cache, history) is managed by Microsoft WebView2 and stored separately from Cosmos Terminal's own data.

For full details on data storage, security measures, and deletion instructions, refer to our [Privacy Policy](privacy-policy.md).

## 8. Third-Party Services

Cosmos Terminal integrates with the following third-party services:

- **OpenAI**: AI-powered commit message generation (optional, user-initiated, requires your own API key)
- **Microsoft WebView2**: Embedded browser engine for browser tabs
- **Git**: Version control operations to your configured remote repositories

Additionally, Cosmos Terminal can launch third-party AI agent sessions:

- **Claude** (Anthropic)
- **Codex** (OpenAI)
- **Gemini** (Google)
- **Cline**

These services are subject to their respective terms and privacy policies. We are not responsible for the practices, content, or availability of third-party services.

## 9. Intellectual Property

Cosmos Terminal's source code is released under the MIT Licence. The Cosmos Terminal name, logo, and branding are the property of Cosmos One.

Third-party libraries used in the App are subject to their respective licences. A full list is available in the application's source repository.

## 10. Disclaimer of Warranties

THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

WITHOUT LIMITING THE FOREGOING, WE DO NOT WARRANT THAT:
- The App will be uninterrupted, error-free, or free of harmful components
- AI-generated commit messages will be accurate or appropriate
- The embedded browser will be compatible with all websites
- File operations will not result in data loss
- Third-party AI agents will function correctly or safely

**Australian Consumer Law Notice:** Nothing in these Terms excludes, restricts, or modifies any consumer guarantee, right, or remedy conferred on you by the Australian Consumer Law (Schedule 2 of the Competition and Consumer Act 2010) that cannot be excluded, restricted, or modified by agreement. If the Australian Consumer Law applies, then to the extent permitted, our liability is limited to resupplying the service or paying the cost of having it resupplied.

## 11. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL COSMOS ONE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:

- Loss of data, files, or repository contents
- Damage caused by commands executed in terminal sessions
- Consequences of AI-generated commit messages
- Actions performed by third-party AI agents
- Loss of or unauthorised access to your OpenAI API key
- Any issues arising from websites visited in the embedded browser

OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS SHALL NOT EXCEED **AUD $0** (THE PRICE YOU PAID FOR THE APP).

## 12. Indemnification

You agree to indemnify, defend, and hold harmless Cosmos One from and against any claims, liabilities, damages, losses, and expenses arising out of or in connection with:

- Your use of the App
- Your violation of these Terms
- Your violation of any third-party rights
- Content you create, edit, commit, or push using the App
- Commands you execute in terminal sessions
- Your use of the AI commit message feature and the diffs you send to OpenAI
- Your use of third-party AI agents launched through the App

## 13. Termination

### 13.1 By You

You may stop using Cosmos Terminal at any time. To completely remove the App and its data:

1. Uninstall Cosmos Terminal
2. Delete the settings directory: `%APPDATA%\com.cosmos.terminal\`
3. Optionally delete WebView2 data: `%LocalAppData%\EBWebView\`
4. Revoke or rotate your OpenAI API key if you provided one

### 13.2 By Us

We reserve the right to discontinue the App at any time. Since the App runs entirely locally, discontinuation would only affect future updates and downloads — your installed copy would continue to function.

### 13.3 Effect of Termination

Upon termination, your licence to use the App ceases. Local data remains on your machine until you delete it. No server-side data exists.

## 14. Changes to the Service

We reserve the right to modify, suspend, or discontinue any aspect of Cosmos Terminal at any time, with or without notice. We shall not be liable to you or any third party for any modification, suspension, or discontinuance of the App.

Since Cosmos Terminal runs locally with no backend dependency, existing installed versions will continue to function independently of any changes we make.

## 15. Changes to These Terms

We may update these Terms from time to time. The "Last Updated" date at the top reflects the most recent revision. Changes will be noted in the application's release notes where practical.

Your continued use of Cosmos Terminal after changes constitutes acceptance of the updated Terms.

## 16. Governing Law

These Terms shall be governed by and construed in accordance with the laws of **Australia**, without regard to conflict of law principles. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts of Australia.

Nothing in these Terms limits any rights you may have under the Australian Consumer Law or other mandatory consumer protection legislation in your jurisdiction.

## 17. Severability

If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that these Terms shall otherwise remain in full force and effect.

## 18. Entire Agreement

These Terms, together with the [Privacy Policy](privacy-policy.md) and the MIT Licence, constitute the entire agreement between you and Cosmos One regarding the use of Cosmos Terminal, superseding any prior agreements.

## 19. Contact Information

**Email:** [support@cosmosone.cloud](mailto:support@cosmosone.cloud)
**Subject Line:** Cosmos Terminal Terms
**Website:** [https://cosmosone.cloud](https://cosmosone.cloud)
**Response Time:** Within 5 business days
