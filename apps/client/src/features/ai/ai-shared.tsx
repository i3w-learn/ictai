import type { AiLanguage, AiStatus } from '@ict/contracts';

export const LANGUAGES: Record<AiLanguage, string> = { en: 'English', hi: 'हिंदी (Hindi)' };

// Why the AI cannot be used right now, in plain words, or null when it can.
export function AiUnavailable({ status }: { status: AiStatus }) {
  const why = !status.enabled
    ? 'AI is switched off for this school. The Super Admin can switch it on in Settings.'
    : !status.installed ? 'AI is not installed on this server. Ask your Super Admin to install the AI kit.' : null;
  return why && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">{why}</p>;
}

export const aiUsable = (status: AiStatus) => status.enabled && status.installed;
