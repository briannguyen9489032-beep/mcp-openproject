use crate::client::{compact_project, compact_work_package, OpenProjectClient};
use crate::config::validate_path_segment;
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use url::form_urlencoded;

pub fn list_tool_definitions(client: &OpenProjectClient) -> Vec<Value> {
    let mut tools = vec![
        json!({
            "name": "get_current_user",
            "description": "Fetch the currently authenticated OpenProject user and verify connectivity.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }),
        json!({
            "name": "list_statuses",
            "description": "List all work package statuses configured in OpenProject.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }),
        json!({
            "name": "list_types",
            "description": "List all work package types (Task, Bug, Feature, Epic, Milestone, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }),
        json!({
            "name": "list_priorities",
            "description": "List all work package priorities configured in OpenProject.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }),
    ];

    if !client.config.read_projects.is_empty() && client.config.enable_project_read {
        tools.push(json!({
            "name": "list_projects",
            "description": "List accessible OpenProject projects filtered by OPENPROJECT_READ_PROJECTS.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "search": {
                        "type": "string",
                        "description": "Optional name or identifier substring filter."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum projects to return (default 100)."
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Page offset (default 1)."
                    },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional field projection (e.g. [\"id\", \"identifier\", \"name\"])."
                    }
                },
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "get_project",
            "description": "Get details for one OpenProject project by ID, identifier, or exact name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": ["string", "integer"],
                        "description": "Project identifier (e.g. \"my-project\"), name (\"My Project\"), or numeric ID."
                    },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional field projection."
                    }
                },
                "required": ["project"],
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "get_project_work_package_context",
            "description": "Fetch available statuses, types, priorities, and project metadata needed before creating or transitioning work packages.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": ["string", "integer"],
                        "description": "Project identifier, name, or numeric ID."
                    }
                },
                "required": ["project"],
                "additionalProperties": false
            }
        }));
    }

    if !client.config.read_projects.is_empty() && client.config.enable_work_package_read {
        tools.push(json!({
            "name": "list_work_packages",
            "description": "List work packages with server-side OpenProject filters (project, open_only, status, type, priority, assignee, assignee_me, offset, limit, select).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": ["string", "integer"],
                        "description": "Optional project identifier (\"my-project\"), name (\"My Project\"), or numeric ID."
                    },
                    "open_only": {
                        "type": "boolean",
                        "description": "When true, restrict to open work packages server-side (status_id operator 'o')."
                    },
                    "status": {
                        "type": "string",
                        "description": "Filter by status: \"open\", \"closed\", \"all\", or a specific status name (e.g. \"In progress\", \"Developed\", \"New\")."
                    },
                    "type": {
                        "type": "string",
                        "description": "Optional work package type name (e.g. \"Task\", \"Epic\", \"Bug\")."
                    },
                    "priority": {
                        "type": "string",
                        "description": "Optional priority name (e.g. \"Normal\", \"High\")."
                    },
                    "assignee": {
                        "type": "string",
                        "description": "Optional assignee name or 'me'."
                    },
                    "assignee_me": {
                        "type": "boolean",
                        "description": "When true, restrict to work packages assigned to the authenticated user."
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Page number starting at 1 (default 1)."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum items to return (default 50, max 100)."
                    },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Context-frugal field list, e.g. [\"id\", \"subject\", \"status\", \"assignee\"]."
                    }
                },
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "search_work_packages",
            "description": "Search work packages by subject, ID, or keyword across allowed projects.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword to match against subject or description."
                    },
                    "search": {
                        "type": "string",
                        "description": "Alias for query."
                    },
                    "project": {
                        "type": ["string", "integer"],
                        "description": "Optional project identifier, name, or ID."
                    },
                    "open_only": {
                        "type": "boolean",
                        "description": "When true, restrict to open work packages."
                    },
                    "status": {
                        "type": "string",
                        "description": "Optional status filter (\"open\", \"closed\", \"all\", or status name)."
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Page offset (default 1)."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum results to return (default 50)."
                    },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "list_my_open_work_packages",
            "description": "List open work packages assigned to the authenticated user.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "offset": { "type": "integer" },
                    "limit": { "type": "integer" },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "get_work_package",
            "description": "Fetch full details of a work package by numeric id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": ["integer", "string"],
                        "description": "Work package ID."
                    },
                    "work_package_id": {
                        "type": ["integer", "string"],
                        "description": "Alias for id."
                    },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "get_work_packages",
            "description": "Batch-read multiple work packages by numeric IDs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": { "type": ["integer", "string"] },
                        "description": "List of work package IDs to fetch."
                    },
                    "select": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["ids"],
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "get_work_package_activities",
            "description": "Fetch comments and activity history for a work package.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": ["integer", "string"],
                        "description": "Work package ID."
                    },
                    "work_package_id": {
                        "type": ["integer", "string"],
                        "description": "Alias for id."
                    }
                },
                "additionalProperties": false
            }
        }));
    }

    if !client.config.read_projects.is_empty()
        && !client.config.write_projects.is_empty()
        && client.config.enable_work_package_write
    {
        tools.push(json!({
            "name": "create_work_package",
            "description": "Guarded write (preview-then-confirm): Create a work package in an allowed project. Call first with confirm=false (default) to preview, then with confirm=true to execute.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": ["string", "integer"],
                        "description": "Target project identifier (\"my-project\"), name (\"My Project\"), or numeric ID."
                    },
                    "subject": {
                        "type": "string",
                        "description": "Work package subject/title."
                    },
                    "description": {
                        "type": "string",
                        "description": "Markdown description."
                    },
                    "type": {
                        "type": ["string", "integer"],
                        "description": "Work package type name (e.g. \"Task\", \"Bug\", \"Epic\") or numeric ID."
                    },
                    "type_id": {
                        "type": "integer",
                        "description": "Optional numeric type ID (default 1)."
                    },
                    "parent_work_package_id": {
                        "type": ["integer", "string"],
                        "description": "Optional parent work package ID (e.g. Epic #707)."
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Optional start date (YYYY-MM-DD)."
                    },
                    "due_date": {
                        "type": "string",
                        "description": "Optional due date (YYYY-MM-DD)."
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Set to true to execute after reviewing the preview."
                    }
                },
                "required": ["project", "subject"],
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "create_subtask",
            "description": "Guarded write (preview-then-confirm): Create a child work package under an existing parent work package.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "parent_work_package_id": {
                        "type": ["integer", "string"],
                        "description": "Parent work package numeric ID (e.g. 707)."
                    },
                    "subject": {
                        "type": "string",
                        "description": "Subtask subject/title."
                    },
                    "type": {
                        "type": ["string", "integer"],
                        "description": "Work package type name (default \"Task\") or ID."
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional markdown description."
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Set to true to execute after reviewing the preview."
                    }
                },
                "required": ["parent_work_package_id", "subject"],
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "update_work_package",
            "description": "Guarded write (preview-then-confirm): Update a work package's status, subject, description, or comment. Call first without confirm=true to preview changes, then with confirm=true to write.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": ["integer", "string"],
                        "description": "Work package ID."
                    },
                    "work_package_id": {
                        "type": ["integer", "string"],
                        "description": "Alias for id."
                    },
                    "status": {
                        "type": "string",
                        "description": "Target status name (e.g. \"In progress\", \"Developed\", \"In testing\", \"Closed\") or numeric ID."
                    },
                    "subject": {
                        "type": "string",
                        "description": "Updated subject."
                    },
                    "description": {
                        "type": "string",
                        "description": "Updated markdown description."
                    },
                    "comment": {
                        "type": "string",
                        "description": "Optional comment to attach with the update."
                    },
                    "lock_version": {
                        "type": "integer",
                        "description": "Optional optimistic lock version from preview/get to prevent concurrent overwrite."
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Set to true to execute the write."
                    }
                },
                "additionalProperties": false
            }
        }));

        tools.push(json!({
            "name": "add_work_package_comment",
            "description": "Guarded write (preview-then-confirm): Post a markdown comment to a work package. Set confirm=true to execute.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": ["integer", "string"],
                        "description": "Work package ID."
                    },
                    "work_package_id": {
                        "type": ["integer", "string"],
                        "description": "Alias for id."
                    },
                    "comment": {
                        "type": "string",
                        "description": "Markdown comment content."
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Set to true to post the comment."
                    }
                },
                "required": ["comment"],
                "additionalProperties": false
            }
        }));
    }

    tools
}

