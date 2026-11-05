# OpenProject for Orca (`mcp-openproject`)

A hybrid **Orca Plugin + Rust MCP Server** for **OpenProject Community Edition (CE)**.

This repository contains two integrated components:

1. **Orca Plugin ([orca-plugin.json](orca-plugin.json), [src/panel.tsx](src/panel.tsx), [src/worker.ts](src/worker.ts))**:
   - **Sidebar Panel (`ui: "components"`)**: Browse OpenProject projects and work packages, filter by project/status/keyword, inspect ticket descriptions and comments, and launch an Orca coding agent (`codex`, `claude`, `omp`, `pi`, `grok`) directly on a ticket with standard `op-<id>-<slug>` branch conventions.
   - **Guarded 2-Step Writes (Preview → Confirm)**: Preview status transitions, comments, and new work packages before confirming writes to OpenProject.
   - **Automatic Agent Environment Hook (`agent.launch.before`)**: Automatically injects `OPENPROJECT_BASE_URL`, `OPENPROJECT_API_TOKEN`, `OPENPROJECT_READ_PROJECTS`, and `OPENPROJECT_WRITE_PROJECTS` when Orca launches an agent CLI.
   - **Status Bar & Command Palette**: Quick status indicator and `OpenProject: Refresh Projects & Tickets` / `OpenProject: Clear Local Ticket Cache` commands.

2. **Rust Stdio MCP Server ([Cargo.toml](Cargo.toml), [rust/main.rs](rust/main.rs))**:
   - Single-binary Model Context Protocol (`JSON-RPC 2.0` over stdio) server written in Rust.
   - **Context-frugal HAL compaction** with `select` field projection to minimize agent token consumption.
   - **Defense-in-depth project allowlists** (`OPENPROJECT_READ_PROJECTS` and `OPENPROJECT_WRITE_PROJECTS`).
   - **Mandatory Preview-then-Confirm (`confirm=true`)** guarded writes with `lockVersion` optimistic concurrency.

---

## Included MCP Tools (Rust Binary)

| Tool | Category | Description |
| :--- | :--- | :--- |
| `get_current_user` | Meta | Verify authentication and inspect the current OpenProject user |
| `list_statuses` | Meta | List workflow statuses (`New`, `In Progress`, `In Review`, `Closed`, etc.) |
| `list_types` | Meta | List work package types (`Task`, `Bug`, `Feature`, `Milestone`, etc.) |
| `list_priorities` | Meta | List work package priorities |
| `list_projects` | Project Read | List accessible projects filtered by `OPENPROJECT_READ_PROJECTS` |
| `get_project` | Project Read | Get project metadata by identifier or numeric ID |
| `get_project_work_package_context` | Project Read | Inspect project statuses and write permissions before transitioning tickets |
| `list_work_packages` | Ticket Read | List work packages by `project`, `status` (`open`/`closed`/`all`), `limit`, and `select` |
| `search_work_packages` | Ticket Read | Search work packages by keyword across subject and description |
| `list_my_open_work_packages` | Ticket Read | List open work packages assigned to the current user |
| `get_work_package` | Ticket Read | Fetch full details of a work package by `id` (supports `select`) |
| `get_work_package_activities` | Ticket Read | Fetch comments and activity logs for a work package |
| `create_work_package` | Guarded Write | Preview (`confirm=false`) then create (`confirm=true`) a work package |
| `update_work_package` | Guarded Write | Preview (`confirm=false`) then update (`confirm=true`) status, subject, description, or comment |
| `add_work_package_comment` | Guarded Write | Preview (`confirm=false`) then post (`confirm=true`) a markdown comment |

---

## Building & Installing the Rust MCP Server

```bash
# Run unit and integration tests
cargo test

# Install the binary into ~/.cargo/bin/mcp-openproject
cargo install --path .
```

### Configuring in Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.openproject]
command = "mcp-openproject"

[mcp_servers.openproject.env]
OPENPROJECT_BASE_URL = "https://openproject.example.com"
OPENPROJECT_API_TOKEN = "opapi-..."
OPENPROJECT_READ_PROJECTS = "my-project,backend-*"
OPENPROJECT_WRITE_PROJECTS = "my-project,backend-*"
```

### Configuring in Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "openproject": {
      "command": "mcp-openproject",
      "env": {
        "OPENPROJECT_BASE_URL": "https://openproject.example.com",
        "OPENPROJECT_API_TOKEN": "opapi-...",
        "OPENPROJECT_READ_PROJECTS": "my-project,backend-*",
        "OPENPROJECT_WRITE_PROJECTS": "my-project,backend-*"
      }
    }
  }
}
```

---

## Validating, Testing & Loading the Orca Plugin

```bash
# Validate manifest offline
orca plugin validate . --json

# Render panel scenarios and check worker handlers
orca plugin check . --json

# Run panel and worker test suites
orca plugin test . --json

# Load in Orca for local development
orca plugin dev load . --json
```

---

## Publishing as a Community Orca Plugin

Orca discovers community plugins directly from your public GitHub repository:

1. Create a public, non-fork GitHub repository (e.g. `IvanHa-dev/mcp-openproject`). The manifest omits the deprecated `publisher` field; Orca derives the publisher from the GitHub repository owner.
2. Review and commit the intended source and `assets/cover.png`, then push that commit. Do not include credentials, local build artifacts, or compiled binaries. The Rust MCP executable is installed separately by users.
3. Run `cargo test`, `orca plugin validate .`, `orca plugin check .`, and `orca plugin test .` against the release contents.
4. Add the `orca-plugin` topic to the repository, using GitHub's About → Topics UI or:
   ```bash
   gh repo edit IvanHa-dev/mcp-openproject --add-topic orca-plugin
   ```
5. Tag the committed release with the `version` in `orca-plugin.json` and push the tag:
   ```bash
   git tag -a v0.1.0 -m v0.1.0
   git push origin v0.1.0
   ```
6. Check `https://www.onorca.dev/plugins/IvanHa-dev/mcp-openproject` for the automated listing result.

---

## Acknowledgments & License

Inspired by [jtauschl/openproject-ce-mcp](https://github.com/jtauschl/openproject-ce-mcp) (MIT License).
Licensed under the [MIT License](LICENSE).
