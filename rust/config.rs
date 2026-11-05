use anyhow::{bail, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

pub const UNDISCLOSED_URN: &str = "urn:openproject-org:api:v3:undisclosed";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectLinkState {
    Resolved {
        slug: String,
        title: String,
        id: Option<String>,
        identifier: Option<String>,
    },
    Undisclosed,
    Missing,
    Malformed,
}

#[derive(Debug, Clone)]
pub struct OpenProjectConfig {
    pub base_url: String,
    pub api_token: String,
    pub read_projects: Vec<String>,
    pub write_projects: Vec<String>,
    pub enable_project_read: bool,
    pub enable_project_write: bool,
    pub enable_work_package_read: bool,
    pub enable_work_package_write: bool,
    pub hide_project_fields: Vec<String>,
    pub hide_work_package_fields: Vec<String>,
}

impl OpenProjectConfig {
    pub fn from_env() -> Self {
        let local_fallback = discover_local_mcp_env();

        let raw_url = env::var("OPENPROJECT_BASE_URL")
            .or_else(|_| env::var("OPENPROJECT_URL"))
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| local_fallback.get("OPENPROJECT_BASE_URL").cloned())
            .or_else(|| local_fallback.get("OPENPROJECT_URL").cloned())
            .unwrap_or_default();
        let base_url = raw_url.trim().trim_end_matches('/').to_string();

        let api_token = env::var("OPENPROJECT_API_TOKEN")
            .or_else(|_| env::var("OPENPROJECT_API_KEY"))
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| local_fallback.get("OPENPROJECT_API_TOKEN").cloned())
            .or_else(|| local_fallback.get("OPENPROJECT_API_KEY").cloned())
            .unwrap_or_default()
            .trim()
            .to_string();

        let read_raw = env::var("OPENPROJECT_READ_PROJECTS")
            .ok()
            .or_else(|| local_fallback.get("OPENPROJECT_READ_PROJECTS").cloned())
            .unwrap_or_else(|| "*".to_string());
        let write_raw = env::var("OPENPROJECT_WRITE_PROJECTS")
            .ok()
            .or_else(|| local_fallback.get("OPENPROJECT_WRITE_PROJECTS").cloned())
            .unwrap_or_else(|| "*".to_string());

        let enable_project_read = parse_bool_env("OPENPROJECT_ENABLE_PROJECT_READ", true);
        let enable_work_package_read = parse_bool_env("OPENPROJECT_ENABLE_WORK_PACKAGE_READ", true);

        // Enforce WRITE_GROUP_REQUIREMENTS invariant from openproject-ce-mcp:
        // write cannot be enabled if its corresponding read flag is disabled.
        let enable_project_write =
            enable_project_read && parse_bool_env("OPENPROJECT_ENABLE_PROJECT_WRITE", true);
        let enable_work_package_write = enable_work_package_read
            && parse_bool_env("OPENPROJECT_ENABLE_WORK_PACKAGE_WRITE", true);

        let hide_project_raw = env::var("OPENPROJECT_HIDE_PROJECT_FIELDS").unwrap_or_default();
        let hide_wp_raw = env::var("OPENPROJECT_HIDE_WORK_PACKAGE_FIELDS").unwrap_or_default();

        Self {
            base_url,
            api_token,
            read_projects: parse_allowlist(&read_raw),
            write_projects: parse_allowlist(&write_raw),
            enable_project_read,
            enable_project_write,
            enable_work_package_read,
            enable_work_package_write,
            hide_project_fields: parse_allowlist(&hide_project_raw),
            hide_work_package_fields: parse_allowlist(&hide_wp_raw),
        }
    }

    pub fn can_read_project(&self, project_id_or_identifier: &str) -> bool {
        if !self.enable_project_read && !self.enable_work_package_read {
            return false;
        }
        matches_allowlist(project_id_or_identifier, &self.read_projects)
    }

    pub fn can_write_project(&self, project_id_or_identifier: &str) -> bool {
        if !self.enable_project_write && !self.enable_work_package_write {
            return false;
        }
        matches_allowlist(project_id_or_identifier, &self.read_projects)
            && matches_allowlist(project_id_or_identifier, &self.write_projects)
    }

    /// Fail-closed check for a raw OpenProject work package JSON payload.
    /// Rejects `urn:openproject-org:api:v3:undisclosed`, missing `_links.project`,
    /// or malformed hrefs BEFORE checking `*` wildcard allowlists.
    pub fn check_work_package_project_link(&self, raw_wp: &Value, write: bool) -> Result<()> {
        if write && !self.enable_work_package_write {
            bail!("403 Forbidden: work package write tools are disabled by OPENPROJECT_ENABLE_WORK_PACKAGE_WRITE");
        }
        if !write && !self.enable_work_package_read {
            bail!("403 Forbidden: work package read tools are disabled by OPENPROJECT_ENABLE_WORK_PACKAGE_READ");
        }
        match classify_work_package_project_link(raw_wp) {
            ProjectLinkState::Undisclosed => {
                bail!("403 Forbidden / Project Scope: work package belongs to an undisclosed project (urn:openproject-org:api:v3:undisclosed)")
            }
            ProjectLinkState::Missing => {
                bail!("403 Forbidden / Project Scope: work package is missing a valid _links.project reference")
            }
            ProjectLinkState::Malformed => {
                bail!("403 Forbidden / Project Scope: work package has a malformed _links.project.href")
            }
            ProjectLinkState::Resolved {
                slug,
                title: _,
                id,
                identifier,
            } => {
                // Match only canonical project identifiers (href slug, numeric ID, projectIdentifier),
                // never mutable display titles which could spoof an allowlist glob.
                let mut candidates = vec![slug.clone()];
                if let Some(i) = id {
                    if !i.is_empty() {
                        candidates.push(i);
                    }
                }
                if let Some(ident) = identifier {
                    if !ident.is_empty() {
                        candidates.push(ident);
                    }
                }

                let allowed = if write {
                    candidates.iter().any(|c| self.can_write_project(c))
                } else {
                    candidates.iter().any(|c| self.can_read_project(c))
                };

                if !allowed {
                    let scope_var = if write {
                        "OPENPROJECT_WRITE_PROJECTS"
                    } else {
                        "OPENPROJECT_READ_PROJECTS"
                    };
                    bail!(
                        "403 Forbidden / Project Scope: project '{}' is not allowed by {}",
                        slug,
                        scope_var
                    );
                }
                Ok(())
            }
        }
    }

    pub fn is_project_field_hidden(&self, field: &str) -> bool {
        matches_allowlist(field, &self.hide_project_fields)
    }

    pub fn is_work_package_field_hidden(&self, field: &str) -> bool {
        matches_allowlist(field, &self.hide_work_package_fields)
    }

    pub fn ensure_work_package_field_writable(&self, field: &str) -> Result<()> {
        if self.is_work_package_field_hidden(field) {
            bail!(
                "403 Forbidden / Hidden Field Policy: field '{}' is hidden by OPENPROJECT_HIDE_WORK_PACKAGE_FIELDS and cannot be modified",
                field
            );
        }
        Ok(())
    }

    pub fn has_credentials(&self) -> bool {
        !self.base_url.is_empty() && !self.api_token.is_empty()
    }
}

