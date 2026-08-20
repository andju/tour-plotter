## Commands

```bash
npm run dev                                       # dev server
npm run build                                     # production static build -> build/
npm run preview                                    # serve the production build locally
npm run check                                      # svelte-check + tsc (app + scripts/)
npm run test                                       # unit tests, single pass (vitest run)
npm run test:watch                                 # unit tests, watch mode
npx vitest run path/to/file.test.ts -t "name"       # one file / one test
npm run test:e2e                                    # e2e (builds + previews, then runs Chromium)
npx playwright test e2e/export.spec.ts -g "name"    # one e2e file / one test
npm run fetch-basemap                               # re-fetch static/basemap/*.json from Natural Earth
```
