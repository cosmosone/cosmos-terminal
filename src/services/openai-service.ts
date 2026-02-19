import { logger } from './logger';
import { store } from '../state/store';

/**
 * Hard cap on raw diff input. Diffs larger than this are truncated before any
 * processing to prevent excessive memory use and runaway API costs.
 * 500 KB covers even very large changesets while staying well within reason.
 */
const MAX_RAW_DIFF_CHARS = 500_000;

/** Max characters for the single-call path (small diffs). */
const MAX_DIFF_CHARS = 14000;

/** Target size per batch in the two-tier path. */
const BATCH_TARGET_CHARS = 12000;
/** Hard cap on number of batches to avoid runaway API calls. */
const MAX_BATCHES = 8;

export type ProgressCallback = (label: string) => void;

const SYSTEM_PROMPT = `You are a commit message generator that analyses git diffs.

Rules:
1. Use exactly one conventional commit prefix: feat, fix, chore, refactor, docs, style, test, perf.
2. First line format: <prefix>: <lowercase description>
3. Use Australian English spelling (e.g. colour, initialise, behaviour, organisation, analyse, centre).
4. Keep the first line (subject) max 72 characters.
5. After the subject line, add a blank line then up to 3 bullet points detailing the key changes.
6. Each bullet point starts with "- " and describes a specific change concisely.
7. Group related changes together. Focus on what changed and why, not trivial details.
8. For very small/simple changes (1-2 files, single concern), omit the bullet points entirely.
9. Output ONLY the commit message — no quotes, no explanation, no markdown fences.

Example for a multi-file change:
feat: add colour picker to the settings page

- Add ColourPicker component with hue/saturation/lightness controls
- Integrate picker into SettingsForm with live preview and user preferences storage
- Update theme engine to apply custom accent colour on load

Example for a simple change:
fix: correct initialisation order for the auth service`;

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

/** Build a diff payload with a file-list header for the single-call path. */
function buildDiffPayload(diff: string, files: FileDiff[]): string {
  return buildFileListHeader(files) + diff;
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
        max_completion_tokens: 2000,
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

/** Strip wrapping quotes/fences and ensure the subject starts with a lowercase letter. */
function cleanCommitMessage(raw: string): string {
  let msg = raw.trim();

  // Strip markdown code fences if the model wrapped its output
  msg = msg.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

  // Strip wrapping quotes around the entire message
  msg = msg.replace(/^(['"])([\s\S]+)\1$/, '$2').trim();

  // Ensure subject line description starts with a lowercase letter
  msg = msg.replace(/^(\w+):\s*([A-Z])/, (_, prefix, ch) => `${prefix}: ${ch.toLowerCase()}`);

  return msg;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateCommitMessage(diff: string, onProgress?: ProgressCallback): Promise<string> {
  const apiKey = store.getState().settings.openaiApiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key not set. Configure it in Settings > AI Integration.');
  }

  // Hard-cap the raw diff to prevent excessive memory use and API costs
  if (diff.length > MAX_RAW_DIFF_CHARS) {
    logger.warn('git', 'Diff truncated for commit message generation', {
      originalLength: diff.length,
      maxLength: MAX_RAW_DIFF_CHARS,
    });
    diff = diff.slice(0, MAX_RAW_DIFF_CHARS);
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
  const raw = await callApi(apiKey, SYSTEM_PROMPT, `Generate a commit message based on these change summaries. Remember: maximum 3 bullet points — consolidate related changes.\n\n${synthesisInput}`);
  const message = cleanCommitMessage(raw);

  logger.info('git', 'Generated commit message (two-tier)', { message, batchCount: totalBatches });
  return message;
}
