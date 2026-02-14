use std::collections::HashMap;

use git2::{Repository, Sort, StatusOptions};

use crate::models::{GitCommitResult, GitFileStatus, GitLogEntry, GitPushResult, GitStatusResult};

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
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || Ok(Repository::discover(&path).is_ok()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatusResult, String> {
    tokio::task::spawn_blocking(move || git_status_sync(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn git_status_sync(path: &str) -> Result<GitStatusResult, String> {
    let repo = Repository::discover(path).map_err(|e| e.to_string())?;

    let branch = match repo.head() {
        Ok(head) => head.shorthand().unwrap_or("HEAD").to_string(),
        Err(_) => "HEAD".to_string(),
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    let mut dirty = false;

    for entry in statuses.iter() {
        let s = entry.status();
        if s.is_ignored() {
            continue;
        }
        dirty = true;
        files.push(GitFileStatus {
            path: entry.path().unwrap_or("").to_string(),
            status: status_string(s).to_string(),
            staged: is_staged(s),
        });
    }

    Ok(GitStatusResult {
        branch,
        dirty,
        files,
    })
}

#[tauri::command]
pub async fn git_log(path: String, limit: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    tokio::task::spawn_blocking(move || git_log_sync(&path, limit))
        .await
        .map_err(|e| e.to_string())?
}

fn git_log_sync(path: &str, limit: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    let repo = Repository::discover(path).map_err(|e| e.to_string())?;
    let max = limit.unwrap_or(50);

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
        let full_id = oid.to_string();
        let id = full_id[..7.min(full_id.len())].to_string();
        let message = commit
            .message()
            .unwrap_or("")
            .lines()
            .next()
            .unwrap_or("")
            .to_string();
        let author = commit.author();
        let refs_list = ref_map.get(&oid).cloned().unwrap_or_default();

        entries.push(GitLogEntry {
            id,
            full_id,
            message,
            author: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            refs_list,
        });
    }

    Ok(entries)
}

fn append_diff(diff: &git2::Diff, out: &mut String) {
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
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
}

#[tauri::command]
pub async fn git_diff(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
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
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_stage_all(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
        let mut index = repo.index().map_err(|e| e.to_string())?;
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
        index.write().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<GitCommitResult, String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
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
            commit_id: oid.to_string()[..7].to_string(),
            message,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<GitPushResult, String> {
    tokio::task::spawn_blocking(move || {
        let repo_path = Repository::discover(&path)
            .map_err(|e| e.to_string())?
            .workdir()
            .ok_or("Not a working directory")?
            .to_path_buf();

        let mut cmd = std::process::Command::new("git");
        cmd.arg("push").current_dir(&repo_path);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run git push: {}", e))?;

        let message = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(GitPushResult {
            success: output.status.success(),
            message,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
