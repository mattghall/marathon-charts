# marathon-charts

Compare marathon elevation profiles from GPX files in a local static web app.

## Development

Install dependencies:

```bash
npm install
```

Start the local dev server with automatic reload:

```bash
npm run dev
```

Then open the local URL printed by Vite, usually `http://localhost:5173`.

## Features

- Load multiple GPX race files from `courses/`
- Compare each route on one elevation chart with a unique color
- Toggle races on and off with checkboxes
- Automatically scale the Y axis to the highest selected elevation
