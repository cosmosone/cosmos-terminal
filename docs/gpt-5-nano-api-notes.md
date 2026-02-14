# GPT-5-Nano API Parameter Reference

Notes on parameter support for the `gpt-5-nano` model used in commit message generation.
Last verified: 2026-02-15.

## Supported Parameters

| Parameter              | Supported | Notes                                                        |
|------------------------|-----------|--------------------------------------------------------------|
| `model`                | Yes       | Use `gpt-5-nano`                                             |
| `messages`             | Yes       | Standard chat completions format (system + user messages)     |
| `max_completion_tokens`| Yes       | Caps reasoning + output tokens combined. Must be generous.    |
| `reasoning_effort`     | Yes       | `minimal`, `low`, `medium`, `high`. Use `low` for speed.     |

## Unsupported Parameters

| Parameter    | Status         | Error Message                                                    |
|--------------|----------------|------------------------------------------------------------------|
| `temperature`| Not supported  | `Unsupported value: 'temperature' does not support 0.3 with this model` |
| `top_p`      | Not supported  | Reasoning models forbid sampling parameters                       |
| `max_tokens` | Not supported  | `Unsupported parameter: 'max_tokens' is not supported with this model`  |

## Critical: Reasoning Token Budget

gpt-5-nano is a **reasoning model**. The `max_completion_tokens` budget is shared between
internal reasoning tokens and the visible output content.

**If `max_completion_tokens` is too low, ALL tokens go to reasoning and the response `content`
will be an empty string `""`.**

Example of the failure (from actual logs):
```
"completion_tokens": 100,
"completion_tokens_details": { "reasoning_tokens": 100 }
"content": "",
"finish_reason": "length"
```

In this case, 100 tokens were allocated, reasoning consumed all 100, leaving 0 for output.

### Recommended Settings

For commit message generation (short output, simple reasoning needed):
```json
{
  "model": "gpt-5-nano",
  "max_completion_tokens": 1000,
  "reasoning_effort": "low"
}
```

- `max_completion_tokens: 1000` gives ample room for reasoning + a one-line commit message.
- `reasoning_effort: "low"` minimises reasoning token usage for faster, cheaper responses.
- Do NOT set it below ~500, or reasoning may consume the entire budget again.

## References

- https://community.openai.com/t/gpt-5-nano-accepted-parameters/1355086
- https://community.openai.com/t/gpt-5-gpt-5-mini-and-gpt-5-nano-now-available-in-the-api/1337048
- https://learn.microsoft.com/en-us/answers/questions/5590694/ai-foundry-model-gpt-5-nano-returns-empty-response
