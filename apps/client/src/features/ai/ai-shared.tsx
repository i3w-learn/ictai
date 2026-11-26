import type { AiLanguage, AiStatus } from '@ict/contracts';
import { useT } from '../../i18n/i18n';

// The languages the AI can write in. Each is named in its own language, so it is not translated.
export const LANGUAGES: Record<AiLanguage, string> = { en: 'English', hi: 'हिंदी (Hindi)' };

// Why the AI cannot be used right now, in plain words, or null when it can.
export function AiUnavailable({ status }: { status: AiStatus }) {
  const t = useT();
  const why = !status.enabled
    ? t('AI is switched off for this school. The Super Admin can switch it on in Settings.')
    : !status.installed ? t('AI is not installed on this server. Ask your Super Admin to install the AI kit.') : null;
  return why && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{why}</p>;
}

export const aiUsable = (status: AiStatus) => status.enabled && status.installed;
