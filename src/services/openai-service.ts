import { logger } from './logger';
import { store } from '../state/store';

/** Max characters for the single-call path (small diffs). */
const MAX_DIFF_CHARS = 14000;
const MAX_HUNK_CHARS = 12000;

/** Target size per batch in the two-tier path. */
const BATCH_TARGET_CHARS = 12000;
/** Hard cap on number of batches to avoid runaway API calls. */
const MAX_BATCHES = 8;

export type ProgressCallback = (label: string) => void;

const SYSTEM_PROMPT = `You are a commit message generator that analyses git diffs.

Rules:
1. Use exactly one conventional commit prefix: feat, fix, chore, refactor, docs, style, test, perf.
2. Format: <prefix>: <description starting with a lowercase letter>
3. The description after the colon MUST start with a lowercase letter.
4. Use Australian English spelling (e.g. colour, initialise, behaviour, organisation, analyse, centre).
5. Keep the entire message on a single line, max 72 characters.
6. Summarise the overall intent of the change, not individual file edits.
7. Output ONLY the commit message — no quotes, no explanation, no body.

Examples:
- feat: add colour picker to the settings page
- fix: correct initialisation order for the auth service
- refactor: reorganise middleware into separate modules`;

const SUMMARISE_PROMPT = `You are a code-change summariser. You will receive a batch of git diff hunks.
For each file in the batch, output exactly ONE bullet point describing the factual change.
Format: "- <file path>: <what changed>"
Be concise and factual. Do NOT interpret intent or suggest a commit message.
Use Australian English spelling.`;

// ---------------------------------------------------------------------------
// Diff parsing and batching helpers
// ---------------------------------------------------------------------------

interface FileDiff {
  path: string;
  content: string;
}

/** Split a unified diff string into per-file sections. */
function splitDiffIntoFiles(diff: string): FileDiff[] {
  return diff
    .split(/^diff --git /m)
    .filter(Boolean)
    .map((section) => {
      const path = section.match(/^a\/(.+?)\s/)?.[1] ?? 'unknown';
      return { path, content: 'diff --git ' + section };
    });
}

/** Build a file-list header from parsed file diffs. */
function buildFileListHeader(files: FileDiff[]): string {
  return `Changed files (${files.length}):\n${files.map((f) => `  ${f.path}`).join('\n')}\n\n`;
}

/**
 * Build a condensed diff representation that fits within token limits.
 * Always includes the list of changed files, then packs as many diff
 * hunks as will fit -- prioritising smaller files so more context is
 * captured across the changeset.
 */
function buildDiffPayload(diff: string, files: FileDiff[]): string {
  const header = buildFileListHeader(files);

  if (diff.length <= MAX_DIFF_CHARS) {
    return header + diff;
  }

  // Pack hunks smallest-first to maximise file coverage
  const sorted = [...files].sort((a, b) => a.content.length - b.content.length);
  let budget = MAX_HUNK_CHARS;
  const included: string[] = [];

  for (const file of sorted) {
    if (file.content.length <= budget) {
      included.push(file.content);
      budget -= file.content.length;
    }
  }

  const omitted = files.length - included.length;
  const footer = omitted > 0 ? `\n... (${omitted} file diff(s) omitted for brevity)` : '';

  return header + included.join('\n') + footer;
}

/** Group file diffs into batches of roughly `BATCH_TARGET_CHARS`, capped at `MAX_BATCHES`. */
function batchFileDiffs(files: FileDiff[]): FileDiff[][] {
  const batches: FileDiff[][] = [];
  let current: FileDiff[] = [];
  let currentLen = 0;

  for (const file of files) {
    // If adding this file exceeds the target and the batch isn't empty, start a new batch
    if (current.length > 0 && currentLen + file.content.length > BATCH_TARGET_CHARS) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(file);
    currentLen += file.content.length;
  }
  if (current.length > 0) {
    batches.push(current);
  }

  // If we exceeded MAX_BATCHES, merge trailing batches into the last allowed one
  if (batches.length > MAX_BATCHES) {
    const merged = batches.slice(MAX_BATCHES - 1).flat();
    batches.length = MAX_BATCHES - 1;
    batches.push(merged);
  }

  return batches;
}

