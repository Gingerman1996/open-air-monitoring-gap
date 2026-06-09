export type Lang = 'en' | 'th';

/** App-wide language. EN/TH toggle, persisted to localStorage. Technical tokens stay English. */
export function useLang() {
  const lang = useState<Lang>('lang', () => 'en');

  const setLang = (l: Lang) => {
    lang.value = l;
    if (import.meta.client) {
      try {
        localStorage.setItem('demo-lang', l);
      } catch {
        /* storage unavailable — language just won't persist */
      }
    }
  };

  const t = (en: string, th: string) => (lang.value === 'th' ? th : en);

  return { lang, setLang, t };
}
