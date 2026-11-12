import { useRelayStatus } from '../../app/app-context';

// Spec 6 status chip, shown in the top bar on every screen once someone is signed in:
// it says whether this PC is in touch with the server.
export function RelayChip() {
  const status = useRelayStatus();
  if (status === 'off') return null;
  const online = status === 'online';
  return (
    <span
      role="status"
      className={
        online
          ? 'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground'
          : 'inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive'
      }
    >
      <span className={online ? 'size-2 rounded-full bg-success' : 'size-2 animate-pulse rounded-full bg-destructive'} />
      {online ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </span>
  );
}
