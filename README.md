# Weather Route · 날씨길

A browser-first commute weather planner. Set home and work with Google Maps, see current and hourly weather for both places, and get explainable **Best time to go / Best time to leave** windows.

The former provider-comparison dashboard is no longer part of the product. One selected weather provider powers the screen and recommendation at a time. User settings and commute scoring run locally in the browser.

See [README.ko.md](README.ko.md) for the complete Korean setup and deployment guide.

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm --dir apps/web dev
```

Open <http://localhost:3000>. Docker and the Python API are not required for the new static app.

## Validate and export

```powershell
pnpm --dir apps/web test
pnpm --dir apps/web lint
apps\web\node_modules\.bin\tsc.CMD --noEmit -p apps\web\tsconfig.json
pnpm --dir apps/web build
```

The static site is generated in `apps/web/out`.

## Deploy to GitHub Pages

Set **Settings → Pages → Source** to **GitHub Actions**, then push `main` or `master`. The workflow at `.github/workflows/pages.yml` builds and deploys the static export, including repository sub-path handling.

## Provider model

- MET Norway: low-volume direct browser requests; a caching proxy is recommended for public production.
- KMA Forecast: user-owned service key; a proxy is recommended for public production.
- Windy: Point Forecast key; Testing data is modified and not production-ready.
- AccuWeather: server-side proxy required. The browser never accepts an AccuWeather key.
- Windy Embed: visual past/current radar only; future rain decisions use the selected provider timeline.

Legacy API, database, comparison, and Docker files remain only for historical reference and are not used by the GitHub Pages app.
