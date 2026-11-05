mod client;
mod config;
mod tools;

use client::OpenProjectClient;
use config::OpenProjectConfig;
use serde_json::{json, Value};
use std::env;
use std::io::{self, BufRead, BufReader, Write};
use tools::{call_tool, list_tool_definitions};

const SERVER_NAME: &str = "mcp-openproject";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_PROTOCOL_VERSION: &str = "2024-11-05";
const MAX_RPC_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FramingMode {
    LineDelimited,
    ContentLength,
}

fn handle_jsonrpc_message(client: &OpenProjectClient, msg: &Value) -> Option<Value> {
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or_default();
    let id = msg.get("id").cloned();

    // JSON-RPC notifications do not carry an id and expect no response
    if id.is_none() || method.starts_with("notifications/") {
        return None;
    }
    let req_id = id.unwrap_or(Value::Null);
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));

    match method {
        "initialize" => {
            let requested_protocol = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or(DEFAULT_PROTOCOL_VERSION);
            Some(json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": requested_protocol,
                    "capabilities": {
                        "tools": {
                            "listChanged": false
                        }
                    },
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "version": SERVER_VERSION
                    }
                }
            }))
        }

        "ping" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {}
        })),

        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": list_tool_definitions(client)
            }
        })),

        "resources/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "resources": []
            }
        })),

        "resources/templates/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "resourceTemplates": []
            }
        })),

        "prompts/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "prompts": []
            }
        })),

        "tools/call" => {
            let tool_name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let tool_args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

            let refreshed_client;
            let active_client = if !client.config.has_credentials() {
                refreshed_client = OpenProjectClient::new(OpenProjectConfig::from_env());
                &refreshed_client
            } else {
                client
            };

            match call_tool(active_client, tool_name, &tool_args) {
                Ok(payload) => {
                    let pretty = serde_json::to_string_pretty(&payload)
                        .unwrap_or_else(|_| payload.to_string());
                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": pretty
                                }
                            ],
                            "structuredContent": payload,
                            "isError": false
                        }
                    }))
                }
                Err(err) => {
                    let err_payload = json!({
                        "error": err.to_string(),
                        "tool": tool_name
                    });
                    let pretty = serde_json::to_string_pretty(&err_payload)
                        .unwrap_or_else(|_| err.to_string());
                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": pretty
                                }
                            ],
                            "isError": true
                        }
                    }))
                }
            }
        }

        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", method)
            }
        })),
    }
}

fn read_next_message<R: BufRead>(reader: &mut R) -> io::Result<Option<(Value, FramingMode)>> {
    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            return Ok(None);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("Content-Length:")
            .or_else(|| trimmed.strip_prefix("content-length:"))
        {
            let content_len: usize = rest
                .trim()
                .parse()
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            if content_len > MAX_RPC_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Content-Length {} exceeds MAX_RPC_BYTES", content_len),
                ));
            }

            // Consume remaining header lines until blank line
            loop {
                let mut hdr = String::new();
                let n = reader.read_line(&mut hdr)?;
                if n == 0 || hdr.trim().is_empty() {
                    break;
                }
            }

            let mut buf = vec![0u8; content_len];
            reader.read_exact(&mut buf)?;
            let parsed: Value = serde_json::from_slice(&buf)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            return Ok(Some((parsed, FramingMode::ContentLength)));
        }

        let parsed: Value = serde_json::from_str(trimmed)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        return Ok(Some((parsed, FramingMode::LineDelimited)));
    }
}

fn write_message<W: Write>(writer: &mut W, msg: &Value, mode: FramingMode) -> io::Result<()> {
    let serialized = serde_json::to_string(msg)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    match mode {
        FramingMode::LineDelimited => {
            writeln!(writer, "{}", serialized)?;
        }
        FramingMode::ContentLength => {
            write!(
                writer,
                "Content-Length: {}\r\n\r\n{}",
                serialized.len(),
                serialized
            )?;
        }
    }
    writer.flush()
}

