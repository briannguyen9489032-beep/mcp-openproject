use crate::config::OpenProjectConfig;
use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde_json::{json, Map, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;
use url::Url;

const MAX_RESPONSE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct OpenProjectClient {
    pub config: OpenProjectConfig,
}

impl OpenProjectClient {
    pub fn new(config: OpenProjectConfig) -> Self {
        Self { config }
    }

    fn auth_header_value(&self) -> String {
        let raw = format!("apikey:{}", self.config.api_token);
        format!("Basic {}", BASE64_STANDARD.encode(raw.as_bytes()))
    }

    pub fn request_json(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
        if !self.config.has_credentials() {
            bail!(
                "OpenProject credentials missing: set OPENPROJECT_BASE_URL and OPENPROJECT_API_TOKEN"
            );
        }

        let base_parsed = Url::parse(&self.config.base_url)
            .context("Invalid OPENPROJECT_BASE_URL configuration")?;
        if !matches!(base_parsed.scheme(), "http" | "https") {
            bail!(
                "Invalid scheme '{}' in OPENPROJECT_BASE_URL (only http/https allowed)",
                base_parsed.scheme()
            );
        }

        // Prevent absolute URL SSRF or path traversal escaping /api/v3
        if path.contains("://") || path.starts_with("//") || path.contains("..") {
            bail!("[security_error] Refusing suspicious or cross-origin request path: {}", path);
        }

        let clean_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        let full_url = format!("{}{}", self.config.base_url, clean_path);
        let parsed = Url::parse(&full_url).context("Invalid OPENPROJECT_BASE_URL or path")?;

        ensure_same_origin(&base_parsed, &parsed)?;

        if parsed.scheme() == "http" {
            self.request_http_native(method, &parsed, body)
        } else {
            self.request_via_curl(method, &full_url, body)
        }
    }

    fn request_http_native(
        &self,
        method: &str,
        url: &Url,
        body: Option<&Value>,
    ) -> Result<Value> {
        let host = url
            .host_str()
            .ok_or_else(|| anyhow!("Missing host in URL"))?;
        let port = url.port_or_known_default().unwrap_or(80);
        let addr = format!("{}:{}", host, port);

        let mut stream = TcpStream::connect(&addr)
            .with_context(|| format!("Failed to connect to OpenProject server at {}", addr))?;
        stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(30))).ok();

        let path_and_query = match url.query() {
            Some(q) => format!("{}?{}", url.path(), q),
            None => url.path().to_string(),
        };

        let body_bytes = match body {
            Some(v) => serde_json::to_vec(v)?,
            None => Vec::new(),
        };

        let host_header = if port == 80 {
            host.to_string()
        } else {
            format!("{}:{}", host, port)
        };

        let mut req = format!(
            "{} {} HTTP/1.0\r\nHost: {}\r\nAuthorization: {}\r\nAccept: application/hal+json, application/json\r\nConnection: close\r\n",
            method,
            path_and_query,
            host_header,
            self.auth_header_value()
        );
        if !body_bytes.is_empty() {
            req.push_str(&format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body_bytes.len()
            ));
        }
        req.push_str("\r\n");

        stream.write_all(req.as_bytes())?;
        if !body_bytes.is_empty() {
            stream.write_all(&body_bytes)?;
        }
        stream.flush()?;

        let mut resp_bytes = Vec::new();
        stream
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_end(&mut resp_bytes)?;
        if resp_bytes.len() as u64 > MAX_RESPONSE_BYTES {
            bail!(
                "OpenProject response exceeded maximum allowed size ({} bytes)",
                MAX_RESPONSE_BYTES
            );
        }
        let resp_str = String::from_utf8_lossy(&resp_bytes);

        let (header_part, body_part) = resp_str
            .split_once("\r\n\r\n")
            .ok_or_else(|| anyhow!("Malformed HTTP response from {}", addr))?;

        let status_line = header_part.lines().next().unwrap_or_default();
        let status_code: u16 = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(500);

        let trimmed_body = body_part.trim();
        if status_code >= 400 {
            bail!(
                "OpenProject HTTP {}: {}",
                status_code,
                trimmed_body.chars().take(300).collect::<String>()
            );
        }
        if trimmed_body.is_empty() || status_code == 204 {
            return Ok(json!({}));
        }
        serde_json::from_str(trimmed_body)
            .context("Failed to decode JSON response from OpenProject")
    }

    fn request_via_curl(&self, method: &str, full_url: &str, body: Option<&Value>) -> Result<Value> {
        // Deliberately do NOT pass -L / --location (prevents cross-origin redirect credential leaks)
        // and pass Authorization header via stdin (`--config -`) so `/proc/<pid>/cmdline` never exposes tokens.
        let mut cmd = Command::new("curl");
        cmd.arg("-sS")
            .arg("--max-time")
            .arg("30")
            .arg("--max-filesize")
            .arg(MAX_RESPONSE_BYTES.to_string())
            .arg("--proto")
            .arg("=https,http")
            .arg("-X")
            .arg(method)
            .arg("-H")
            .arg("Accept: application/hal+json, application/json")
            .arg("-w")
            .arg("\n__HTTP_STATUS__:%{http_code}")
            .arg("--config")
            .arg("-");

        let body_str;
        if let Some(payload) = body {
            body_str = serde_json::to_string(payload)?;
            cmd.arg("-H")
                .arg("Content-Type: application/json")
                .arg("--data-raw")
                .arg(&body_str);
        }

        cmd.arg(full_url);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .context("Failed to spawn curl for HTTPS OpenProject request")?;
        if let Some(mut stdin) = child.stdin.take() {
            let escaped_auth = self.auth_header_value().replace('"', "\\\"");
            let _ = writeln!(stdin, "header = \"Authorization: {}\"", escaped_auth);
        }

        let output = child
            .wait_with_output()
            .context("Failed waiting for curl HTTPS OpenProject request")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("OpenProject HTTPS request failed: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let (body_part, status_str) = stdout
            .rsplit_once("\n__HTTP_STATUS__:")
            .ok_or_else(|| anyhow!("Missing HTTP status trailer from curl response"))?;
        let status_code: u16 = status_str.trim().parse().unwrap_or(500);

        if status_code >= 400 {
            bail!(
                "OpenProject HTTP {}: {}",
                status_code,
                body_part.trim().chars().take(300).collect::<String>()
            );
        }
        let trimmed = body_part.trim();
        if trimmed.is_empty() || status_code == 204 {
            return Ok(json!({}));
        }
        serde_json::from_str(trimmed).context("Failed to parse OpenProject JSON payload")
    }
}