/** Shared fetch + parse for OpenAI chat completions. Retries once on empty content. */
async function callApi(apiKey: string, systemPrompt: string, userContent: string): Promise<string> {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        max_completion_tokens: 1000,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error('git', 'OpenAI API error', { status: response.status, err });
      if (response.status === 401) {
        throw new Error('Invalid API key. Check Settings > AI Integration.');
      }
      if (response.status === 404) {
        throw new Error('Model not found. The gpt-5-nano model may not be available on your plan.');
      }
      throw new Error(`OpenAI API error (${response.status}): ${err.slice(0, 100)}`);
    }

    const data = await response.json();
    logger.debug('git', 'OpenAI raw response', { data: JSON.stringify(data).slice(0, 500) });

    const raw = data.choices?.[0]?.message?.content?.trim()
      || (typeof data.output === 'string' ? data.output.trim() : '');

    if (raw) return raw;

    // Reasoning models occasionally return null content — retry once
    logger.warn('git', 'Empty content from API, retrying', { attempt, responseKeys: Object.keys(data) });
  }

  throw new Error('API returned an empty response after retry. Check logs for details.');
}

/** Strip wrapping quotes and ensure the description starts with a lowercase letter. */
function cleanCommitMessage(raw: string): string {
  return raw
    .replace(/^(['"])(.+)\1$/, '$2')
    .replace(/^(\w+):\s*([A-Z])/, (_, prefix, ch) => `${prefix}: ${ch.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateCommitMessage(diff: string, onProgress?: ProgressCallback): Promise<string> {
  const apiKey = store.getState().settings.openaiApiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key not set. Configure it in Settings > AI Integration.');
  }

  const files = splitDiffIntoFiles(diff);

  // ---- Small diff: single-call path ----
  if (diff.length <= MAX_DIFF_CHARS) {
    const payload = buildDiffPayload(diff, files);
    logger.debug('git', 'Generating commit message (single-call)', { diffLength: diff.length, payloadLength: payload.length });

    onProgress?.('Generating...');
    const raw = await callApi(apiKey, SYSTEM_PROMPT, `Generate a commit message for this diff:\n\n${payload}`);
    const message = cleanCommitMessage(raw);

    logger.info('git', 'Generated commit message', { message });
    return message;
  }

  // ---- Large diff: two-tier path ----
  logger.debug('git', 'Large diff detected, using two-tier generation', { diffLength: diff.length });

  const batches = batchFileDiffs(files);
  const totalBatches = batches.length;

  logger.debug('git', 'Two-tier batches', { fileCount: files.length, batchCount: totalBatches });

  // Step 1: Summarise all batches in parallel
  let completed = 0;
  onProgress?.(`Working 0/${totalBatches}...`);

  const summaries = await Promise.all(
    batches.map(async (batch, i) => {
      const batchContent = batch.map((f) => f.content).join('\n');
      const summary = await callApi(apiKey, SUMMARISE_PROMPT, `Summarise the changes in this diff batch:\n\n${batchContent}`);
      logger.debug('git', `Batch ${i + 1}/${totalBatches} summary`, { summary: summary.slice(0, 300) });
      completed++;
      onProgress?.(`Working ${completed}/${totalBatches}...`);
      return summary;
    }),
  );

  // Step 2: Synthesise final commit message from combined summaries
  onProgress?.('Finalising...');

  const synthesisInput = buildFileListHeader(files) + `Summaries of all changes:\n${summaries.join('\n\n')}`;
  const raw = await callApi(apiKey, SYSTEM_PROMPT, `Generate a commit message based on these change summaries:\n\n${synthesisInput}`);
  const message = cleanCommitMessage(raw);

  logger.info('git', 'Generated commit message (two-tier)', { message, batchCount: totalBatches });
  return message;
}
