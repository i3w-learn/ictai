import { Button, Select } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import type { ShowHost } from './useShowHost';

// The teacher's pen controls in the show row: who has the pen and "Take the pen back", or the
// drop-down to give it. Every piece is one height and pill-shaped so the row lines up.
export function PenRow({ host }: { host: ShowHost }) {
  const t = useT();
  const { live, busy } = host;
  const watching = live?.watching ?? [];
  return live?.pen ? (
    <>
      <span className="flex h-11 items-center text-base">{t('{name} has the pen.', { name: live.pen.name })}</span>
      <Button variant="quiet" disabled={busy.pen} onClick={() => host.givePen(null)}>{t('Take the pen back')}</Button>
    </>
  ) : (
    <Select aria-label={t('Give the pen to a student')} className="w-auto rounded-full !text-base" value="" disabled={busy.pen || watching.length === 0} onChange={(e) => { if (e.target.value) void host.givePen(e.target.value); }}>
      <option value="">{watching.length ? t('Give the pen to…') : t('No student screen has it open yet')}</option>
      {watching.map((w) => <option key={w.studentId} value={w.studentId}>{w.name}</option>)}
    </Select>
  );
}
