use std::collections::HashMap;

use git2::{Repository, Sort, StatusOptions};

use crate::commands::task::spawn_blocking_result;
use crate::models::{GitCommitResult, GitFileStatus, GitLogEntry, GitPushResult, GitStatusResult};
use crate::security::path_guard::canonicalize_existing_path;

const DEFAULT_GIT_LOG_LIMIT: usize = 50;
const MAX_GIT_LOG_LIMIT: usize = 500;
const MAX_DIFF_BYTES: usize = 5 * 1024 * 1024; // 5 MB

/// Strip embedded credentials from URLs (e.g. `https://user:token@host/...`
/// → `https://***@host/...`) to prevent accidental leakage to the frontend.
fn redact_credentials(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut remaining = text;
    while let Some(scheme_end) = remaining.find("://") {
        let after_scheme = &remaining[scheme_end + 3..];
        if let Some(at_pos) = after_scheme.find('@') {
            // Only redact if the '@' comes before the next '/' or whitespace
            let next_slash = after_scheme.find('/').unwrap_or(after_scheme.len());
            let next_space = after_scheme
                .find(char::is_whitespace)
                .unwrap_or(after_scheme.len());
            if at_pos < next_slash && at_pos < next_space {
                result.push_str(&remaining[..scheme_end + 3]);
                result.push_str("***@");
                remaining = &after_scheme[at_pos + 1..];
                continue;
            }
        }
        result.push_str(&remaining[..scheme_end + 3]);
        remaining = after_scheme;
    }
    result.push_str(remaining);
    result
}

fn short_id(oid: &git2::Oid) -> String {
    let full = oid.to_string();
    full[..7.min(full.len())].to_string()
}

fn open_repo(path: &str) -> Result<Repository, String> {
    let canonical = canonicalize_existing_path(path)?;
    Repository::discover(&canonical).map_err(|e| e.to_string())
}

fn current_branch(repo: &Repository) -> String {
    match repo.head() {
        Ok(head) => head.shorthand().unwrap_or("HEAD").to_string(),
        Err(_) => "HEAD".to_string(),
    }
}

fn status_string(status: git2::Status) -> &'static str {
    if status.is_index_new() || status.is_wt_new() {
        "added"
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        "deleted"
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        "renamed"
    } else if status.is_index_modified() || status.is_wt_modified() {
        "modified"
    } else if status.is_conflicted() {
        "conflicted"
    } else {
        "untracked"
    }
}

fn is_staged(status: git2::Status) -> bool {
    status.is_index_new()
        || status.is_index_modified()
        || status.is_index_deleted()
        || status.is_index_renamed()
}

#[tauri::command]
pub async fn git_project_status(path: String) -> Result<Option<GitStatusResult>, String> {
    spawn_blocking_result(move || {
        let repo = match open_repo(&path) {
            Ok(r) => r,
            Err(_) => return Ok(None),
        };
        git_status_from_repo(&repo).map(Some)
    })
    .await
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatusResult, String> {
    spawn_blocking_result(move || git_status_sync(&path)).await
}

fn git_status_sync(path: &str) -> Result<GitStatusResult, String> {
    let repo = open_repo(path)?;
    git_status_from_repo(&repo)
}

/// Resolves the local and upstream OIDs for the current branch.
/// Returns `None` when HEAD, branch name, or upstream ref cannot be resolved.
fn local_and_upstream_oids(repo: &Repository) -> Option<(git2::Oid, git2::Oid)> {
    let head = repo.head().ok()?;
    let branch_name = head.shorthand()?;
    let local_oid = head.target()?;
    let branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .ok()?;
    let upstream = branch.upstream().ok()?;
    let upstream_oid = upstream.get().target()?;
    Some((local_oid, upstream_oid))
}

fn commits_ahead(repo: &Repository, oids: Option<(git2::Oid, git2::Oid)>) -> u32 {
    let (local_oid, upstream_oid) = match oids {
        Some(pair) => pair,
        None => return 0,
    };

    repo.graph_ahead_behind(local_oid, upstream_oid)
        .map(|(ahead, _)| ahead as u32)
        .unwrap_or(0)
}

fn committed_files(repo: &Repository, oids: Option<(git2::Oid, git2::Oid)>) -> Vec<GitFileStatus> {
    let (local_oid, upstream_oid) = match oids {
        Some(pair) => pair,
        None => return Vec::new(),
    };

    let local_tree = match repo.find_commit(local_oid).and_then(|c| c.tree()) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let upstream_tree = match repo.find_commit(upstream_oid).and_then(|c| c.tree()) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };

    let diff = match repo.diff_tree_to_tree(Some(&upstream_tree), Some(&local_tree), None) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };

    diff.deltas()
        .map(|delta| {
            let path = delta
                .new_file()
                .path()
                .unwrap_or_else(|| std::path::Path::new(""))
                .to_string_lossy()
                .to_string();
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Renamed => "renamed",
                _ => "modified",
            };
            GitFileStatus {
                path,
                status: status.to_string(),
                staged: false,
            }
        })
        .collect()
}

fn git_status_from_repo(repo: &Repository) -> Result<GitStatusResult, String> {
    let branch = current_branch(repo);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut files = Vec::with_capacity(statuses.len());

    for entry in statuses.iter() {
        files.push(GitFileStatus {
            path: entry.path().unwrap_or("").to_string(),
            status: status_string(entry.status()).to_string(),
            staged: is_staged(entry.status()),
        });
    }

    let oids = local_and_upstream_oids(repo);
    let ahead = commits_ahead(repo, oids);
    let committed = committed_files(repo, oids);

    Ok(GitStatusResult {
        branch,
        dirty: !files.is_empty(),
        files,
        ahead,
        committed_files: committed,
    })
}

