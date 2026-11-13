import { DEFAULT_PREFS, type StudentPrefs } from '@ict/contracts';

// The student's choices become three markers on the page's root; the stylesheet does the rest.
// null (nobody signed in, or staff) clears them, so one student's choices never stay for the next.
export function prefsAttrs(prefs: StudentPrefs | null): Record<'text' | 'contrast' | 'font', string | null> {
  const p = prefs ?? DEFAULT_PREFS;
  return {
    text: p.textSize === 'normal' ? null : p.textSize,
    contrast: p.highContrast ? 'high' : null,
    font: p.easyFont ? 'easy' : null,
  };
}

export function applyPrefs(prefs: StudentPrefs | null) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(prefsAttrs(prefs))) {
    if (value === null) delete root.dataset[key];
    else root.dataset[key] = value;
  }
}
