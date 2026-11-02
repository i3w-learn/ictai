import { z, type ZodType } from 'zod';

export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens: number;
  signal: AbortSignal;
}

// The one thing the quiz generator needs from a model: an answer in a given shape.
export interface Llm {
  json<T>(req: LlmRequest<T>): Promise<T>;
}

const Completion = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });

// llama-server's OpenAI-style endpoint. The JSON schema is turned into a grammar, so the
// reply always parses; it is still checked with zod because the grammar ignores some rules.
export class LlamaServerLlm implements Llm {
  constructor(
    private readonly runtime: { ensureReady(): Promise<void>; markDown(): void; baseUrl: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async json<T>(req: LlmRequest<T>): Promise<T> {
    await this.runtime.ensureReady();
    const res = await this.fetchFn(`${this.runtime.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        max_tokens: req.maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_schema', json_schema: { name: 'out', schema: z.toJSONSchema(req.schema) } },
      }),
    }).catch((err: unknown) => {
      // Not our own timeout: llama-server went away, so the next request should start it again.
      if (!req.signal.aborted) this.runtime.markDown();
      throw err;
    });
    if (!res.ok) throw new Error(`llama-server answered ${res.status}`);
    const content = Completion.parse(await res.json()).choices[0]!.message.content;
    return req.schema.parse(JSON.parse(content));
  }
}
