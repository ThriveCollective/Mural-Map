// Global configuration for the mural map prototype.
// Update these values for your own Sheet / defaults.

window.MURAL_MAP_CONFIG = {
    // 1. CSV URL from "Publish to web" in Google Sheets (format: CSV).
    // Example:
    // "https://docs.google.com/spreadsheets/d/XYZ/pub?output=csv"
  CSV_URL: "__CSV_URL_PLACEHOLDER__",
      
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
window.MURAL_TOURS = [];