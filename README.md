# Thrive Mural Map

A prototype map application that displays murals from a Google Sheet using the Google Maps JavaScript API.

## Setup

1. **Configure the CSV URL**: Edit `js/config.js` and update the `CSV_URL` to point to your published Google Sheet (File → Share → Publish to web → CSV format).

2. **Add your Google Maps API Key**: Edit `index.html` and replace `YOUR_GOOGLE_MAPS_API_KEY` with your actual API key (or update the existing key if needed).

## Running the Application

**Important**: You cannot open `index.html` directly in a browser (using `file://` protocol) because browsers block fetch requests to external URLs due to CORS restrictions.

### Option 1: Python HTTP Server (Recommended)

If you have Python installed:

**Windows:**
- Double-click `server.bat`, OR
- Open Command Prompt and run: `python server.py`

**Mac/Linux:**
```bash
python3 server.py
# or
python server.py
```

Then open http://localhost:8000 in your browser.

### Option 2: Python's Built-in Server

```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

Then open http://localhost:8000 in your browser.

### Option 3: Node.js http-server

If you have Node.js installed:

```bash
npx http-server -p 8000
```

Then open http://localhost:8000 in your browser.

### Option 4: VS Code Live Server

If you're using VS Code, install the "Live Server" extension and click "Go Live" in the status bar.

## Features

- Floating, glassmorphic sidebar that keeps filters visible on desktop and slides in on mobile via the floating toggle.
- "Find murals near me" workflow that leverages browser geolocation to surface the nearest murals, quick centering, and one-tap Google Maps directions.
- Curated tour cards plus tour filters that combine staff-created routes with any `tour_id` values that already exist in your dataset.
- Redesigned info windows with distance callouts, quick actions, and support for mobile layouts.

## Adding or Editing Curated Tours

Curated tours live in `js/config.js` under the `window.MURAL_TOURS` array. Each object accepts:

- `id`: short slug (e.g., `harlem`).
- `name` / `description`: text shown in the UI.
- `borough`: optional borough keyword used when auto-selecting stops.
- `keywords`: optional array of keywords matched against mural names, schools, boroughs, and themes.
- `limit`: maximum number of stops to include (defaults to all matches).
- `color`: optional hex value used for tour chips and polylines.

Example:

```js
window.MURAL_TOURS = [
  {
    id: "harlem",
    name: "Harlem Highlights",
    description: "Community murals in Harlem and upper Manhattan.",
    borough: "Manhattan",
    keywords: ["harlem", "academy"],
    color: "#f472b6",
    limit: 6
  }
];
```

Update the array, refresh your browser, and the new tour automatically appears in the curated cards, the tour filter chips, and the tour "View all" modal.

## Troubleshooting

- **CORS Error**: Make sure you're running the app from a web server, not by opening the HTML file directly.
- **CSV Not Loading**: Verify that your Google Sheet is published to the web (File → Share → Publish to web → CSV format) and the URL in `config.js` is correct.
- **No Markers Showing**: Check that your CSV has columns named `lat`/`latitude` and `lng`/`longitude` with valid coordinates, and a `name`/`mural_name`/`title` column.