#[tauri::command]
pub async fn git_log(path: String, limit: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    spawn_blocking_result(move || git_log_sync(&path, limit)).await
}

fn git_log_sync(path: &str, limit: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    let repo = open_repo(path)?;
    // Clamp user-provided limits to avoid unbounded history walks.
    let max = limit
        .unwrap_or(DEFAULT_GIT_LOG_LIMIT)
        .min(MAX_GIT_LOG_LIMIT);

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(Sort::TIME).map_err(|e| e.to_string())?;

    let mut ref_map: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            if let (Some(name), Some(target)) = (r.shorthand(), r.target()) {
                ref_map.entry(target).or_default().push(name.to_string());
            }
        }
    }

    let mut entries = Vec::with_capacity(max);
    for oid in revwalk.flatten().take(max) {
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let id = short_id(&oid);
        let full_id = oid.to_string();
        let raw_message = commit.message().unwrap_or("");
        let message = raw_message.lines().next().unwrap_or("").to_string();
        let body = raw_message
            .split_once("\n\n")
            .map(|(_, rest)| rest)
            .unwrap_or("")
            .trim()
            .to_string();
        let author = commit.author();
        let refs_list = ref_map.get(&oid).cloned().unwrap_or_default();

        entries.push(GitLogEntry {
            id,
            full_id,
            message,
            body,
            author: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            refs_list,
        });
    }

    Ok(entries)
}

fn append_diff(diff: &git2::Diff, out: &mut String) {
    let mut truncated = false;
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if out.len() >= MAX_DIFF_BYTES {
            truncated = true;
            return false;
        }
        if let Ok(content) = std::str::from_utf8(line.content()) {
            match line.origin() {
                '+' | '-' | ' ' => {
                    out.push(line.origin());
                    out.push_str(content);
                }
                // File headers (diff --git, ---, +++), hunk headers (@@) — emit as-is
                _ => out.push_str(content),
            }
        }
        true
    })
    .ok();
    if truncated {
        out.push_str("\n\n[Diff truncated — output exceeded 5 MB]\n");
    }
}

#[tauri::command]
pub async fn git_diff(path: String) -> Result<String, String> {
    spawn_blocking_result(move || {
        let repo = open_repo(&path)?;
        let mut diff_text = String::new();

        // Staged changes: diff HEAD tree against index
        if let Some(diff) = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_tree().ok())
            .and_then(|tree| repo.diff_tree_to_index(Some(&tree), None, None).ok())
        {
            append_diff(&diff, &mut diff_text);
        }

        // Unstaged changes: diff index against working directory
        let mut wt_opts = git2::DiffOptions::new();
        wt_opts
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        if let Ok(diff) = repo.diff_index_to_workdir(None, Some(&mut wt_opts)) {
            append_diff(&diff, &mut diff_text);
        }

        Ok(diff_text)
    })
    .await
}

#[tauri::command]
pub async fn git_stage_all(path: String) -> Result<(), String> {
    spawn_blocking_result(move || {
        let repo = open_repo(&path)?;
        let mut index = repo.index().map_err(|e| e.to_string())?;
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
        index.write().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<GitCommitResult, String> {
    spawn_blocking_result(move || {
        let repo = open_repo(&path)?;
        let sig = repo.signature().map_err(|e| e.to_string())?;
        let mut index = repo.index().map_err(|e| e.to_string())?;
        let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

        let parent = match repo.head() {
            Ok(head) => Some(head.peel_to_commit().map_err(|e| e.to_string())?),
            Err(_) => None,
        };

        let parents: Vec<&git2::Commit> = parent.iter().collect();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
            .map_err(|e| e.to_string())?;

        Ok(GitCommitResult {
            success: true,
            commit_id: short_id(&oid),
            message,
        })
    })
    .await
}

#[tauri::command]
pub async fn git_remove_lock_file(path: String) -> Result<(), String> {
    spawn_blocking_result(move || {
        let repo = open_repo(&path)?;
        let lock_file = repo.path().join("index.lock");
        if !lock_file.exists() {
            return Err("No lock file found".to_string());
        }
        std::fs::remove_file(&lock_file).map_err(|e| format!("Failed to remove lock file: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<GitPushResult, String> {
    spawn_blocking_result(move || {
        let repo = open_repo(&path)?;
        let repo_path = repo
            .workdir()
            .ok_or("Not a working directory")?
            .to_path_buf();

        let branch = current_branch(&repo);

        // Validate branch name to prevent shell metacharacter injection
        if !branch
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'/' || b == b'.')
        {
            return Err("Invalid branch name".to_string());
        }

        let mut cmd = std::process::Command::new("git");
        // `--` terminates option parsing so branch names cannot be interpreted
        // as additional git flags.
        cmd.args(["push", "-u", "origin", "--", &branch])
            .current_dir(&repo_path);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run git push: {e}"))?;

        let raw_message = String::from_utf8_lossy(&output.stderr).into_owned();
        // Redact embedded credentials (e.g. https://user:token@host/...) from
        // stderr before forwarding to the frontend.
        let message = redact_credentials(&raw_message);
        Ok(GitPushResult {
            success: output.status.success(),
            message,
        })
    })
    .await
}