pub fn ensure_same_origin(base: &Url, target: &Url) -> Result<()> {
    if base.scheme() != target.scheme()
        || base.host_str() != target.host_str()
        || base.port_or_known_default() != target.port_or_known_default()
    {
        bail!(
            "[security_error] Cross-origin URL rejected: target '{}://{}:{:?}' does not match configured base origin",
            target.scheme(),
            target.host_str().unwrap_or_default(),
            target.port_or_known_default()
        );
    }
    let base_path = base.path().trim_end_matches('/');
    if !base_path.is_empty() && !target.path().starts_with(base_path) {
        bail!(
            "[security_error] Sub-path prefix escape rejected: '{}' does not start with '{}'",
            target.path(),
            base_path
        );
    }
    Ok(())
}

pub fn compact_project(
    raw: &Value,
    select: Option<&[String]>,
    config: &OpenProjectConfig,
) -> Value {
    let id = raw.get("id").cloned().unwrap_or(json!(0));
    let identifier = raw
        .get("identifier")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let name = raw.get("name").and_then(|v| v.as_str()).unwrap_or_default();
    let description = raw
        .get("description")
        .and_then(|d| d.get("raw"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let active = raw.get("active").and_then(|v| v.as_bool()).unwrap_or(true);

    let mut full = json!({
        "id": id,
        "identifier": identifier,
        "name": name,
        "description": description,
        "active": active,
    });
    if let Some(obj) = full.as_object_mut() {
        obj.retain(|k, _| k == "id" || !config.is_project_field_hidden(k));
    }
    project_fields(full, select)
}

pub fn compact_work_package(
    raw: &Value,
    select: Option<&[String]>,
    config: &OpenProjectConfig,
) -> Value {
    let links = raw.get("_links").unwrap_or(&Value::Null);
    let id = raw.get("id").cloned().unwrap_or(json!(0));
    let subject = raw
        .get("subject")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let description = raw
        .get("description")
        .and_then(|d| d.get("raw"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let status = links
        .get("status")
        .and_then(|s| s.get("title"))
        .and_then(|v| v.as_str())
        .or_else(|| raw.get("status").and_then(|v| v.as_str()))
        .unwrap_or("Unknown");
    let wp_type = links
        .get("type")
        .and_then(|s| s.get("title"))
        .and_then(|v| v.as_str())
        .or_else(|| raw.get("type").and_then(|v| v.as_str()))
        .unwrap_or("Task");
    let priority = links
        .get("priority")
        .and_then(|s| s.get("title"))
        .and_then(|v| v.as_str())
        .or_else(|| raw.get("priority").and_then(|v| v.as_str()))
        .unwrap_or("Normal");
    let project = links
        .get("project")
        .and_then(|s| s.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let project_href = links
        .get("project")
        .and_then(|s| s.get("href"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let project_identifier = raw
        .get("projectIdentifier")
        .and_then(|v| v.as_str())
        .or_else(|| project_href.trim_end_matches('/').rsplit('/').next())
        .unwrap_or(project);
    let assignee = links
        .get("assignee")
        .and_then(|s| s.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unassigned");
    let updated_at = raw
        .get("updatedAt")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let lock_version = raw
        .get("lockVersion")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let mut full = json!({
        "id": id,
        "subject": subject,
        "status": status,
        "type": wp_type,
        "priority": priority,
        "project": project,
        "project_identifier": project_identifier,
        "assignee": assignee,
        "description": description,
        "updated_at": updated_at,
        "lock_version": lock_version,
    });
    if let Some(obj) = full.as_object_mut() {
        obj.retain(|k, _| k == "id" || !config.is_work_package_field_hidden(k));
    }
    project_fields(full, select)
}

pub fn project_fields(item: Value, select: Option<&[String]>) -> Value {
    let Some(fields) = select else {
        return item;
    };
    if fields.is_empty() {
        return item;
    }
    let Some(obj) = item.as_object() else {
        return item;
    };
    let mut filtered = Map::new();
    // Always preserve id for unambiguous agent references
    if let Some(id_val) = obj.get("id") {
        filtered.insert("id".to_string(), id_val.clone());
    }
    for key in fields {
        let normalized = key.trim();
        if let Some(val) = obj.get(normalized) {
            filtered.insert(normalized.to_string(), val.clone());
        }
    }
    Value::Object(filtered)
}
