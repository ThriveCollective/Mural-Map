# Thrive Mural Map

An interactive mural discovery app built for Thrive projects. It displays mural data from a CSV source on a Google Map, supports search and filters, curated tours, saved favorites, nearby mural lookup, and dynamic info windows.

## Project overview

This repository includes a static web app that:

- loads mural records from a published Google Sheet or other CSV source,
- geocodes mural addresses when needed,
- displays clustered markers on Google Maps,
- supports filtering by borough, school, year, setting, and tour,
- provides curated tours and nearby mural directions,
- renders featured murals and saved mural cards in the sidebar.

## Files and structure

- `index.html` — main page and app shell.
- `css/style.css` — styling for the map, sidebar, and responsive UI.
- `js/config.js` — configuration values and curated tour definitions.
- `js/map.js` — main application logic, map initialization, data loading, filtering, and UI behavior.
- `server.py` / `server.bat` — lightweight local server wrappers for development.
- `City_Council_Districts.geojson` — optional district boundaries rendered on the map.
- `data/` — additional data files and sample CSV content.

## Setup

### 1. Configure the CSV source

Edit `js/config.js` and set `CSV_URL` to the published CSV link for your source data.

The app expects a CSV with at least the following fields:

- `name`, `mural_name`, `mural_title`, or `title`
- `address` or `street_address`

Optional fields include:

- `borough`
- `year`
- `school_name`, `site_name`, or `school`
- `theme` or `tags`
- `tour_id` or `tour`
- `location`, `setting`, `interior_exterior`, or `placement`
- `image_url`, `image_urls`, or `thumbnail_url`

> Tip: The CSV parser is flexible about column names, but the `name/title` and `address/street_address` columns are required.

### 2. Add your Google Maps API key

Copy `secretconfig.example.js` to `secretconfig.js` and replace `YOUR_GOOGLE_MAPS_API_KEY_HERE` with your actual key.

`secretconfig.js` is ignored by Git so your key is not committed.

### 3. Run locally

You must serve the app over HTTP because the browser blocks fetch requests from `file://`.

#### Recommended: Python HTTP server

**Windows:**
- Double-click `server.bat`, or
- run `python server.py`

**macOS/Linux:**
```bash
python3 server.py
# or
python server.py
```

Open `http://localhost:8000` in your browser.

#### Alternative: Python built-in server

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

#### Alternative: Node.js http-server

```bash
npx http-server -p 8000
```

#### Alternative: VS Code Live Server

Install the Live Server extension and click **Go Live**.

## Configuration

### `js/config.js`

This file sets the CSV URL, default map center and zoom, and curated tours.

Example settings:

```js
window.MURAL_MAP_CONFIG = {
  CSV_URL: "https://docs.google.com/spreadsheets/d/.../export?format=csv",
  DEFAULT_CENTER: { lat: 40.7128, lng: -74.0060 },
  DEFAULT_ZOOM: 11,
  MAP_ID: "YOUR_MAP_ID"
};
```

### Curated tours

Add or update curated tours in `window.MURAL_TOURS` inside `js/config.js`.

Each tour can include:

- `id` — unique identifier
- `name` — display title
- `description` — tour text
- `borough` — optional borough filter
- `keywords` — mural matching keywords
- `limit` — max number of stops
- `color` — marker/tour color

## Features

- Responsive map and sidebar layout
- Search and filter murals by name, borough, school, year, setting, and tour
- Marker clustering for dense mural collections
- Featured murals panel with “Surprise Me” and refresh support
- Saved murals list persisted in local storage
- Nearest mural lookup and transit directions
- City council district overlay with toggle
- Background geocoding for murals with addresses

## Deployment

For static hosting, deploy the contents of this repository and configure the Google Maps API key in the host environment.

If using Vercel, set a `GOOGLE_MAPS_API_KEY` environment variable and let the build script generate `secretconfig.js` as required.

## Troubleshooting

- **App won’t load**: Confirm you are using `http://localhost:8000`, not `file://`.
- **CSV fetch fails**: Ensure your Google Sheet is published to the web as CSV and the URL is valid.
- **No map markers**: Verify the CSV includes required columns and that the data is properly encoded.
- **Google Maps errors**: Check the API key, billing status, and referer restrictions.

## Notes

- `secretconfig.js` should remain local and should not be checked into source control.
- The app uses `js/map.js` as the main controller for data loading, filtering, marker creation, and UI behavior.
- The dataset is loaded on page initialization, then geocoded in the background if needed.