pub fn validate_tool_arguments(
    client: &OpenProjectClient,
    name: &str,
    args: &Value,
) -> Result<()> {
    let tools = list_tool_definitions(client);
    let Some(tool_def) = tools
        .iter()
        .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(name))
    else {
        bail!("Unknown or disabled tool: {}", name);
    };
    let Some(arg_obj) = args.as_object() else {
        bail!(
            "[validation_error] Tool arguments for '{}' must be a JSON object",
            name
        );
    };
    let allowed: Vec<String> = tool_def
        .get("inputSchema")
        .and_then(|s| s.get("properties"))
        .and_then(|p| p.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();

    let mut unknown: Vec<&str> = arg_obj
        .keys()
        .filter(|k| !allowed.iter().any(|a| a == *k))
        .map(|s| s.as_str())
        .collect();
    unknown.sort_unstable();

    if !unknown.is_empty() {
        let mut allowed_sorted = allowed;
        allowed_sorted.sort_unstable();
        bail!(
            "[validation_error] Unknown argument(s) for tool '{}': {}. Allowed arguments: {}",
            name,
            unknown.join(", "),
            allowed_sorted.join(", ")
        );
    }
    Ok(())
}

fn parse_select_arg(args: &Value) -> Option<Vec<String>> {
    args.get("select")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
}

