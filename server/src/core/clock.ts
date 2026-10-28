// Injected everywhere instead of Date.now(), so tests can move time.
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
