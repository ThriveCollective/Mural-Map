// Global configuration for the mural map prototype.
// Update these values for your own Sheet / defaults.

window.MURAL_MAP_CONFIG = {
    // 1. CSV URL from "Publish to web" in Google Sheets (format: CSV).
    // Example:
    // "https://docs.google.com/spreadsheets/d/XYZ/pub?output=csv"
  CSV_URL:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQGG7nJALaHS51jJ7BEcfeu-MqPPoTXUo5hkJd1NE-tTn9W76gduRp5dPDoOEsQMFbd8LYm4Oq8-R9_/pub?output=csv",
      
    // 2. Default map view (New York City center).
    DEFAULT_CENTER: { lat: 40.7128, lng: -74.006 },
  
    // 3. Default zoom level (11 = city level view).
    DEFAULT_ZOOM: 11,

    // 4. Map ID from Google Cloud Console (Required for Advanced Markers).
    MAP_ID: "DEMO_MAP_ID",

    // 5. Geocoding suffix to ensure addresses are found in the correct area.
    GEOCODE_LOCATION_SUFFIX: ", New York, NY"
  };
  
// Curated tours that can be extended by Thrive staff.
// Add a new object with an `id`, `name`, `description`, `borough`,
// optional highlight `color`, and `keywords` that help match murals.
// Keywords are matched against mural name, school, borough, and theme fields.
// Use `limit` to cap the number of stops that are auto-selected.
window.MURAL_TOURS = [];
