# OpenProject CE MCP Server & Orca Plugin — Context Handoff

> **Status**: Ready to pull on a new device and continue UI/UX polish + local agent CLI auto-detection before submitting to the Orca Plugin Marketplace under your target GitHub account.

---

## 1. Project Overview

This repository (`/home/ivan/orca/projects/mcp-openproject`) is a **hybrid Rust MCP Server + Orca Plugin** for **OpenProject Community Edition (API v3)**:

1. **Rust MCP Server (`mcp-openproject`)**:
   - Entrypoint: `rust/main.rs` (with `rust/config.rs`, `rust/client.rs`, `rust/tools.rs`).
   - Speaks MCP JSON-RPC 2.0 over `stdio` (both newline-delimited JSON and `Content-Length` framing).
   - 20 tools across `project_read`, `project_write`, `work_package_read`, and `work_package_write` (matching and extending `jtauschl/openproject-ce-mcp` v0.4.0).
   - Server-side OpenProject API v3 filters (`status_id` operator `"o"` for open work packages, `assigned_to_id` `"me"`, project name/slug/ID resolution, `/form` validation previews, batch `get_work_packages`, and `create_subtask`).
   - **Security Hardening (Cloudflare MCP & Google Elephant-Goldfish Model)**:
     - Fail-closed argument & tool-group validation (`validate_tool_arguments` rejects unknown arguments and disabled tools).
     - `curl --config -` stdin header passing so `OPENPROJECT_API_TOKEN` is never exposed in `/proc/<pid>/cmdline`.
     - `MAX_RPC_BYTES` (10 MiB) and `MAX_RESPONSE_BYTES` (5 MiB) memory caps.
     - Strict same-origin + sub-path verification (`ensure_same_origin`) and redirect blocking (`redirect: 'error'`).
     - Fail-closed project scope checking (`OPENPROJECT_READ_PROJECTS`, `OPENPROJECT_WRITE_PROJECTS` with glob support like `esg-*`) and undisclosed project URN (`urn:openproject-org:api:v3:undisclosed`) rejection.

2. **Orca Sidebar Plugin (`local.openproject`)**:
   - Manifest: `orca-plugin.json`.
   - Worker: `src/worker.ts` + `src/openproject-api.ts` + `src/protocol.ts`.
   - UI Panel: `src/panel.tsx`.
   - Unit tests: `src/panel.test.tsx`, `src/worker.test.ts`.
   - Features:
     - Connects to OpenProject API v3, syncs projects, statuses, and open work packages (verified live with 10 projects and all 89 open work packages in `ESG VRG`).
     - Stores API token in `orca.secrets` (`openproject.apiToken`) with fallback discovery from `~/.claude.json` and `~/.codex/config.toml`.
     - Auto-injects `OPENPROJECT_*` environment variables when launching an agent via the `agent.launch.before` hook.

---

## 2. Next Tasks to Complete on Your New Device (UI/UX & Local Agent CLI Detection)

Based on your latest review and screenshots, here are the exact items to implement next (no code changes were made yet per your handoff instruction):

### Task A — Fix Ticket Selection UX (Eliminate Scrolling to Bottom)
- **Problem**: Currently in `src/panel.tsx`, clicking a work package row at the top of `List` renders the `<Card title="#ID: Subject">` detail/action view **below** the entire list of 40–89 items, forcing the user to scroll all the way down to interact with the selected task.
- **Fix to implement**:
  1. Render the **Selected Ticket Detail / Action Card at the TOP** (immediately above the list) OR switch the view into a **Focused Ticket Detail Drawer** with a `← Back to Tickets` button when a ticket is clicked.
  2. Add a quick inline `Launch Agent` / `Open` action directly at the top of the selected ticket card so zero scrolling is required.

### Task B — Remove Redundant Filter Controls
- **Problem**: In `src/panel.tsx` (Row 2 of the `Tickets` tab), there are both status filter pill buttons (`Open | In Progress | Closed | All`) AND a duplicate `Select` dropdown (`Open / All`) on the right.
- **Fix to implement**:
  1. Remove the redundant right-side status `Select` dropdown or keep only a single clean row of filter controls matching Orca's native GitLab/GitHub Tasks header.

### Task C — Dynamic Local Agent CLI Detection (Include Antigravity / `agy`)
- **Problem**: Currently `orca-plugin.json` and `src/panel.tsx` use a **hardcoded list** of 5 agents (`Codex`, `Claude Code`, `OMP`, `Pi`, `Grok`), missing **Antigravity** (`antigravity` / `agy`) and other locally installed agent CLIs.
- **Fix to implement**:
  1. In `src/worker.ts`, dynamically detect installed agent CLIs on the local machine (`PATH` / `~/.local/bin` / `~/.gemini/antigravity-cli` / Orca's supported agents: `antigravity` / `agy`, `claude`, `codex`, `gemini`, `opencode`, `kilocode`, `cursor-agent`, `droid`, `omp`, `pi`, `grok`).
  2. Return `detectedAgents: Array<{ id: string; label: string; installed: boolean; binPath?: string }>` in `OpenProjectStateSnapshot`.
  3. Populate the `Default Agent CLI` dropdown in `src/panel.tsx` dynamically from `detectedAgents` (showing installed local agents like **Antigravity (`agy`)**, **Claude Code**, **Codex**, etc.).
  4. In the `Setup & MCP` tab (`Rust MCP Server Config` card), dynamically show the MCP configuration snippet (and a 1-click "Register MCP in Agent Config" button) for the currently selected agent (**Antigravity**, **Claude Code**, or **Codex**) instead of only showing a static `Codex config.toml` block.

---

## 3. Quick Commands on Your Next Device

### Clone & Verify
```bash
git clone https://github.com/briannguyen9489032-beep/mcp-openproject.git
cd mcp-openproject

# 1. Build & test the Rust MCP server binary
cargo test
cargo build --release
mkdir -p ~/.local/bin
cp target/release/mcp-openproject ~/.local/bin/mcp-openproject

# 2. Validate & test the Orca plugin
orca plugin validate .
orca plugin check .
orca plugin test .

# 3. Load into live Orca for development
orca plugin dev load .
orca plugin open local.openproject
```

### Switching GitHub Account Later for Final Orca Submission
When you are ready to publish under your target GitHub account (`<NEW_GITHUB_USERNAME>`):
```bash
# 1. Update publisher in orca-plugin.json and Cargo.toml
# 2. Rewrite git author if desired:
git config user.name "<NEW_NAME>"
git config user.email "<NEW_EMAIL>"
git commit --amend --reset-author --no-edit

# 3. Point remote to your new GitHub account repository and push:
gh auth login
git remote set-url origin https://github.com/<NEW_GITHUB_USERNAME>/mcp-openproject.git
git push -u origin main
```
