import type { Band } from '@ict/contracts';

// Same cut-offs as the server (60% and 30%).
export const bandOf = (percent: number): Band => (percent >= 60 ? 'great' : percent >= 30 ? 'growing' : 'needs');