pub fn classify_work_package_project_link(raw_wp: &Value) -> ProjectLinkState {
    let Some(project_link) = raw_wp.get("_links").and_then(|l| l.get("project")) else {
        return ProjectLinkState::Missing;
    };
    let Some(link_obj) = project_link.as_object() else {
        return ProjectLinkState::Malformed;
    };
    let Some(href_val) = link_obj.get("href") else {
        return ProjectLinkState::Missing;
    };
    let Some(href_raw) = href_val.as_str() else {
        return ProjectLinkState::Malformed;
    };
    let href = href_raw.trim();
    if href.is_empty() {
        return ProjectLinkState::Missing;
    }
    if href.eq_ignore_ascii_case(UNDISCLOSED_URN) {
        return ProjectLinkState::Undisclosed;
    }
    let slug = href
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .trim();
    if slug.is_empty() || slug == "projects" || !href.contains("/projects/") {
        return ProjectLinkState::Malformed;
    }
    let title = link_obj
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let identifier = raw_wp
        .get("projectIdentifier")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());
    let id = if slug.chars().all(|c| c.is_ascii_digit()) {
        Some(slug.to_string())
    } else {
        None
    };

    ProjectLinkState::Resolved {
        slug: slug.to_string(),
        title,
        id,
        identifier,
    }
}

pub fn validate_path_segment<'a>(raw: &'a str, param_name: &str) -> Result<&'a str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        bail!("[validation_error] Parameter '{}' must not be empty", param_name);
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.contains("..")
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('?')
        || trimmed.contains('#')
        || trimmed.contains('%')
        || trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        bail!(
            "[validation_error] Parameter '{}' contains illegal path characters: '{}'",
            param_name,
            trimmed
        );
    }
    Ok(trimmed)
}