fn extract_wp_id(args: &Value) -> Result<i64> {
    let raw = args
        .get("id")
        .or_else(|| args.get("work_package_id"))
        .or_else(|| args.get("parent_work_package_id"))
        .ok_or_else(|| anyhow!("Missing required parameter 'id' or 'work_package_id'"))?;
    parse_positive_id(raw)
}

fn parse_positive_id(raw: &Value) -> Result<i64> {
    if let Some(n) = raw.as_i64() {
        if n > 0 {
            return Ok(n);
        }
    }
    if let Some(s) = raw.as_str() {
        let trimmed = s.trim().trim_start_matches('#');
        if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(n) = trimmed.parse::<i64>() {
                if n > 0 {
                    return Ok(n);
                }
            }
        }
    }
    bail!("[validation_error] Invalid positive work package id: {}", raw)
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Resolves a caller-supplied project reference (numeric ID, slug identifier like "my-project",
/// or display name like "My Project") to a safe URL path segment (identifier or numeric ID).
fn resolve_project_segment(
    client: &OpenProjectClient,
    raw_ref: &str,
    write: bool,
) -> Result<String> {
    let trimmed = raw_ref.trim();
    if trimmed.is_empty() {
        bail!("[validation_error] Parameter 'project' must not be empty");
    }

    // If it contains spaces or non-slug characters (e.g. "My Project" or "Dự án Mẫu"),
    // look up the canonical identifier from /api/v3/projects.
    let resolved_ident = if validate_path_segment(trimmed, "project").is_ok() {
        trimmed.to_string()
    } else {
        let raw = client.request_json("GET", "/api/v3/projects?pageSize=100", None)?;
        let elements = raw
            .get("_embedded")
            .and_then(|e| e.get("elements"))
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default();
        let matched = elements.iter().find(|el| {
            let name = el.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            let ident = el
                .get("identifier")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            name.eq_ignore_ascii_case(trimmed) || ident.eq_ignore_ascii_case(trimmed)
        });
        match matched
            .and_then(|m| m.get("identifier"))
            .and_then(|v| v.as_str())
        {
            Some(ident) => validate_path_segment(ident, "project")?.to_string(),
            None => bail!("Project '{}' not found in OpenProject", trimmed),
        }
    };

    let allowed = if write {
        client.config.can_write_project(&resolved_ident)
    } else {
        client.config.can_read_project(&resolved_ident)
    };
    if !allowed {
        let var_name = if write {
            "OPENPROJECT_WRITE_PROJECTS"
        } else {
            "OPENPROJECT_READ_PROJECTS"
        };
        bail!(
            "403 Forbidden / Project Scope: project '{}' is not in {}",
            resolved_ident,
            var_name
        );
    }
    Ok(resolved_ident)
}

fn resolve_type_id(client: &OpenProjectClient, args: &Value) -> Result<i64> {
    if let Some(id) = args.get("type_id").and_then(|v| v.as_i64()) {
        return Ok(id);
    }
    let Some(type_val) = args.get("type") else {
        return Ok(1);
    };
    if let Some(id) = type_val.as_i64() {
        return Ok(id);
    }
    let name = type_val.as_str().unwrap_or_default().trim();
    if name.is_empty() {
        return Ok(1);
    }
    if let Ok(num) = name.parse::<i64>() {
        return Ok(num);
    }
    if let Ok(raw) = client.request_json("GET", "/api/v3/types", None) {
        if let Some(elements) = raw
            .get("_embedded")
            .and_then(|e| e.get("elements"))
            .and_then(|a| a.as_array())
        {
            if let Some(found) = elements.iter().find(|el| {
                el.get("name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            }) {
                if let Some(id) = found.get("id").and_then(|v| v.as_i64()) {
                    return Ok(id);
                }
            }
        }
    }
    Ok(1)
}

fn extract_form_validation_errors(form_resp: &Value) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let Some(errs) = form_resp
        .get("_embedded")
        .and_then(|e| e.get("validationErrors"))
        .and_then(|v| v.as_object())
    else {
        return out;
    };
    for (field, detail) in errs {
        let msg = detail
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Invalid field value");
        out.insert(field.clone(), json!(msg));
    }
    out
}

pub fn call_tool(client: &OpenProjectClient, name: &str, args: &Value) -> Result<Value> {
    validate_tool_arguments(client, name, args)?;

    let select = parse_select_arg(args);
    let select_ref = select.as_deref();

    match name {
        "get_current_user" => {
            let raw = client.request_json("GET", "/api/v3/users/me", None)?;
            Ok(json!({
                "id": raw.get("id").cloned().unwrap_or(json!(0)),
                "name": raw.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                "login": raw.get("login").and_then(|v| v.as_str()).unwrap_or_default(),
                "email": raw.get("email").and_then(|v| v.as_str()).unwrap_or_default(),
                "status": raw.get("status").and_then(|v| v.as_str()).unwrap_or("active"),
            }))
        }

        "list_statuses" => {
            let raw = client.request_json("GET", "/api/v3/statuses", None)?;
            let elements = raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            let statuses: Vec<Value> = elements
                .iter()
                .map(|el| {
                    json!({
                        "id": el.get("id").cloned().unwrap_or(json!(0)),
                        "name": el.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                        "is_closed": el.get("isClosed").and_then(|v| v.as_bool()).unwrap_or(false),
                    })
                })
                .collect();
            Ok(json!({ "total": statuses.len(), "statuses": statuses }))
        }

        "list_types" => {
            let raw = client.request_json("GET", "/api/v3/types", None)?;
            let elements = raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            let types: Vec<Value> = elements
                .iter()
                .map(|el| {
                    json!({
                        "id": el.get("id").cloned().unwrap_or(json!(0)),
                        "name": el.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                        "is_milestone": el.get("isMilestone").and_then(|v| v.as_bool()).unwrap_or(false),
                    })
                })
                .collect();
            Ok(json!({ "total": types.len(), "types": types }))
        }

        "list_priorities" => {
            let raw = client.request_json("GET", "/api/v3/priorities", None)?;
            let elements = raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            let priorities: Vec<Value> = elements
                .iter()
                .map(|el| {
                    json!({
                        "id": el.get("id").cloned().unwrap_or(json!(0)),
                        "name": el.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                        "is_default": el.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false),
                    })
                })
                .collect();
            Ok(json!({ "total": priorities.len(), "priorities": priorities }))
        }

        "list_projects" => {
            let raw = client.request_json("GET", "/api/v3/projects?pageSize=100", None)?;
            let search = args
                .get("search")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_lowercase();
            let elements = raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            let projects: Vec<Value> = elements
                .iter()
                .filter(|el| {
                    let ident = el
                        .get("identifier")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let id_str = el.get("id").map(value_to_string).unwrap_or_default();
                    let name_str = el
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    if !search.is_empty()
                        && !ident.to_lowercase().contains(&search)
                        && !name_str.to_lowercase().contains(&search)
                    {
                        return false;
                    }
                    client.config.can_read_project(ident)
                        || client.config.can_read_project(&id_str)
                })
                .map(|el| compact_project(el, select_ref, &client.config))
                .collect();
            Ok(json!({ "total": projects.len(), "projects": projects, "results": projects }))
        }

        "get_project" => {
            let proj_raw = args
                .get("project")
                .map(value_to_string)
                .unwrap_or_default();
            let proj = resolve_project_segment(client, &proj_raw, false)?;
            let raw = client.request_json("GET", &format!("/api/v3/projects/{}", proj), None)?;
            let fetched_ident = raw
                .get("identifier")
                .and_then(|v| v.as_str())
                .unwrap_or(&proj);
            let fetched_id = raw.get("id").map(value_to_string).unwrap_or_default();
            if !client.config.can_read_project(fetched_ident)
                && !client.config.can_read_project(&fetched_id)
            {
                bail!(
                    "403 Forbidden / Project Scope: resolved project '{}' is not in OPENPROJECT_READ_PROJECTS",
                    fetched_ident
                );
            }
            Ok(compact_project(&raw, select_ref, &client.config))
        }

        "get_project_work_package_context" => {
            let proj_raw = args
                .get("project")
                .map(value_to_string)
                .unwrap_or_default();
            let proj = resolve_project_segment(client, &proj_raw, false)?;
            let project_raw =
                client.request_json("GET", &format!("/api/v3/projects/{}", proj), None)?;
            let statuses_raw = client.request_json("GET", "/api/v3/statuses", None)?;
            let statuses: Vec<Value> = statuses_raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|s| {
                            json!({
                                "id": s.get("id").cloned().unwrap_or(json!(0)),
                                "name": s.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
                                "is_closed": s.get("isClosed").and_then(|v| v.as_bool()).unwrap_or(false)
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            Ok(json!({
                "project": compact_project(&project_raw, None, &client.config),
                "writable": client.config.can_write_project(&proj),
                "statuses": statuses
            }))
        }

        "list_work_packages" | "search_work_packages" | "list_my_open_work_packages" => {
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(50)
                .min(100);
            let offset = args
                .get("offset")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .max(1);
            let project_filter_raw = args
                .get("project")
                .map(value_to_string)
                .unwrap_or_default();

            let open_only = args
                .get("open_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                || name == "list_my_open_work_packages";
            let assignee_me = args
                .get("assignee_me")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                || name == "list_my_open_work_packages"
                || args
                    .get("assignee")
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case("me"))
                    .unwrap_or(false);

            let status_filter = if open_only {
                "open".to_string()
            } else {
                args.get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase()
            };

            let mut op_filters: Vec<Value> = Vec::new();
            if status_filter == "open" {
                op_filters.push(json!({ "status_id": { "operator": "o", "values": [] } }));
            } else if status_filter == "closed" {
                op_filters.push(json!({ "status_id": { "operator": "c", "values": [] } }));
            }
            if assignee_me {
                op_filters.push(json!({ "assigned_to_id": { "operator": "=", "values": ["me"] } }));
            }

            let base_endpoint = if !project_filter_raw.is_empty() {
                let project_filter = resolve_project_segment(client, &project_filter_raw, false)?;
                format!("/api/v3/projects/{}/work_packages", project_filter)
            } else {
                "/api/v3/work_packages".to_string()
            };

            let endpoint = if op_filters.is_empty() && offset == 1 {
                format!("{}?pageSize={}", base_endpoint, limit)
            } else {
                let mut serializer = form_urlencoded::Serializer::new(String::new());
                serializer.append_pair("offset", &offset.to_string());
                serializer.append_pair("pageSize", &limit.to_string());
                if !op_filters.is_empty() {
                    let filters_json = serde_json::to_string(&op_filters).unwrap_or_default();
                    serializer.append_pair("filters", &filters_json);
                }
                format!("{}?{}", base_endpoint, serializer.finish())
            };

            let raw = client.request_json("GET", &endpoint, None)?;
            let server_total = raw.get("total").and_then(|v| v.as_u64());
            let elements = raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();

            let query_filter = args
                .get("query")
                .or_else(|| args.get("search"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_lowercase();
            let type_filter = args
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_lowercase();
            let priority_filter = args
                .get("priority")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_lowercase();
            let assignee_filter = args
                .get("assignee")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_lowercase();

            let items: Vec<Value> = elements
                .iter()
                .filter(|el| client.config.check_work_package_project_link(el, false).is_ok())
                .map(|el| compact_work_package(el, None, &client.config))
                .filter(|wp| {
                    if status_filter.is_empty() || status_filter == "all" {
                        return true;
                    }
                    let st = wp
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_lowercase();
                    let is_closed = matches!(st.as_str(), "closed" | "rejected" | "resolved");
                    if status_filter == "open" {
                        !is_closed
                    } else if status_filter == "closed" {
                        is_closed
                    } else {
                        st == status_filter
                    }
                })
                .filter(|wp| {
                    if type_filter.is_empty() {
                        return true;
                    }
                    wp.get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_lowercase()
                        == type_filter
                })
                .filter(|wp| {
                    if priority_filter.is_empty() {
                        return true;
                    }
                    wp.get("priority")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_lowercase()
                        == priority_filter
                })
                .filter(|wp| {
                    if assignee_filter.is_empty() || assignee_filter == "me" {
                        return true;
                    }
                    wp.get("assignee")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_lowercase()
                        .contains(&assignee_filter)
                })
                .filter(|wp| {
                    if query_filter.is_empty() {
                        return true;
                    }
                    let id_str = wp.get("id").map(value_to_string).unwrap_or_default();
                    let subj = wp
                        .get("subject")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_lowercase();
                    let desc = wp
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_lowercase();
                    id_str.contains(&query_filter)
                        || subj.contains(&query_filter)
                        || desc.contains(&query_filter)
                })
                .map(|wp| crate::client::project_fields(wp, select_ref))
                .collect();

            let count = items.len() as u64;
            let total = server_total.unwrap_or(count);
            Ok(json!({
                "offset": offset,
                "limit": limit,
                "count": count,
                "total": total,
                "work_packages": items,
                "results": items
            }))
        }

        "get_work_package" => {
            let id = extract_wp_id(args)?;
            let raw = client.request_json("GET", &format!("/api/v3/work_packages/{}", id), None)?;
            client.config.check_work_package_project_link(&raw, false)?;
            let full = compact_work_package(&raw, select_ref, &client.config);
            Ok(full)
        }

        "get_work_packages" => {
            let Some(ids_arr) = args.get("ids").and_then(|v| v.as_array()) else {
                bail!("Parameter 'ids' must be a non-empty array of work package IDs");
            };
            if ids_arr.is_empty() || ids_arr.len() > 100 {
                bail!("Parameter 'ids' must contain between 1 and 100 IDs");
            }
            let mut results = Vec::new();
            for raw_id in ids_arr {
                let id = parse_positive_id(raw_id)?;
                match client.request_json("GET", &format!("/api/v3/work_packages/{}", id), None) {
                    Ok(raw) => {
                        if client.config.check_work_package_project_link(&raw, false).is_ok() {
                            results.push(compact_work_package(&raw, select_ref, &client.config));
                        }
                    }
                    Err(e) => {
                        results.push(json!({ "id": id, "error": e.to_string() }));
                    }
                }
            }
            Ok(json!({
                "total": results.len(),
                "work_packages": results,
                "results": results
            }))
        }

        "get_work_package_activities" => {
            let id = extract_wp_id(args)?;
            let wp_raw =
                client.request_json("GET", &format!("/api/v3/work_packages/{}", id), None)?;
            client.config.check_work_package_project_link(&wp_raw, false)?;

            let act_raw = client.request_json(
                "GET",
                &format!("/api/v3/work_packages/{}/activities", id),
                None,
            )?;
            let elements = act_raw
                .get("_embedded")
                .and_then(|e| e.get("elements"))
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();

            let activities: Vec<Value> = elements
                .iter()
                .filter_map(|el| {
                    let comment = el
                        .get("comment")
                        .and_then(|c| c.get("raw"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .trim();
                    if comment.is_empty() {
                        return None;
                    }
                    let user = el
                        .get("_links")
                        .and_then(|l| l.get("user"))
                        .and_then(|u| u.get("title"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("System");
                    Some(json!({
                        "id": el.get("id").cloned().unwrap_or(json!(0)),
                        "user": user,
                        "comment": comment,
                        "created_at": el.get("createdAt").and_then(|v| v.as_str()).unwrap_or_default()
                    }))
                })
                .collect();

            Ok(json!({
                "work_package_id": id,
                "total": activities.len(),
                "activities": activities
            }))
        }

        "create_work_package" | "create_subtask" => {
            let (proj, parent_id) = if name == "create_subtask" {
                let p_id = parse_positive_id(
                    args.get("parent_work_package_id")
                        .ok_or_else(|| anyhow!("Missing parent_work_package_id"))?,
                )?;
                let parent_raw =
                    client.request_json("GET", &format!("/api/v3/work_packages/{}", p_id), None)?;
                client
                    .config
                    .check_work_package_project_link(&parent_raw, true)?;
                let parent_proj_href = parent_raw
                    .get("_links")
                    .and_then(|l| l.get("project"))
                    .and_then(|p| p.get("href"))
                    .and_then(|h| h.as_str())
                    .unwrap_or_default();
                let slug = parent_proj_href
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or_default();
                (validate_path_segment(slug, "project")?.to_string(), Some(p_id))
            } else {
                let proj_raw = args
                    .get("project")
                    .map(value_to_string)
                    .unwrap_or_default();
                let resolved_proj = resolve_project_segment(client, &proj_raw, true)?;
                let opt_parent = match args.get("parent_work_package_id") {
                    Some(v) if !v.is_null() => Some(parse_positive_id(v)?),
                    _ => None,
                };
                (resolved_proj, opt_parent)
            };

            let subject = args
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim();
            let description = args
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim();
            let type_id = resolve_type_id(client, args)?;
            let confirm = args
                .get("confirm")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if subject.is_empty() {
                bail!("Parameter 'subject' is required");
            }
            client.config.ensure_work_package_field_writable("subject")?;
            if args.get("type_id").is_some() || args.get("type").is_some() {
                client.config.ensure_work_package_field_writable("type")?;
            }
            if !description.is_empty() {
                client
                    .config
                    .ensure_work_package_field_writable("description")?;
            }

            let mut links = serde_json::Map::new();
            links.insert(
                "type".to_string(),
                json!({ "href": format!("/api/v3/types/{}", type_id) }),
            );
            if let Some(pid) = parent_id {
                links.insert(
                    "parent".to_string(),
                    json!({ "href": format!("/api/v3/work_packages/{}", pid) }),
                );
            }

            let mut payload_map = serde_json::Map::new();
            payload_map.insert("subject".to_string(), json!(subject));
            payload_map.insert(
                "description".to_string(),
                json!({ "format": "markdown", "raw": description }),
            );
            if let Some(sd) = args.get("start_date").and_then(|v| v.as_str()) {
                if !sd.trim().is_empty() {
                    payload_map.insert("startDate".to_string(), json!(sd.trim()));
                }
            }
            if let Some(dd) = args.get("due_date").and_then(|v| v.as_str()) {
                if !dd.trim().is_empty() {
                    payload_map.insert("dueDate".to_string(), json!(dd.trim()));
                }
            }
            payload_map.insert("_links".to_string(), Value::Object(links));
            let payload = Value::Object(payload_map);

            if let Ok(form_resp) = client.request_json(
                "POST",
                &format!("/api/v3/projects/{}/work_packages/form", proj),
                Some(&payload),
            ) {
                let validation_errors = extract_form_validation_errors(&form_resp);
                if !validation_errors.is_empty() {
                    return Ok(json!({
                        "status": if confirm { "invalid" } else { "rejected" },
                        "ready": false,
                        "preview": !confirm,
                        "confirmed": false,
                        "action": name,
                        "project": proj,
                        "validation_errors": validation_errors,
                        "message": "OpenProject rejected the proposed work package via /form validation. Fix validation_errors before confirming."
                    }));
                }
            }

            if !confirm {
                return Ok(json!({
                    "status": "write_unconfirmed",
                    "ready": true,
                    "preview": true,
                    "confirmed": false,
                    "action": name,
                    "project": proj,
                    "proposed": {
                        "subject": subject,
                        "description": description,
                        "type_id": type_id,
                        "parent_work_package_id": parent_id
                    },
                    "validation_errors": {},
                    "message": format!("Preview validated. Call {} again with confirm=true to execute.", name)
                }));
            }

            let created_raw = client.request_json(
                "POST",
                &format!("/api/v3/projects/{}/work_packages", proj),
                Some(&payload),
            )?;
            Ok(json!({
                "preview": false,
                "confirmed": true,
                "action": name,
                "work_package": compact_work_package(&created_raw, None, &client.config)
            }))
        }

        "update_work_package" => {
            let id = extract_wp_id(args)?;
            let confirm = args
                .get("confirm")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let current_raw =
                client.request_json("GET", &format!("/api/v3/work_packages/{}", id), None)?;
            client.config.check_work_package_project_link(&current_raw, true)?;
            let current = compact_work_package(&current_raw, None, &client.config);

            let server_lock_version = current_raw
                .get("lockVersion")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let lock_version = args
                .get("lock_version")
                .and_then(|v| v.as_i64())
                .unwrap_or(server_lock_version);
            if lock_version != server_lock_version {
                bail!(
                    "409 Conflict: work package #{} lockVersion changed on server (expected {}, found {})",
                    id,
                    lock_version,
                    server_lock_version
                );
            }

            let mut patch_obj = serde_json::Map::new();
            patch_obj.insert("lockVersion".to_string(), json!(lock_version));
            let mut changes = serde_json::Map::new();

            if let Some(new_subj) = args.get("subject").and_then(|v| v.as_str()) {
                let trimmed = new_subj.trim();
                if !trimmed.is_empty() {
                    client.config.ensure_work_package_field_writable("subject")?;
                    patch_obj.insert("subject".to_string(), json!(trimmed));
                    changes.insert(
                        "subject".to_string(),
                        json!({
                            "from": current.get("subject").cloned().unwrap_or(json!("")),
                            "to": trimmed
                        }),
                    );
                }
            }

            if let Some(new_desc) = args.get("description").and_then(|v| v.as_str()) {
                client
                    .config
                    .ensure_work_package_field_writable("description")?;
                patch_obj.insert(
                    "description".to_string(),
                    json!({ "format": "markdown", "raw": new_desc }),
                );
                changes.insert("description".to_string(), json!({ "to": new_desc }));
            }

            if let Some(comment_str) = args.get("comment").and_then(|v| v.as_str()) {
                let trimmed = comment_str.trim();
                if !trimmed.is_empty() {
                    client.config.ensure_work_package_field_writable("comment")?;
                    patch_obj.insert("comment".to_string(), json!({ "raw": trimmed }));
                    changes.insert("comment".to_string(), json!({ "to": trimmed }));
                }
            }

            if let Some(status_arg) = args.get("status").and_then(|v| v.as_str()) {
                let trimmed = status_arg.trim();
                if !trimmed.is_empty() {
                    client.config.ensure_work_package_field_writable("status")?;
                    let resolved_status_id = if let Ok(num_id) = trimmed.parse::<i64>() {
                        num_id
                    } else {
                        let statuses_raw = client.request_json("GET", "/api/v3/statuses", None)?;
                        let elements = statuses_raw
                            .get("_embedded")
                            .and_then(|e| e.get("elements"))
                            .and_then(|a| a.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let matched = elements.iter().find(|el| {
                            el.get("name")
                                .and_then(|v| v.as_str())
                                .map(|n| n.eq_ignore_ascii_case(trimmed))
                                .unwrap_or(false)
                        });
                        match matched.and_then(|m| m.get("id")).and_then(|v| v.as_i64()) {
                            Some(sid) => sid,
                            None => bail!(
                                "invalid_status: Status '{}' not found. Call list_statuses() to inspect valid statuses.",
                                trimmed
                            ),
                        }
                    };

                    patch_obj.insert(
                        "_links".to_string(),
                        json!({
                            "status": {
                                "href": format!("/api/v3/statuses/{}", resolved_status_id)
                            }
                        }),
                    );
                    changes.insert(
                        "status".to_string(),
                        json!({
                            "from": current.get("status").cloned().unwrap_or(json!("")),
                            "to": trimmed,
                            "status_id": resolved_status_id
                        }),
                    );
                }
            }

            let patch_val = Value::Object(patch_obj);
            if let Ok(form_resp) = client.request_json(
                "POST",
                &format!("/api/v3/work_packages/{}/form", id),
                Some(&patch_val),
            ) {
                let validation_errors = extract_form_validation_errors(&form_resp);
                if !validation_errors.is_empty() {
                    return Ok(json!({
                        "status": if confirm { "invalid" } else { "rejected" },
                        "ready": false,
                        "preview": !confirm,
                        "confirmed": false,
                        "action": "update_work_package",
                        "work_package_id": id,
                        "validation_errors": validation_errors,
                        "message": "OpenProject rejected the proposed update via /form validation. Fix validation_errors before confirming."
                    }));
                }
            }

            if !confirm {
                return Ok(json!({
                    "status": "write_unconfirmed",
                    "ready": true,
                    "preview": true,
                    "confirmed": false,
                    "action": "update_work_package",
                    "work_package_id": id,
                    "lock_version": lock_version,
                    "changes": changes,
                    "validation_errors": {},
                    "message": "Preview ready. Re-run update_work_package with confirm=true to apply."
                }));
            }

            let updated_raw = client.request_json(
                "PATCH",
                &format!("/api/v3/work_packages/{}", id),
                Some(&patch_val),
            )?;
            Ok(json!({
                "preview": false,
                "confirmed": true,
                "action": "update_work_package",
                "changes": changes,
                "work_package": compact_work_package(&updated_raw, None, &client.config)
            }))
        }

        "add_work_package_comment" => {
            let id = extract_wp_id(args)?;
            let comment = args
                .get("comment")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim();
            let confirm = args
                .get("confirm")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if comment.is_empty() {
                bail!("Parameter 'comment' must not be empty");
            }
            client.config.ensure_work_package_field_writable("comment")?;

            let current_raw =
                client.request_json("GET", &format!("/api/v3/work_packages/{}", id), None)?;
            client.config.check_work_package_project_link(&current_raw, true)?;

            if !confirm {
                return Ok(json!({
                    "status": "write_unconfirmed",
                    "ready": true,
                    "preview": true,
                    "confirmed": false,
                    "action": "add_work_package_comment",
                    "work_package_id": id,
                    "comment": comment,
                    "message": "Preview ready. Re-run add_work_package_comment with confirm=true to post."
                }));
            }

            let payload = json!({
                "comment": {
                    "raw": comment
                }
            });
            let act_raw = client.request_json(
                "POST",
                &format!("/api/v3/work_packages/{}/activities", id),
                Some(&payload),
            )?;

            Ok(json!({
                "preview": false,
                "confirmed": true,
                "action": "add_work_package_comment",
                "work_package_id": id,
                "activity_id": act_raw.get("id").cloned().unwrap_or(json!(0)),
                "comment": comment
            }))
        }

        other => bail!("Unknown tool: {}", other),
    }
}
