import { useRelayStatus } from '../../app/app-context';

// Spec 6 status chip: shows whether live updates are flowing.
export function RelayChip() {
  const status = useRelayStatus();
  if (status === 'online') return <span className="text-xs text-muted-foreground">Live updates on</span>;
  if (status === 'off') return null;
  return <span className="text-xs font-semibold text-destructive">Reconnecting…</span>;
}