fn print_help() {
    println!(
        "{name} {version}
OpenProject Community Edition MCP Server (Rust) for Orca

USAGE:
    {name} [OPTIONS]

OPTIONS:
    -h, --help          Show this help message
    -V, --version       Show version information
    --print-config      Print resolved environment configuration (token masked)

ENVIRONMENT VARIABLES:
    OPENPROJECT_BASE_URL        OpenProject instance URL (e.g. https://openproject.example.com)
    OPENPROJECT_API_TOKEN       OpenProject API v3 token (Basic auth apikey:<token>)
    OPENPROJECT_READ_PROJECTS   Comma-separated project identifiers/IDs or '*' (default: '*')
    OPENPROJECT_WRITE_PROJECTS  Comma-separated project identifiers/IDs or '*' (default: '*')",
        name = SERVER_NAME,
        version = SERVER_VERSION
    );
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return;
    }
    if args.iter().any(|a| a == "-V" || a == "--version") {
        println!("{} {}", SERVER_NAME, SERVER_VERSION);
        return;
    }

    let config = OpenProjectConfig::from_env();
    if args.iter().any(|a| a == "--print-config") {
        let info = json!({
            "base_url": config.base_url,
            "has_api_token": !config.api_token.is_empty(),
            "read_projects": config.read_projects,
            "write_projects": config.write_projects,
            "enable_project_read": config.enable_project_read,
            "enable_project_write": config.enable_project_write,
            "enable_work_package_read": config.enable_work_package_read,
            "enable_work_package_write": config.enable_work_package_write,
            "hide_project_fields": config.hide_project_fields,
            "hide_work_package_fields": config.hide_work_package_fields,
        });
        println!("{}", serde_json::to_string_pretty(&info).unwrap_or_default());
        return;
    }

    let client = OpenProjectClient::new(config);
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();

    while let Ok(Some((msg, mode))) = read_next_message(&mut reader) {
        if let Some(resp) = handle_jsonrpc_message(&client, &msg) {
            if write_message(&mut writer, &resp, mode).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::thread;

    fn spawn_mock_openproject_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().unwrap();

        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut req_line = String::new();
                if reader.read_line(&mut req_line).is_err() {
                    continue;
                }
                let parts: Vec<&str> = req_line.split_whitespace().collect();
                let method = parts.first().copied().unwrap_or("GET");
                let path = parts.get(1).copied().unwrap_or("/");

                let mut content_len = 0usize;
                loop {
                    let mut hdr = String::new();
                    if reader.read_line(&mut hdr).unwrap_or(0) == 0 || hdr.trim().is_empty() {
                        break;
                    }
                    if let Some(v) = hdr.strip_prefix("Content-Length:") {
                        content_len = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut body_buf = vec![0u8; content_len];
                if content_len > 0 {
                    let _ = reader.read_exact(&mut body_buf);
                }

                let response_json = match (method, path) {
                    ("GET", "/api/v3/projects?pageSize=100") => json!({
                        "_embedded": {
                            "elements": [
                                {
                                    "id": 1,
                                    "identifier": "acme-backend",
                                    "name": "Acme Backend",
                                    "active": true,
                                    "description": { "raw": "Core backend" }
                                },
                                {
                                    "id": 2,
                                    "identifier": "private-proj",
                                    "name": "Private Project",
                                    "active": true,
                                    "description": { "raw": "Hidden" }
                                }
                            ]
                        }
                    }),
                    ("GET", "/api/v3/statuses") => json!({
                        "_embedded": {
                            "elements": [
                                { "id": 1, "name": "New", "isClosed": false },
                                { "id": 7, "name": "In Progress", "isClosed": false },
                                { "id": 10, "name": "In Review", "isClosed": false }
                            ]
                        }
                    }),
                    ("GET", "/api/v3/work_packages/1428") => json!({
                        "id": 1428,
                        "subject": "Fix token refresh",
                        "description": { "raw": "Refresh race condition" },
                        "lockVersion": 3,
                        "updatedAt": "2026-11-04T08:00:00Z",
                        "_links": {
                            "status": { "href": "/api/v3/statuses/1", "title": "New" },
                            "type": { "href": "/api/v3/types/1", "title": "Bug" },
                            "priority": { "href": "/api/v3/priorities/8", "title": "High" },
                            "project": { "href": "/api/v3/projects/acme-backend", "title": "Acme Backend" },
                            "assignee": { "href": "/api/v3/users/4", "title": "Alex Dev" }
                        }
                    }),
                    ("PATCH", "/api/v3/work_packages/1428") => json!({
                        "id": 1428,
                        "subject": "Fix token refresh",
                        "description": { "raw": "Refresh race condition" },
                        "lockVersion": 4,
                        "updatedAt": "2026-11-04T08:10:00Z",
                        "_links": {
                            "status": { "href": "/api/v3/statuses/7", "title": "In Progress" },
                            "type": { "href": "/api/v3/types/1", "title": "Bug" },
                            "priority": { "href": "/api/v3/priorities/8", "title": "High" },
                            "project": { "href": "/api/v3/projects/acme-backend", "title": "Acme Backend" },
                            "assignee": { "href": "/api/v3/users/4", "title": "Alex Dev" }
                        }
                    }),
                    _ => json!({}),
                };

                let body_str = serde_json::to_string(&response_json).unwrap();
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body_str.len(),
                    body_str
                );
                let mut write_stream = stream;
                let _ = write_stream.write_all(resp.as_bytes());
                let _ = write_stream.flush();
            }
        });

        format!("http://{}", addr)
    }

    #[test]
    fn test_mcp_initialize_and_guarded_workflow() {
        let base_url = spawn_mock_openproject_server();
        let config = OpenProjectConfig {
            base_url,
            api_token: "opapi-test".to_string(),
            read_projects: vec!["acme-*".to_string()],
            write_projects: vec!["acme-backend".to_string()],
            enable_project_read: true,
            enable_project_write: true,
            enable_work_package_read: true,
            enable_work_package_write: true,
            hide_project_fields: vec![],
            hide_work_package_fields: vec![],
        };
        let client = OpenProjectClient::new(config);

        // 1. Initialize handshake
        let init_resp = handle_jsonrpc_message(
            &client,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": { "protocolVersion": "2024-11-05" }
            }),
        )
        .unwrap();
        assert_eq!(
            init_resp["result"]["serverInfo"]["name"],
            "mcp-openproject"
        );

        // 2. Strict argument validation rejects unknown keys (StrictMCPServer pattern)
        let bad_args = call_tool(
            &client,
            "list_projects",
            &json!({ "unknown_filter": "acme-backend" }),
        );
        assert!(bad_args.is_err());
        assert!(bad_args
            .unwrap_err()
            .to_string()
            .contains("[validation_error] Unknown argument(s)"));

        // 3. list_projects filters out private-proj via glob read_projects ("acme-*")
        let projects_res = call_tool(&client, "list_projects", &json!({})).unwrap();
        assert_eq!(projects_res["total"], 1);
        assert_eq!(projects_res["projects"][0]["identifier"], "acme-backend");

        // 4. get_work_package with select field projection
        let wp_res = call_tool(
            &client,
            "get_work_package",
            &json!({ "id": 1428, "select": ["subject", "status"] }),
        )
        .unwrap();
        assert_eq!(wp_res["id"], 1428);
        assert_eq!(wp_res["subject"], "Fix token refresh");
        assert_eq!(wp_res["status"], "New");
        assert!(wp_res.get("description").is_none());

        // 5. Guarded write step 1: preview without confirm=true
        let preview_res = call_tool(
            &client,
            "update_work_package",
            &json!({ "id": 1428, "status": "In Progress" }),
        )
        .unwrap();
        assert_eq!(preview_res["preview"], true);
        assert_eq!(preview_res["confirmed"], false);
        assert_eq!(preview_res["status"], "write_unconfirmed");

        // 6. Guarded write step 2: execute with confirm=true
        let exec_res = call_tool(
            &client,
            "update_work_package",
            &json!({ "id": 1428, "status": "In Progress", "confirm": true }),
        )
        .unwrap();
        assert_eq!(exec_res["preview"], false);
        assert_eq!(exec_res["confirmed"], true);
        assert_eq!(exec_res["work_package"]["status"], "In Progress");
        assert_eq!(exec_res["work_package"]["lock_version"], 4);
    }
}
