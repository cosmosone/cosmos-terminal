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
pub fn git_is_repo(path: String) -> Result<bool, String> {
    Ok(Repository::discover(&path).is_ok())
}

#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatusResult, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

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
pub fn git_log(path: String, limit: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
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

    let mut entries = Vec::new();
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
            let prefix = match line.origin() {
                '+' => "+",
                '-' => "-",
                _ => " ",
            };
            out.push_str(prefix);
            out.push_str(content);
        }
        true
    })
    .ok();
}

#[tauri::command]
pub fn git_diff(path: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut diff_text = String::new();

    if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            if let Ok(diff) = repo.diff_tree_to_index(Some(&tree), None, None) {
                append_diff(&diff, &mut diff_text);
            }
        }
    }

    if let Ok(diff) = repo.diff_index_to_workdir(None, None) {
        append_diff(&diff, &mut diff_text);
    }

    Ok(diff_text)
}

#[tauri::command]
pub fn git_stage_all(path: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<GitCommitResult, String> {
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
}

#[tauri::command]
pub fn git_push(path: String) -> Result<GitPushResult, String> {
    let repo_path = Repository::discover(&path)
        .map_err(|e| e.to_string())?
        .workdir()
        .ok_or("Not a working directory")?
        .to_path_buf();

    let output = std::process::Command::new("git")
        .arg("push")
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    if output.status.success() {
        Ok(GitPushResult {
            success: true,
            message: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(GitPushResult {
            success: false,
            message: stderr,
        })
    }
}
