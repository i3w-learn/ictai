import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mr } from './mr';

// The app in more than one language. English is written straight into the screens, as before, and is
// also the key: t('Sign out') gives 'Sign out' in English and its Marathi from mr.ts in Marathi.
// A sentence that has no Marathi yet shows in English, so a missing line never breaks a screen.
//
// How to write a screen:
//   const t = useT();
//   <Button>{t('Sign out')}</Button>
//   t('{n} of {total} present', { n: 3, total: 30 })      // {name} is filled in after translating
// The first argument is always a plain string in quotes, never a `template`, so a test can find
// every sentence and check it has a Marathi line. A word list outside a component marks its words
// with tk('…') and the screen says t(word).
export type Lang = 'en' | 'mr';
export const LANGS: Record<Lang, string> = { en: 'English', mr: 'मराठी' };
const DICT: Record<Exclude<Lang, 'en'>, Record<string, string>> = { mr };

export type Vars = Record<string, string | number>;
export type T = (text: string, vars?: Vars) => string;

export function translate(lang: Lang, text: string, vars?: Vars): string {
  const said = lang === 'en' ? text : (DICT[lang][text] ?? text);
  return vars ? said.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : said;
}

// Marks a sentence kept in a list outside any component, for the test that looks for sentences.
export const tk = (text: string) => text;

// What dates and times are written with. Marathi month and day names, but the same digits (0-9)
// as the rest of the app, so "10 पैकी 7" and "23 नोव्हेंबर" sit together.
export const localeOf = (lang: Lang): string | undefined => (lang === 'mr' ? 'mr-IN-u-nu-latn' : undefined);

const KEY = 'ict.lang';
function saved(): Lang {
  try {
    return localStorage.getItem(KEY) === 'mr' ? 'mr' : 'en';
  } catch {
    return 'en';
  }
}

interface Value { lang: Lang; setLang: (lang: Lang) => void; t: T; locale: string | undefined }
const Ctx = createContext<Value>({ lang: 'en', setLang: () => undefined, t: (text, vars) => translate('en', text, vars), locale: undefined });

// The language is a choice of this PC, not of a person: it is there before anyone signs in, and the
// next student finds the PC as the last one left it.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(saved);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(KEY, next); } catch { /* the choice then lasts until the app closes */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  // The app's other window (the board window) changes language with this one.
  useEffect(() => {
    const changed = (e: StorageEvent) => { if (e.key === KEY) setLangState(saved()); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const value = useMemo<Value>(() => ({ lang, setLang, t: (text, vars) => translate(lang, text, vars), locale: localeOf(lang) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = (): T => useContext(Ctx).t;
export const useLang = () => useContext(Ctx);

// The switch in the top bar: one press changes every screen.
export function LanguageSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label="Language / भाषा" className="ui-chip flex shrink-0 items-center rounded-full border border-border p-0.5 text-sm">
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button
          key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}
          className={lang === l ? 'cursor-pointer rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground' : 'cursor-pointer rounded-full px-3 py-1 text-muted-foreground hover:text-foreground'}
        >
          {LANGS[l]}
        </button>
      ))}
    </div>
  );
}
