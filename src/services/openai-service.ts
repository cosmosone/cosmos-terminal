import { logger } from './logger';
import { store } from '../state/store';

const MAX_DIFF_CHARS = 12000;

const SYSTEM_PROMPT = `You are a commit message generator. Given a git diff, write a concise conventional commit message.
Use one of these prefixes: feat, fix, chore, refactor, docs, style, test, perf.
Format: <prefix>: <short description>
Keep it to a single line, max 72 characters. No body, no quotes, just the message.`;

export async function generateCommitMessage(diff: string): Promise<string> {
  const apiKey = store.getState().settings.openaiApiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key not set. Configure it in Settings > AI Integration.');
  }

  const truncatedDiff = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)'
    : diff;

  logger.debug('git', 'Generating commit message', { diffLength: diff.length });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Generate a commit message for this diff:\n\n${truncatedDiff}` },
      ],
      max_tokens: 100,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error('git', 'OpenAI API error', { status: response.status, err });
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message?.content?.trim() || '';
  logger.info('git', 'Generated commit message', { message });
  return message;
}
