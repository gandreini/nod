import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
const nav = globalThis.navigator as (Navigator & { languages?: readonly string[] }) | undefined;
if (nav && !Array.isArray(nav.languages))
  Object.defineProperty(nav, 'languages', {
    value: [Intl.DateTimeFormat().resolvedOptions().locale],
    configurable: true,
  });