pub fn parse_allowlist(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn glob_match(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star_idx, mut match_idx) = (None::<usize>, 0usize);

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_idx = Some(pi);
            match_idx = ti;
            pi += 1;
        } else if let Some(si) = star_idx {
            pi = si + 1;
            match_idx += 1;
            ti = match_idx;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

pub fn matches_allowlist(candidate: &str, allowlist: &[String]) -> bool {
    if allowlist.is_empty() {
        return false;
    }
    let needle = candidate.trim().to_lowercase();
    if needle.is_empty() {
        return false;
    }
    allowlist.iter().any(|pattern| glob_match(pattern, &needle))
}

fn parse_bool_env(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(val) => match val.trim().to_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        },
        Err(_) => default,
    }
}

fn is_placeholder_env_value(val: &str) -> bool {
    let lower = val.trim().to_ascii_lowercase();
    lower.is_empty()
        || lower == "https://openproject.example.com"
        || lower == "http://openproject.example.com"
        || lower == "opapi-..."
        || lower == "opapi-your-token"
        || lower.starts_with("<your_")
}

fn discover_local_mcp_env() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(home) = env::var("HOME").or_else(|_| env::var("USERPROFILE")) else {
        return map;
    };
    let home_path = PathBuf::from(home);

    let json_config_paths = [
        home_path.join(".claude.json"),
        home_path.join(".gemini").join("config").join("mcp_config.json"),
        home_path
            .join(".gemini")
            .join("antigravity")
            .join("mcp_config.json"),
    ];

    for config_path in &json_config_paths {
        if let Ok(content) = fs::read_to_string(config_path) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
                if let Some(env_obj) = parsed
                    .get("mcpServers")
                    .and_then(|s| s.get("openproject").or_else(|| s.get("openproject-ce")))
                    .and_then(|o| o.get("env"))
                    .and_then(|e| e.as_object())
                {
                    for (k, v) in env_obj {
                        if let Some(val_str) = v.as_str() {
                            let trimmed = val_str.trim();
                            if !is_placeholder_env_value(trimmed) && !map.contains_key(k) {
                                map.insert(k.clone(), trimmed.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let codex_path = home_path.join(".codex").join("config.toml");
    if let Ok(content) = fs::read_to_string(&codex_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("OPENPROJECT_") {
                if let Some((k, v)) = trimmed.split_once('=') {
                    let key = k.trim();
                    let val = v.trim().trim_matches('"').trim_matches('\'').trim();
                    if !is_placeholder_env_value(val) && !map.contains_key(key) {
                        map.insert(key.to_string(), val.to_string());
                    }
                }
            }
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_allowlist_and_glob_matching() {
        let list = parse_allowlist("acme-*, core-?1, 42");
        assert!(matches_allowlist("acme-backend", &list));
        assert!(matches_allowlist("ACME-FRONTEND", &list));
        assert!(matches_allowlist("core-v1", &list));
        assert!(matches_allowlist("42", &list));
        assert!(!matches_allowlist("other-proj", &list));
        assert!(!matches_allowlist("", &list));

        let wildcard = parse_allowlist("*");
        assert!(matches_allowlist("anything", &wildcard));
        assert!(!matches_allowlist("", &wildcard));

        let empty = parse_allowlist("");
        assert!(!matches_allowlist("acme-backend", &empty));
    }

    #[test]
    fn test_undisclosed_and_malformed_project_link_fail_closed() {
        let cfg = OpenProjectConfig {
            base_url: "https://op.example.com".to_string(),
            api_token: "tok".to_string(),
            read_projects: vec!["*".to_string()],
            write_projects: vec!["*".to_string()],
            enable_project_read: true,
            enable_project_write: true,
            enable_work_package_read: true,
            enable_work_package_write: true,
            hide_project_fields: vec![],
            hide_work_package_fields: vec![],
        };

        let undisclosed = json!({
            "id": 99,
            "_links": {
                "project": { "href": "urn:openproject-org:api:v3:undisclosed", "title": "Redacted" }
            }
        });
        assert!(cfg.check_work_package_project_link(&undisclosed, false).is_err());

        let missing = json!({ "id": 100, "_links": {} });
        assert!(cfg.check_work_package_project_link(&missing, false).is_err());

        let valid = json!({
            "id": 101,
            "_links": {
                "project": { "href": "/api/v3/projects/acme-backend", "title": "Acme Backend" }
            }
        });
        assert!(cfg.check_work_package_project_link(&valid, false).is_ok());
    }

    #[test]
    fn test_path_segment_validation() {
        assert!(validate_path_segment("acme-backend", "project").is_ok());
        assert!(validate_path_segment("123", "project").is_ok());
        assert!(validate_path_segment("../users", "project").is_err());
        assert!(validate_path_segment("acme/../../admin", "project").is_err());
        assert!(validate_path_segment("acme?pageSize=999", "project").is_err());
        assert!(validate_path_segment("acme%2fadmin", "project").is_err());
    }
}
