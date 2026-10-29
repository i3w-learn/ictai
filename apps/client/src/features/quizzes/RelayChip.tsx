import { useRelayStatus } from '../../app/app-context';

// Spec 6 status chip: shows whether live updates are flowing.
export function RelayChip() {
  const status = useRelayStatus();
  if (status === 'online') return <span className="text-xs font-medium text-success">● Live</span>;
  if (status === 'off') return null;
  return <span className="text-xs font-medium text-muted-foreground">Reconnecting…</span>;
}
