let map;
let markers = [];
let infoWindow;
let allMurals = [];
let clusterer;
let currentVisibleMurals = [];
let activeFilters = {
  search: "",
  year: null,
  school: null,
  borough: null,
  setting: null, // NEW: Filter by setting
  tour: null,
  muralView: 100 // Percentage of murals to show (25, 50, 75, 100)
};
let narratorEnabled = localStorage.getItem('enableNarrator') === 'true';
let userLocation = null;
let userLocationMarker = null;
let userAccuracyCircle = null;
let curatedTours = [];
let searchInfoWindow = null; // Dedicated info window for search results
let searchConnectionLines = []; // Lines connecting search dot to nearby murals
let curatedTourStops = new Map();
let activeTourPolyline = null;
let modalData = { schools: [], boroughs: [], tours: [] };
let modalListenersBound = false;
let tourStopNumbers = new Map(); // Maps mural UID to stop number for active tour
let tourMarkers = []; // Separate array for numbered tour markers (not clustered)
let districtLabels = []; // Global scope so theme toggle can access it
let activeTourDefinition = null; // Stores the full object of the currently active tour
let activeTourCursor = 0; // Current stop index in the active tour
let activeTourOrderedStops = []; // Ordered list of stops for the active tour
// Services for Directions
let zoomTimeout;
let lastZoomLevel = null;
let directionsService = null;
let directionsRenderer = null;
let routeRenderers = [];
let muralHistory = JSON.parse(localStorage.getItem('mural_history') || '[]');
let savedMurals = JSON.parse(localStorage.getItem('saved_murals') || '[]');

// ── Theme Helper ─────────────────────────────────────────────────────────────
/**
 * Determines if the UI should be in light mode based on localStorage or system preference.
 * This ensures the map and sidebar are in sync immediately on load.
 */
function getInitialThemeIsLight() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    return savedTheme === 'light';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

// Apply the initial theme to the body immediately to prevent flashing
document.documentElement.classList.toggle('light-mode', getInitialThemeIsLight());

// ── Reverse-geocoding ────────────────────────────────────────────────────────
// geocoder is initialised inside initMap() once the Maps API is ready.
// geocodeCache stores lat,lng → street address so each location is only
// fetched once per session, no matter how many times its popup is opened.
let geocoder = null;
const geocodeCache = new Map(); // key: "lat,lng"  value: resolved address string
/**
 * Fetches the street address for given coordinates.
 * Uses the existing geocodeCache to minimize API calls.
 */
async function getAddressFromLatLng(lat, lng) {
  // Normalize to ~0.1 meter precision to ensure cache hits on identical locations
  const key = `${parseFloat(lat).toFixed(6)},${parseFloat(lng).toFixed(6)}`;
  
  // Return cached address if we already fetched it this session
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key);
    
  }

  // Initialize geocoder if it hasn't been already
  if (!geocoder) {
    geocoder = new google.maps.Geocoder();
  }

  try {
    const response = await geocoder.geocode({ location: { lat: parseFloat(lat), lng: parseFloat(lng) } });
    if (response.results && response.results[0]) {
      // Get the most relevant street address
      const address = response.results[0].formatted_address;
      // Cache it for future clicks
      geocodeCache.set(key, address);
      return address;
    }
  } catch (error) {
    console.error("Geocoding failed: ", error);
  }
  
  // Fallback if the API fails or no address is found
  return "Location coordinates only";
}

// Convenience access to config with fallbacks
const CONFIG = window.MURAL_MAP_CONFIG || {};
const CSV_URL = CONFIG.CSV_URL || "";
const DEFAULT_CENTER = CONFIG.DEFAULT_CENTER || { lat: 40.7128, lng: -74.006 };
const DEFAULT_ZOOM = CONFIG.DEFAULT_ZOOM || 11;
const MAP_ID = CONFIG.MAP_ID || "DEMO_MAP_ID";
const GEOCODE_LOCATION_SUFFIX = CONFIG.GEOCODE_LOCATION_SUFFIX || ", New York, NY";
const TOUR_DEFINITIONS = Array.isArray(window.MURAL_TOURS) ? window.MURAL_TOURS : [];
const CURATED_TOUR_PREFIX = "curated:";
const DATA_TOUR_PREFIX = "data:";
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
};

// Regex patterns cached for performance
const REGEX_IMAGE_SPLIT = /[\n,]+/;
const REGEX_ARTIST_SPLIT = /,\s*/;
const REGEX_THEME_SPLIT = /,\s*/;

// Standard Google Maps light style
const LIGHT_MAP_STYLE = [
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] }
];



// Dark theme for Google Maps
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#000000" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#f8fafc" }] }, // Maximum brightness text
  { elementType: "labels.text.stroke", stylers: [{ color: "#000000" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#64748b" }, { weight: 1 }] // Brighter administrative lines
  },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#000000" }]
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#475569" }, { weight: 0.8 }] // Clearer road outlines
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#0a0a0a" }]
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0f172a" }] // Deep blue but visible
  }
];

function calculateDistanceMeters(pointA, pointB) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(pointB.lat - pointA.lat);
  const dLng = toRad(pointB.lng - pointA.lng);
  const lat1 = toRad(pointA.lat);
  const lat2 = toRad(pointB.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(meters) {
  const miles = meters / 1609.344;
  return `${miles.toFixed(2)} mi`;
}

// Group murals by location (same lat/lng rounded to ~10 meters precision)
function getLocationKey(lat, lng) {
  // Round to ~5 decimal places (~1 meter precision)
  return `${Math.round(lat * 100000) / 100000},${Math.round(lng * 100000) / 100000}`;
}

// Group murals at the same location, keeping the first mural as representative
function groupByLocation(murals) {
  const locationMap = new Map();
  
  murals.forEach(mural => {
    if (mural.lat == null || mural.lng == null) return;
    const key = getLocationKey(mural.lat, mural.lng);
    if (!locationMap.has(key)) {
      locationMap.set(key, mural);
    }
  });
  
  return Array.from(locationMap.values());
}

function selectStopsForTour(definition) {
  const candidates = selectAllMatchingMurals(definition);
  
  // Group by location to get unique stops
  const uniqueLocationStops = groupByLocation(candidates);

  // Apply limit to unique locations
  if (definition.limit && uniqueLocationStops.length > definition.limit) {
    return uniqueLocationStops.slice(0, definition.limit);
  }

  return uniqueLocationStops;
}

function buildCuratedTours() {
  curatedTours = [];
  curatedTourStops = new Map();

  TOUR_DEFINITIONS.forEach(definition => {
    // Get all matching murals (for display)
    const allMatching = selectAllMatchingMurals(definition);
    // Get unique location stops (for polyline)
    const uniqueStops = selectStopsForTour(definition);
    
    // Determine tour setting based on its murals
    const settings = allMatching.map(m => (m.setting || "").toLowerCase());
    const hasInterior = settings.some(s => s.includes("interior") || s.includes("indoor"));
    const hasExterior = settings.some(s => s.includes("exterior") || s.includes("outdoor") || s === "");

    let tourSetting = "Exterior";
    if (hasInterior && hasExterior) tourSetting = "Mixed (Public Accessible)";
    else if (hasInterior) tourSetting = "Interior";

    curatedTours.push({ ...definition, stops: uniqueStops, tourSetting });
    curatedTourStops.set(definition.id, {
      definition,
      stops: uniqueStops, // For polyline - unique locations only
      allMurals: allMatching, // For filtering - all matching murals
      uidSet: new Set(allMatching.map(m => m.uid)), // For filtering
      tourSetting
    });
  });

  renderTourCards();
}

// Get all murals matching tour criteria (before location grouping)
function selectAllMatchingMurals(definition) {
  if (!definition || !allMurals.length) return [];

  const boroughNeedle = definition.borough ? definition.borough.toLowerCase().trim() : null;
  const keywordNeedles = Array.isArray(definition.keywords)
    ? definition.keywords.map(k => k.toLowerCase())
    : [];

  let candidates = allMurals.filter(mural => {
    // Strict borough matching - must be exact match (case-insensitive)
    if (boroughNeedle) {
      const muralBorough = (mural.borough || "").toLowerCase().trim();
      if (muralBorough !== boroughNeedle) {
        return false;
      }
    }
    
    // If keywords are specified, at least one must match
    if (keywordNeedles.length > 0) {
      const haystack = `${mural.name} ${mural.school || ""} ${mural.theme || ""} ${mural.borough || ""}`.toLowerCase();
      return keywordNeedles.some(kw => haystack.includes(kw));
    }
    
    return true;
  });

  // If no candidates found with keywords, fall back to borough-only (but still strict match)
  if (!candidates.length && boroughNeedle && keywordNeedles.length > 0) {
    candidates = allMurals.filter(mural => {
      const muralBorough = (mural.borough || "").toLowerCase().trim();
      return muralBorough === boroughNeedle;
    });
  }

  return candidates;
}

function renderTourCards() {
  const container = document.getElementById("tourCards");
  if (!container) return;

  container.innerHTML = "";

  // ── Update the "Custom Local Tour" Button State ──
  const customTourId = `${CURATED_TOUR_PREFIX}custom-near-me`;
  const isCustomActive = activeFilters.tour === customTourId;
  const topBtn = document.getElementById("createCustomTourBtn");
  
  if (topBtn) {
    topBtn.innerHTML = isCustomActive 
      ? '<span>🛑</span> End Custom Tour' 
      : '<span>✨</span> Create Local Tour';
    topBtn.classList.toggle('active', isCustomActive);
    // Note: click handler is set up by setupCreateCustomTourButton() on page load
  }

  if (!curatedTours.length) {
    const note = document.createElement("p");
    note.className = "tours-panel-subtitle";
    note.textContent = "Use 'Create Local Tour' above to generate a custom itinerary.";
    container.appendChild(note);
    return;
  }

  curatedTours.forEach(tour => {
    const card = document.createElement("article");
    card.className = "tour-card";

    const chipBg     = tour.color ? `${tour.color}22` : "rgba(59, 130, 246, 0.15)";
    const chipBorder = tour.color || "rgba(59, 130, 246, 0.4)";
    const prefixedId = `${CURATED_TOUR_PREFIX}${tour.id}`;
    const isActive   = activeFilters.tour === prefixedId;

    card.innerHTML = `
      <div class="tour-card-head">
        <h3 style="color: var(--heading-color)">${tour.name}</h3>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <span class="tour-chip" style="background:${chipBg}; border:1px solid ${chipBorder}; color: var(--text-main);">
            ${tour.stops.length || 0} stops
          </span>
          <span class="tour-chip" style="background: rgba(0,0,0,0.2); border: 1px solid ${
            tour.tourSetting.includes("Mixed") ? "var(--brand-pink)" : 
            tour.tourSetting === "Interior" ? "var(--brand-blue)" : "var(--brand-green)"
          }; color: var(--text-main); font-size: 10px; padding: 2px 8px; white-space: nowrap;">
            ${tour.tourSetting}
          </span>
        </div>
      </div>
      <p style="color: var(--text-main); opacity: 0.8;">${tour.description || "Add a description in js/config.js"}</p>
      <footer>
        <span class="tour-card-meta">${tour.borough || "Multi-borough"}</span>
        <button type="button"
                data-tour-id="${tour.id}"
                class="${isActive ? 'end-tour' : ''}">
          ${isActive ? 'End tour' : 'Start tour'}
        </button>
      </footer>
    `;

    const btn = card.querySelector("button");
    btn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isActive) {
        // ── End tour: clear everything and return to default map ──
        activeFilters.tour = null;
        activeTourDefinition = null;
        tourStopNumbers.clear();
        // Remove the polyline
        if (activeTourPolyline) {
          activeTourPolyline.setMap(null);
          activeTourPolyline = null;
        }
        // Remove numbered tour markers
        tourMarkers.forEach(m => m.setMap(null));
        tourMarkers = [];
        // Restore all murals and re-cluster
        currentVisibleMurals = allMurals;
        createMarkers(allMurals);
      } else {
        // ── Start tour: activate this tour ──
        activeFilters.tour = prefixedId;
        activeTourDefinition = tour;
        activeTourCursor = 0;
        activeTourOrderedStops = orderStopsForTour(tour.stops);
        applyFilters();
        renderTourItinerary();
      }

      // Re-render cards so every button reflects the new state
      renderTourCards();
      populateFilters();
    });

    container.appendChild(card);
  });
}

// Order stops using nearest-neighbor algorithm for logical routing
function orderStopsForTour(stops) {
  if (stops.length <= 1) return stops;

  // Start with the northernmost stop (highest latitude) as the starting point
  const sortedByLat = [...stops].sort((a, b) => b.lat - a.lat);
  const ordered = [sortedByLat[0]];
  const remaining = sortedByLat.slice(1);

  // Use nearest-neighbor to find the next closest stop
  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let nearestIndex = 0;
    let nearestDistance = calculateDistanceMeters(
      { lat: current.lat, lng: current.lng },
      { lat: remaining[0].lat, lng: remaining[0].lng }
    );

    for (let i = 1; i < remaining.length; i++) {
      const distance = calculateDistanceMeters(
        { lat: current.lat, lng: current.lng },
        { lat: remaining[i].lat, lng: remaining[i].lng }
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    ordered.push(remaining[nearestIndex]);
    remaining.splice(nearestIndex, 1);
  }

  return ordered;
}

function updateTourPolyline() {
  // Clear any existing tour polyline
  if (activeTourPolyline) {
    activeTourPolyline.setMap(null);
    activeTourPolyline = null;
  }

  // If no tour is active, just clear stop numbers — caller handles markers
  if (!map || !activeFilters.tour || !activeFilters.tour.startsWith(CURATED_TOUR_PREFIX)) {
    tourStopNumbers.clear();
    return;
  }

  const tourId = activeFilters.tour.replace(CURATED_TOUR_PREFIX, "");
  const entry = curatedTourStops.get(tourId);
  if (!entry) {
    tourStopNumbers.clear();
    return;
  }

  const color = entry.definition.color || "#3b82f6";

  // Only keep tour stops that survived all active filters
  // currentVisibleMurals is already filtered by year/school/borough/search
  const visibleUids = new Set(currentVisibleMurals.map(m => m.uid));
  const filteredStops = entry.stops.filter(stop => visibleUids.has(stop.uid));

  // Need at least 2 stops to draw a meaningful route
  if (filteredStops.length < 2) {
    tourStopNumbers.clear();
    return;
  }

  // Order the surviving stops logically
  const orderedStops = orderStopsForTour(filteredStops);

  // Rebuild tourStopNumbers — createMarkers will use this immediately after
  tourStopNumbers.clear();
  orderedStops.forEach((stop, index) => {
    tourStopNumbers.set(stop.uid, index + 1);
  });

  // Draw the polyline connecting only the filtered stops
  const path = orderedStops.map(stop => ({ lat: stop.lat, lng: stop.lng }));
  activeTourPolyline = new google.maps.Polyline({
    map,
    path,
    strokeColor: color,
    strokeOpacity: 1,
    strokeWeight: 6,
    icons: [{
      icon: {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 4,
        strokeColor: color,
        fillColor: color,
        fillOpacity: 1,
        strokeOpacity: 1
      },
      offset: '15%',
      repeat: '70px'
    }]
  });

  // Fit the map to the bounds of the tour stops
  const bounds = new google.maps.LatLngBounds();
  orderedStops.forEach(stop => {
    bounds.extend({ lat: stop.lat, lng: stop.lng });
  });
  
  map.fitBounds(bounds, {
    top: 50,    // Padding from the top of the map
    bottom: 50, // Padding from the bottom of the map
    left: 400,  // Padding from the left (to account for the sidebar)
    right: 50   // Padding from the right
  });
}

function showLoading(show) {
  const el = document.getElementById("map-loading");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function showError(show, message) {
  const el = document.getElementById("map-error");
  if (!el) return;
  if (message) {
    el.textContent = message;
  }
  el.classList.toggle("hidden", !show);
}

/**
 * Minimal CSV parser that respects quoted fields.
 */
function parseCSV(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = i + 1 < text.length ? text[i + 1] : null;

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(current);
        current = "";
      } else if (char === "\r") {
        // ignore
      } else if (char === "\n") {
        row.push(current);
        rows.push(row);
        row = [];
        current = "";
      } else {
        current += char;
      }
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function getColumnIndex(headerRow, possibleNames) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedHeader = headerRow.map(h => normalize(h));
  
  for (const pName of possibleNames) {
    const target = normalize(pName);
    const idx = normalizedHeader.indexOf(target);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Resolves locations for murals using the Geocoding API.
 * It uses the street address to pinpoint locations.
 */
async function geocodeMuralsWithAddresses(murals) {
  if (!geocoder) geocoder = new google.maps.Geocoder();
  
  // Load persistent cache from localStorage
  const CACHE_KEY = 'mural_address_to_coords';
  let persistentCache = {};
  try {
    persistentCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch (e) {
    console.warn("Failed to parse geocode cache", e);
  }
  
  // To prevent excessive API usage and slow load times, we primarily geocode 
  // murals based on their street address.
  const toGeocode = murals.filter(m => m.address && (m.lat === null || m.lng === null));
  
  if (toGeocode.length === 0) return;

  // Process geocoding in parallel batches to avoid hanging the UI
  // while respecting Google's rate limits.
  let geocodedCount = 0;
  const geocodePromises = toGeocode.map(async (mural) => {
    const cacheLookupKey = mural.address + GEOCODE_LOCATION_SUFFIX;
    
    // Check persistent cache first
    if (persistentCache[cacheLookupKey]) {
      mural.lat = persistentCache[cacheLookupKey].lat;
      mural.lng = persistentCache[cacheLookupKey].lng;
      geocodedCount++;
      return;
    }

    try {
      const response = await new Promise((resolve, reject) => {
        geocoder.geocode({ 
          address: cacheLookupKey, 
          region: 'us',
          bounds: new google.maps.LatLngBounds(
            { lat: DEFAULT_CENTER.lat - 0.5, lng: DEFAULT_CENTER.lng - 0.5 },
            { lat: DEFAULT_CENTER.lat + 0.5, lng: DEFAULT_CENTER.lng + 0.5 }
          )
        }, (results, status) => {
          if (status === "OK") resolve(results);
          else reject(status);
        });
      });

      if (response && response[0]) {
        mural.lat = response[0].geometry.location.lat();
        mural.lng = response[0].geometry.location.lng();
        persistentCache[cacheLookupKey] = { lat: mural.lat, lng: mural.lng };
        geocodedCount++;
      }
    } catch (error) {
      console.warn(`Geocoding failed for ${mural.name}: ${error}`);
    }
  });

  await Promise.all(geocodePromises);

  if (geocodedCount > 0) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(persistentCache));
    if (typeof applyFilters === 'function') applyFilters();
  }
}

async function loadMuralsFromSheet() {
  if (!CSV_URL) {
    throw new Error("CSV_URL is not configured in config.js");
  }

  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rows = parseCSV(text);

    if (!rows.length) {
      throw new Error("CSV appears to be empty");
    }

    const header = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1);

    const idxName = getColumnIndex(header, ["mural_title", "mural_name", "name", "title"]);
    const idxBorough = getColumnIndex(header, ["borough"]);
    const idxYear = getColumnIndex(header, ["year"]);
    const idxSchool = getColumnIndex(header, ["site_name", "school_name", "school"]);
    const idxDetailUrl = getColumnIndex(header, ["detail_url", "url", "project_url"]);
    const idxImageUrl = getColumnIndex(header, ["image_url", "image_urls", "thumbnail_url"]);
    const idxArtistNames = getColumnIndex(header, ["artist_names", "artists"]);
    const idxTheme = getColumnIndex(header, ["theme", "tags"]);
    const idxTourId = getColumnIndex(header, ["tour_id", "tour"]);
    const idxStudents = getColumnIndex(header, ["students_involved", "students"]);
    const idxAddress = getColumnIndex(header, ["address", "street_address", "location_address"]);
    const idxSetting = getColumnIndex(header, ["location", "setting", "location_type", "interior_exterior", "placement"]);
    const idxNeighborhood = getColumnIndex(header, ["neighborhood", "area", "district"]);
    const idxDescription = getColumnIndex(header, ["tour_description", "historical_info", "mural_description", "description", "about"]);

    if (idxName === -1) {
      throw new Error("Could not find name column. Expected one of: mural_title, mural_name, name, title");
    }

    // Debug: log detected header and indices to help diagnose missing-column issues
    try {
      console.info('CSV header columns detected:', header);
      console.info('Detected column indices', { idxName, idxAddress, idxSetting, idxBorough, idxYear });
    } catch (e) {
      // No-op in case console isn't available in some environments
    }
    return dataRows
      .map((row, rowIndex) => {
        const val = index => (index >= 0 && index < row.length ? row[index].trim() : "");
        const nameValue = val(idxName);
        const uid = `${nameValue}-${val(idxAddress)}-${rowIndex}`;

        return {
          uid,
          name: nameValue,
          lat: null,
          lng: null,
          borough: val(idxBorough),
          year: val(idxYear),
          school: val(idxSchool),
          detail_url: val(idxDetailUrl),
          image_url: val(idxImageUrl),
          artist_names: val(idxArtistNames),
          theme: val(idxTheme),
          tour_id: val(idxTourId),
          students_involved: val(idxStudents),
          setting: val(idxSetting),
          address: val(idxAddress),
          neighborhood: val(idxNeighborhood),
          description: val(idxDescription)
        };
      })
      .filter(m => {
        // Keep mural if it has a name AND an address to geocode
        return m.name && m.address;
      });
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('CORS') || err.name === 'TypeError') {
      throw new Error('CORS error: Please run this app from a local web server, not by opening the HTML file directly. See README.md for instructions.');
    }
    throw err;
  }
}

// Create a numbered marker icon for tour stops
/**
 * Helper to create DOM elements for AdvancedMarkerElement content.
 * Optimized to return a single div node instead of an SVG with multiple children.
 */
function createMarkerElement(type = 'marker-dot', color, label) {
  if (typeof type === 'string' && type.trim().startsWith('<')) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = type.trim();
    return wrapper.firstElementChild || wrapper;
  }

  const el = document.createElement('div');
  el.className = type;
  el.style.touchAction = 'manipulation';
  el.style.pointerEvents = 'auto';
  el.style.webkitTapHighlightColor = 'transparent';
  el.style.cursor = 'pointer';
  el.style.userSelect = 'none';
  el.style.webkitUserSelect = 'none';
  el.style.msUserSelect = 'none';
  if (color) {
    el.style.setProperty('--marker-color', color);
  }

  if (label !== undefined && label !== null) {
    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:100%; text-align:center; font-size:inherit; font-weight:700; line-height:1; pointer-events:none;';
    el.appendChild(labelEl);
  }

  return el;
}

/**
 * Creates a vibrant yellow star marker for highlighted/nearest murals.
 */
function createHighlightedMarkerContent(number, color = "#fbbf24") {
  return createMarkerElement('marker-highlight', color, number);
}

function createNumberedMarkerContent(number, color = "#22c55e") {
  return createMarkerElement('marker-number', color, number);
}

function createMarkers(murals) {
  // Clear existing markers
  markers.forEach(marker => marker.setMap(null));
  markers = [];
  
  // Clear existing tour markers
  tourMarkers.forEach(marker => marker.setMap(null));
  // Note: We re-use tourMarkers array for any non-clustered markers (tours or highlights)
  tourMarkers = [];
  
  if (clusterer) {
    clusterer.clearMarkers();
  }

  // Check if a curated tour is active
  const isTourActive = activeFilters.tour && activeFilters.tour.startsWith(CURATED_TOUR_PREFIX);
  
  // Get tour color if a tour is active
  let tourColor = "#22c55e";
  if (isTourActive) {
    const tourId = activeFilters.tour.replace(CURATED_TOUR_PREFIX, "");
    const entry = curatedTourStops.get(tourId);
    if (entry) {
      tourColor = entry.definition.color || "#3b82f6";
    }
  }

  // If a tour is active, only show tour markers (no regular markers or clusters)
  if (isTourActive) {
    // Create only numbered tour markers
    murals.forEach(mural => {
      const stopNumber = tourStopNumbers.get(mural.uid);
      if (stopNumber !== undefined) {
        const markerContent = createNumberedMarkerContent(stopNumber, tourColor);
        const marker = new google.maps.marker.AdvancedMarkerElement({
          position: { lat: mural.lat, lng: mural.lng },
          map: map,
          title: mural.name,
          content: markerContent,
          zIndex: 1000
        });

        marker.mural = mural;

        marker.addListener("gmp-click", () => {
          showMuralPopup(marker);
        });
        tourMarkers.push(marker);
      }
    });
    // Don't create clusterer when tour is active - only show tour markers
    return;
  }

  // Regular view: separate tour markers from regular markers
  const validMurals = murals.filter(m => Number.isFinite(parseFloat(m.lat)) && Number.isFinite(parseFloat(m.lng)));
  const regularMurals = [];
  const tourMurals = [];

  validMurals.forEach(mural => {
    const stopNumber = tourStopNumbers.get(mural.uid);
    if (stopNumber !== undefined && isTourActive) {
      tourMurals.push({ mural, stopNumber });
    } else {
      regularMurals.push(mural);
    }
  });

  // Pre-count collisions in a single pass for both count and instance tracking
  const collisionMap = new Map();
  regularMurals.forEach(m => {
    const coordKey = `${m.lat.toFixed(6)},${m.lng.toFixed(6)}`;
    if (!collisionMap.has(coordKey)) {
      collisionMap.set(coordKey, { count: 0, instance: 0 });
    }
    collisionMap.get(coordKey).count++;
  });

 // Create regular markers (will be clustered)
 regularMurals.forEach(mural => {
   let lat = parseFloat(mural.lat);
   let lng = parseFloat(mural.lng);
   const coordKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
   const collision = collisionMap.get(coordKey);

   // If multiple murals share these coordinates, nudge them apart so they don't perfectly overlap
   if (collision && collision.count > 1) {
     // Apply a small spiral offset (approx 2-3 meters) so markers are distinct
     const angle = collision.instance * 1.5; 
     const radius = 0.000025; 
     lat += Math.cos(angle) * radius;
     lng += Math.sin(angle) * radius;
     collision.instance++;
   }

   const markerContent = createMarkerElement('marker-dot');
   const marker = new google.maps.marker.AdvancedMarkerElement({
     position: { lat: lat, lng: lng }, // Use the updated lat/lng with jitter
     map: null,
     title: mural.name,
     content: markerContent
   });

   marker.mural = mural;
   marker.addListener("gmp-click", () => {
     showMuralPopup(marker);
   });

   markers.push(marker);
 });

  // Create numbered tour markers (added directly to map, not clustered)
  tourMurals.forEach(({ mural, stopNumber }) => {
    const markerContent = createNumberedMarkerContent(stopNumber, tourColor);
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: mural.lat, lng: mural.lng },
      map: map,
      title: mural.name,
      content: markerContent,
      zIndex: 1000
    });

    marker.mural = mural;

    marker.addListener("gmp-click", () => {
      showMuralPopup(marker);
    });

    tourMarkers.push(marker);
  });

  // Update clusterer with only regular markers
  updateClusterer();
}

// Create custom renderer for blue clusters
function createClusterRenderer() {
  // Use bright blue for clusters
  const clusterColor = "#3b82f6";

  return {
    render: ({ count, position }) => {
      return new google.maps.marker.AdvancedMarkerElement({
        position,
        content: createMarkerElement('marker-cluster', clusterColor, count),
        zIndex: 2000 + count
      });
    }
  };
}

// Update marker clusterer with current markers
function updateClusterer() {
  // Create or update marker clusterer with very aggressive clustering
  // At low zoom levels, create 1 cluster per borough (or ~5 clusters total)
  // At higher zoom levels, use more granular clustering
  
  const renderer = createClusterRenderer();
  
  // Helper function to create algorithm with zoom-based radius
  function createAlgorithm() {
    try {
      // Get current zoom level, default to 11 if map not ready
      const currentZoom = map ? map.getZoom() : 11;
      
      // If 25% view is active, force exactly 5 clusters
      if (activeFilters.muralView === 25) {
        // Use a very large radius to create exactly 5 clusters
        if (typeof markerClusterer !== 'undefined' && markerClusterer.gridAlgorithm && markerClusterer.gridAlgorithm.GridAlgorithm) {
          return new markerClusterer.gridAlgorithm.GridAlgorithm({
            radius: 800, // Very large radius to force ~5 clusters
            maxZoom: 20 // Never stop clustering at 25% view
          });
        } else if (window.markerClusterer && window.markerClusterer.gridAlgorithm && window.markerClusterer.gridAlgorithm.GridAlgorithm) {
          return new window.markerClusterer.gridAlgorithm.GridAlgorithm({
            radius: 800,
            maxZoom: 20
          });
        }
      }
      
      // Calculate radius based on zoom level
      // At zoom 11 (city view): very large radius (400px) = ~1 cluster per borough
      // At zoom 13-14: medium radius (150px) = more clusters
      // At zoom 15+: smaller radius (60px) = many clusters
      let radius;
      if (currentZoom <= 11) {
        radius = 400; // Very aggressive - ~1 cluster per borough
      } else if (currentZoom <= 13) {
        radius = 200; // Aggressive clustering
      } else if (currentZoom <= 14) {
        radius = 100; // Moderate clustering
      } else {
        radius = 60; // Fine-grained clustering
      }
      
      if (typeof markerClusterer !== 'undefined' && markerClusterer.gridAlgorithm && markerClusterer.gridAlgorithm.GridAlgorithm) {
        return new markerClusterer.gridAlgorithm.GridAlgorithm({
          radius: radius,
          maxZoom: 15 // Stop clustering at zoom 15
        });
      } else if (window.markerClusterer && window.markerClusterer.gridAlgorithm && window.markerClusterer.gridAlgorithm.GridAlgorithm) {
        return new window.markerClusterer.gridAlgorithm.GridAlgorithm({
          radius: radius,
          maxZoom: 15
        });
      }
    } catch (e) {
      console.log('Using default clustering algorithm');
    }
    return undefined;
  }
  
  // Recreate clusterer when zoom changes to update clustering radius
  // Initial clusterer creation
  if (typeof markerClusterer !== 'undefined' && markerClusterer.MarkerClusterer) {
    const algorithm = createAlgorithm();
    if (clusterer) clusterer.clearMarkers();
    
    clusterer = new markerClusterer.MarkerClusterer({ map, markers, algorithm, renderer });
  } else if (window.markerClusterer && window.markerClusterer.MarkerClusterer) {
    const algorithm = createAlgorithm();
    if (clusterer) clusterer.clearMarkers();

    clusterer = new window.markerClusterer.MarkerClusterer({ map, markers, algorithm, renderer });
  } else {
    // Fallback if clusterer library not loaded - add markers directly to map
    markers.forEach(m => m.setMap(map));
  }
}

/** Tracks recently viewed murals in the sidebar */
function addToRecents(mural) {
  if (!mural || !mural.uid) return;
  muralHistory = muralHistory.filter(m => m.uid !== mural.uid);
  muralHistory.unshift({
    uid: mural.uid,
    name: mural.name,
    school: mural.school,
    borough: mural.borough
  });
  if (muralHistory.length > 5) muralHistory.pop();
  localStorage.setItem('mural_history', JSON.stringify(muralHistory));
  renderRecents();
}

function renderRecents() {
  const container = document.getElementById('recentMuralsList');
  if (!container) return;
  container.innerHTML = '';

  if (muralHistory.length === 0) {
    container.innerHTML = '<p class="tours-panel-subtitle">No murals viewed yet.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  muralHistory.forEach(m => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `<h4>${m.name}</h4><p>${m.school || m.borough || ''}</p>`;
    card.onclick = () => focusOnMuralByUid(m.uid);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

/** Showcases a few random murals for discovery and provides a 'Surprise Me' option */
function renderFeaturedMurals() {
  const container = document.getElementById('featuredMuralsList');
  if (!container || allMurals.length === 0) return;
  const refreshBtn = document.getElementById('refreshFeaturedMuralsBtn');

  // Clear previous content in the dynamic list
  container.innerHTML = '';

  // Get 3 random murals from the full list without sorting all murals
  const featured = [];
  const samplePool = [...allMurals];
  const targetCount = Math.min(3, samplePool.length);
  for (let i = 0; i < targetCount; i++) {
    const randomIndex = Math.floor(Math.random() * samplePool.length);
    featured.push(samplePool.splice(randomIndex, 1)[0]);
  }

  container.innerHTML = `
    <button id="surpriseMeBtn" class="primary-btn" style="margin-bottom: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
      <span>🎲</span> Surprise Me!
    </button>
  `;

  // Wire up the Surprise Me button to pick a random mural from the entire collection
  const surpriseBtn = container.querySelector('#surpriseMeBtn');
  if (surpriseBtn) {
    surpriseBtn.onclick = () => {
    // 1. Identify murals not in the recently viewed history
    const viewedUids = new Set(muralHistory.map(m => m.uid));
    // Ensure we are filtering from the full list of murals
    const unviewedMurals = allMurals.filter(m => m.uid && !viewedUids.has(m.uid));
    
    // 2. Select from unviewed pool, or fallback to all murals if everything has been viewed
    const pool = unviewedMurals.length > 0 ? unviewedMurals : allMurals;
    const randomMural = pool[Math.floor(Math.random() * pool.length)];

    // 3. Clear all filters to ensure the mural is visible and its marker is rendered
    clearAllFilters();
    
    // 4. Focus on it (increased delay to ensure markers are re-rendered in the DOM)
    setTimeout(() => focusOnMuralByUid(randomMural.uid), 350);
    };
  }

  // Wire up the Refresh button to re-render the featured murals
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      renderFeaturedMurals();
    };
  }

  featured.forEach(m => {
    const card = document.createElement('div');
    card.className = 'recent-card featured-card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div style="min-width:0; flex:1;">
          <h4 style="margin:0; line-height:1.4; overflow-wrap:break-word; word-break:break-word;">${m.name}</h4>
          <p style="margin:4px 0 0; font-size:12px; color:var(--text-muted); line-height:1.4; overflow-wrap:break-word;">${m.school || m.borough || ''}</p>
        </div>
        <span style="color:var(--brand-pink); flex-shrink:0; font-size:14px; margin-top:2px;">✨</span>
      </div>
    `;
    card.onclick = () => focusOnMuralByUid(m.uid);
    container.appendChild(card);
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function toggleSaveMural(mural) {
  const index = savedMurals.findIndex(m => m.uid === mural.uid);
  if (index === -1) {
    savedMurals.push({
      uid: mural.uid,
      name: mural.name,
      school: mural.school,
      borough: mural.borough
    });
    showToast(`Saved ${mural.name}`);
  } else {
    savedMurals.splice(index, 1);
    showToast(`Removed ${mural.name}`);
  }
  localStorage.setItem('saved_murals', JSON.stringify(savedMurals));
  renderSavedMurals();
}

function renderSavedMurals() {
  const container = document.getElementById('savedMuralsList');
  if (!container) return;
  container.innerHTML = '';

  if (savedMurals.length === 0) {
    container.innerHTML = '<p class="tours-panel-subtitle">No saved murals yet.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  savedMurals.forEach(m => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div style="min-width:0; flex:1;">
          <h4 style="margin:0; line-height:1.4; overflow-wrap:break-word;">${m.name}</h4>
          <p style="margin:4px 0 0; font-size:12px; color:var(--text-muted); line-height:1.4; overflow-wrap:break-word;">${m.school || m.borough || ''}</p>
        </div>
        <span style="color:#ef4444; flex-shrink:0; font-size:14px; margin-top:2px;">❤️</span>
      </div>
    `;
    card.onclick = () => focusOnMuralByUid(m.uid);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function showMuralPopup(markerOrMural) {
  const m = markerOrMural.mural || markerOrMural;
  const anchor = markerOrMural.mural ? markerOrMural : null;
  
  addToRecents(m);
  
  // Create unique ID for this popup's carousel
  const popupId = 'popup-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  
  // Handle multiple images (comma or newline separated) and filter invalid values
  const IMAGE_URL_REGEX = /[\n,]+/;
  const images = m.image_url 
    ? m.image_url.split(IMAGE_URL_REGEX)
        .map(url => url.trim())
        .filter(url => url && url.toLowerCase().startsWith('http'))
    : [];

  let currentImageIndex = 0;
  const isSavedInitial = savedMurals.some(sm => sm.uid === m.uid);
  
  const distanceAway =
    userLocation && m.lat && m.lng
      ? formatDistance(calculateDistanceMeters(userLocation, { lat: m.lat, lng: m.lng }))
      : null;

  // Check if there is a tour-specific narrative for this mural
  let tourNarrative = null;
  if (activeTourDefinition) {
    // 1. Check for hardcoded narrative in config.js (highest priority)
    if (activeTourDefinition.detailedStops) {
      const detailedStop = activeTourDefinition.detailedStops.find(ds => ds.uid === m.uid);
      if (detailedStop) tourNarrative = detailedStop.narrative;
    }
    
    // 2. Fallback to the CSV's tour_description if no hardcoded narrative exists
    if (!tourNarrative) tourNarrative = m.description;
  }

  const html = `
    <div id="${popupId}" style="width:min(500px, calc(100vw - 32px)); min-width:0; max-width:calc(100vw - 32px); font-family: system-ui, sans-serif; color: var(--text-main); background: var(--panel-bg); padding: 16px; box-sizing: border-box; max-height: 80vh; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; border-radius: 8px; flex-shrink: 0;">
      <!-- Header with Title and Close Button -->
      <div style="position: relative; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--heading-color); text-align: center; padding-right: 30px;">
          ${m.name}${m.year ? ` (${m.year})` : ''}
        </h2>
        <button id="${popupId}-close" 
                style="position: absolute; top: 0; right: 0; background: rgba(255,255,255,0.1); border: none; font-size: 26px; cursor: pointer; color: #9ca3af; padding: 0; width: 36px; height: 36px; min-width: 36px; min-height: 36px; display: flex; align-items: center; justify-content: center; line-height: 1; border-radius: 6px; transition: all 0.2s; touch-action: manipulation;"
                onmouseover="this.style.background='rgba(255,255,255,0.2)'; this.style.color='#ffffff';"
                onmouseout="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#9ca3af';"
                title="Close">
          &times;
        </button>
      </div>
      ${
        distanceAway
          ? `<div style="display:flex; justify-content:center; margin-bottom:12px;">
              <span class="distance-pill" style="background:rgba(59,130,246,0.18); border:1px solid rgba(59,130,246,0.35); color:var(--text-main);">
                ${distanceAway} away
              </span>
            </div>`
          : ""
      }
      
      <!-- Tour Specific Narrative (Google My Maps Style) -->
      ${tourNarrative ? `
        <div class="tour-insight-box">
          <div style="color: var(--brand-pink); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
            Tour Insight
          </div>
          <div style="font-size: 14px; line-height: 1.5; color: var(--text-main); font-style: italic;">"${tourNarrative}"</div>
        </div>
      ` : ''}

      <!-- Image Carousel -->
      ${images.length > 0 ? `
        <div class="popup-image-card" style="position: relative; margin-bottom: 16px; border-radius: 8px; overflow: hidden; background: #f3f4f6;">
          <div style="position: relative; width: 100%; padding-top: 56.25%; background: #e5e7eb;">
            <img id="${popupId}-img" src="${images[0]}" alt="${m.name}" 
                 style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" loading="lazy">
            ${images.length > 1 ? `
              <button id="${popupId}-prev" onclick="
                const popup = document.getElementById('${popupId}');
                const img = popup.querySelector('#${popupId}-img');
                const images = ${JSON.stringify(images)};
                let idx = parseInt(img.dataset.index || 0);
                idx = (idx - 1 + images.length) % images.length;
                img.src = images[idx];
                img.dataset.index = idx;
              " style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.9); border: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 18px; color: #1f2937; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: all 0.2s;"
                 onmouseover="this.style.background='#ffffff'; this.style.transform='translateY(-50%) scale(1.1)';"
                 onmouseout="this.style.background='rgba(255,255,255,0.9)'; this.style.transform='translateY(-50%) scale(1)';">
              &lt;
            </button>
            <button id="${popupId}-next" onclick="
              const popup = document.getElementById('${popupId}');
              const img = popup.querySelector('#${popupId}-img');
              const images = ${JSON.stringify(images)};
              let idx = parseInt(img.dataset.index || 0);
              idx = (idx + 1) % images.length;
              img.src = images[idx];
              img.dataset.index = idx;
            " style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.9); border: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 18px; color: #1f2937; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: all 0.2s;"
                 onmouseover="this.style.background='#ffffff'; this.style.transform='translateY(-50%) scale(1.1)';"
                 onmouseout="this.style.background='rgba(255,255,255,0.9)'; this.style.transform='translateY(-50%) scale(1)';">
              &gt;
            </button>
            ` : ''}
          </div>
        </div>
      ` : ''}
      
      <!-- Metadata Fields in 2 Columns -->
      <div class="popup-meta-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <!-- Left Column -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Students:</div>
            <div style="color: var(--text-main); font-size: 14px; font-weight: 500;">${m.students_involved || '—'}</div>
          </div>
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Teaching Artist:</div>
            <div style="color: var(--text-main); font-size: 14px; font-weight: 500;">${m.artist_names || '—'}</div>
          </div>
        </div>
        
        <!-- Right Column -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">School:</div>
            <div style="color: var(--text-main); font-size: 14px; font-weight: 500;">${m.school || '—'}</div>
          </div>
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Borough:</div>
            <div style="color: var(--text-main); font-size: 14px; font-weight: 500;">${m.borough || '—'}</div>
          </div>
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Location:</div>
            <div style="color: var(--text-main); font-size: 14px; font-weight: 500;">${m.setting || '—'}</div>
          </div>
        </div>
      </div>
      
      <!-- Address — plain text, reverse-geocoded from lat/lng -->
      <div style="margin-bottom: 16px;">
        <div
           style="display:flex; align-items:flex-start; gap:10px; padding:11px 14px; background:rgba(59,130,246,0.08); border-radius:10px; border:1px solid rgba(59,130,246,0.25);">
             <div style="min-width:0;">
            <div style="color:var(--brand-blue); font-size:11px; text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:3px;">
              Address
            </div>
            <div id="${popupId}-address-text" style="color:var(--text-main); font-size:13.5px; line-height:1.4; font-weight:500;">
              Looking up address…
            </div>
          </div>
        </div>
      </div>

      <!-- Mural Description -->
      ${(m.description || m.theme) && m.description !== tourNarrative ? `
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: var(--heading-color); text-align: center; text-transform: uppercase; letter-spacing: 0.5px;">Mural Description</h3>
        <div style="color: var(--text-main); font-size: 14px; line-height: 1.6;">
          ${m.description || m.theme}
        </div>
      </div>` : (!tourNarrative && !m.theme ? '<div style="margin-bottom:16px; font-size:14px; color:var(--text-muted); text-align:center;">No description available for this mural.</div>' : '')}

      <!-- Street View Panel Container -->
      <div id="${popupId}-streetview-panel" style="display:none; width:100%; height:250px; border-radius:8px; margin-bottom:16px; overflow:hidden; background:#000;"></div>

      <div class="popup-action-row" style="display:flex; gap:12px; flex-wrap:wrap; margin-top: 12px;">
        <button id="${popupId}-save"
          style="flex:1; border:1px solid ${isSavedInitial ? '#ef4444' : 'var(--panel-border)'}; border-radius:999px; background:${isSavedInitial ? 'rgba(239, 68, 68, 0.1)' : 'transparent'}; color:${isSavedInitial ? '#ef4444' : 'var(--text-main)'}; font-weight:600; padding:10px 18px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-family:system-ui,sans-serif;">
          <span style="font-size: 16px;">${isSavedInitial ? '❤️' : '🤍'}</span>
          <span>${isSavedInitial ? 'Saved' : 'Save'}</span>
        </button>
        <button id="${popupId}-directions"
          style="flex:1; border:none; border-radius:999px; background:#3b82f6; color:#0f172a; font-weight:600; padding:10px 18px; cursor:pointer; font-size:14px; font-family:system-ui,sans-serif;">
          Directions
        </button>
        <button id="${popupId}-streetview"
          style="flex:1; border:1px solid var(--panel-border); border-radius:999px; background:rgba(59,130,246,0.1); color:var(--text-main); font-weight:600; padding:10px 18px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
          <span style="font-size: 16px;">🏙️</span>
          <span id="${popupId}-streetview-text">Street View</span>
        </button>
        <button id="${popupId}-focus"
          style="flex:1; border:1px solid var(--panel-border); border-radius:999px; background:transparent; color:var(--text-main); font-weight:600; padding:10px 18px; cursor:pointer;">
          Center Map
        </button>
        ${m.detail_url ? `
        <a href="${m.detail_url}" target="_blank" rel="noopener"
          style="flex:1; text-align:center; text-decoration:none; border:none; border-radius:999px; background: linear-gradient(90deg, #34d399, #3b82f6); color:#0f172a; font-weight:600; padding:10px 18px; cursor:pointer; font-size: 14px; font-family: system-ui, sans-serif; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 120px;">
          Portfolio ↗
        </a>` : ''}
      </div>
      <button id="${popupId}-close-bottom" style="width:100%; border:none; border-radius:999px; background: rgba(255,255,255,0.08); color: var(--text-main); font-weight:700; padding:14px 18px; cursor:pointer; font-size:14px; margin-top: 12px; text-transform:uppercase; letter-spacing:0.8px; touch-action: manipulation;">
        Back to Map
      </button>
    </div>
  `;

  infoWindow.setContent(html);
  
  if (anchor && anchor.map) {
    infoWindow.open({ anchor: anchor, map: map });
  } else if (m.lat && m.lng) {
    infoWindow.setPosition({ lat: parseFloat(m.lat), lng: parseFloat(m.lng) });
    infoWindow.open(map);
  }

  if (narratorEnabled && window.speechSynthesis) {
    const speechDescription = tourNarrative && tourNarrative !== m.description ? tourNarrative : m.description;
    const narrationText = [m.name, speechDescription].filter(Boolean).join('. ');
    speakNarration(narrationText);
  }
  
  // Style the info window and set up close button functionality
  setTimeout(() => {
    const iwOuter = document.querySelector('.gm-style-iw-d');
    const iwContainer = document.querySelector('.gm-style-iw-c');
    const isMobilePopup = window.matchMedia('(max-width: 900px)').matches;
    const isNarrowPhone = window.matchMedia('(max-width: 420px)').matches;
    const widthStr = isNarrowPhone ? 'calc(100vw - 20px)' : (isMobilePopup ? 'calc(100vw - 32px)' : 'var(--iw-width, 500px)');
    
    if (iwOuter) {
      iwOuter.style.background = 'var(--panel-bg)';
      iwOuter.style.color = 'var(--text-main)';
      iwOuter.style.width = widthStr;
      iwOuter.style.maxWidth = widthStr === 'var(--iw-width, 500px)' ? '500px' : widthStr;
      iwOuter.style.left = isMobilePopup ? '50%' : '';
      iwOuter.style.transform = isMobilePopup ? 'translateX(-50%)' : '';
      iwOuter.style.display = 'block';
      iwOuter.style.touchAction = 'pan-y';
      // Lock height context
      iwOuter.style.overflowY = 'auto';
      iwOuter.style.maxHeight = 'none';
    }
    
    if (iwContainer) {
      iwContainer.style.background = 'var(--panel-bg)';
      iwContainer.style.width = widthStr;
      iwContainer.style.maxWidth = widthStr === 'var(--iw-width, 500px)' ? '500px' : widthStr;
      iwContainer.style.overflow = 'hidden';
      iwContainer.style.maxHeight = 'none';
      iwContainer.style.touchAction = 'pan-y';
    }
    
    // Hide Google Maps' default close button since we have our own
    const iwCloseBtn = document.querySelector('.gm-ui-hover-effect');
    if (iwCloseBtn) {
      iwCloseBtn.style.display = 'none';
    }
    
    // Allow the inner popup div to scroll; keep outer wrappers transparent to overflow
    const scrollElements = document.querySelectorAll('.gm-style-iw-d, .gm-style-iw-c');
    scrollElements.forEach(el => {
      el.style.overflow = 'visible';
      el.style.maxHeight = 'none';
    });

    if (isNarrowPhone) {
      const popup = document.getElementById(popupId);
      if (popup) {
        popup.style.padding = '12px 10px';
        popup.style.width = 'calc(100vw - 20px)';
        popup.style.maxWidth = 'calc(100vw - 20px)';
      }

      const title = popup?.querySelector('h2');
      if (title) title.style.fontSize = '16px';

      const imgCard = popup?.querySelector('.popup-image-card');
      if (imgCard) {
        imgCard.style.marginBottom = '12px';
        const imgWrapper = imgCard.querySelector('div');
        if (imgWrapper) imgWrapper.style.paddingTop = '50%';
      }

      const metaGrid = popup?.querySelector('.popup-meta-grid');
      if (metaGrid) {
        metaGrid.style.gridTemplateColumns = '1fr';
        metaGrid.style.gap = '8px';
        metaGrid.style.marginBottom = '12px';
      }
      const actionRow = popup?.querySelector('.popup-action-row');
      if (actionRow) {
        actionRow.style.flexDirection = 'column';
        actionRow.style.gap = '8px';
      }
      const buttons = popup?.querySelectorAll('button, a');
      buttons?.forEach(el => {
        el.style.minHeight = '40px';
        el.style.fontSize = '12px';
      });
      });
    }
    
    // Set up our custom close button
    const customCloseBtn = document.getElementById(`${popupId}-close`);
    if (customCloseBtn) {
      customCloseBtn.addEventListener('click', () => {
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        infoWindow.close();
      });
    }

    const customCloseBottomBtn = document.getElementById(`${popupId}-close-bottom`);
    if (customCloseBottomBtn) {
      customCloseBottomBtn.addEventListener('click', () => {
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        infoWindow.close();
      });
    }

    // ── Carousel Controls ─────────────────────────────────────────────────────
    if (images.length > 1) {
      const nextBtn = document.getElementById(`${popupId}-next`);
      const prevBtn = document.getElementById(`${popupId}-prev`);
      const imgEl = document.getElementById(`${popupId}-img`);

      if (nextBtn && prevBtn && imgEl) {
        let currentIndex = 0;
        
        nextBtn.addEventListener('click', () => {
          currentIndex = (currentIndex + 1) % images.length;
          imgEl.src = images[currentIndex];
          imgEl.dataset.index = currentIndex;
        });

        prevBtn.addEventListener('click', () => {
          currentIndex = (currentIndex - 1 + images.length) % images.length;
          imgEl.src = images[currentIndex];
          imgEl.dataset.index = currentIndex;
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const focusBtn = document.getElementById(`${popupId}-focus`);
    focusBtn?.addEventListener("click", () => {
      map.panTo({ lat: m.lat, lng: m.lng });
      if (map.getZoom() < 15) {
        map.setZoom(15);
      }
    });

    const streetViewBtn = document.getElementById(`${popupId}-streetview`);
    const streetViewPanel = document.getElementById(`${popupId}-streetview-panel`);
    const streetViewText = document.getElementById(`${popupId}-streetview-text`);
    let streetViewInitialized = false;

    streetViewBtn?.addEventListener("click", () => {
      if (!streetViewPanel) return;
      const showStreetView = streetViewPanel.style.display !== "block";
      streetViewPanel.style.display = showStreetView ? "block" : "none";
      if (streetViewText) {
        streetViewText.textContent = showStreetView ? "Hide Street View" : "Street View";
      }

      if (showStreetView && !streetViewInitialized) {
        streetViewInitialized = true;
        const panorama = new google.maps.StreetViewPanorama(streetViewPanel, {
          position: { lat: m.lat, lng: m.lng },
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          motionTracking: false,
          addressControl: false,
          fullscreenControl: false,
          linksControl: false,
          showRoadLabels: true,
          visible: true
        });
        panorama.addListener('status_changed', () => {
          if (panorama.getStatus && panorama.getStatus() !== 'OK') {
            streetViewPanel.innerHTML = '<div style="padding: 16px; color: #fff; text-align: center;">Street View is not available at this location.</div>';
          }
        });
      }
    });

    const saveBtn = document.getElementById(`${popupId}-save`);
    saveBtn?.addEventListener("click", () => {
      toggleSaveMural(m);
      const currentlySaved = savedMurals.some(sm => sm.uid === m.uid);
      saveBtn.innerHTML = `
        <span style="font-size: 16px;">${currentlySaved ? '❤️' : '🤍'}</span>
        <span>${currentlySaved ? 'Saved' : 'Save'}</span>
      `;
      saveBtn.style.borderColor = currentlySaved ? '#ef4444' : 'var(--panel-border)';
      saveBtn.style.background = currentlySaved ? 'rgba(239, 68, 68, 0.1)' : 'transparent';
      saveBtn.style.color = currentlySaved ? '#ef4444' : 'var(--text-main)';
    });

    // ── Directions button ─────────────────────────────────────────────────────
    const directionsBtn = document.getElementById(`${popupId}-directions`);
    directionsBtn?.addEventListener("click", () => {
      if (!userLocation) {
        alert("Please set your starting location first using the address bar or GPS button in the sidebar.");
        return;
      }
      window.calculateTransitDirections(m.lat, m.lng, m.name);
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── Reverse-geocode the mural's lat/lng to get a real street address ──
    // Normalize coordinates for consistent cache keys
    const cacheKey = `${parseFloat(m.lat).toFixed(6)},${parseFloat(m.lng).toFixed(6)}`;
    const addressTextEl = document.getElementById(`${popupId}-address-text`);

    if (addressTextEl) {
      if (m.address) {
        addressTextEl.textContent = m.address;
      } else if (geocodeCache.has(cacheKey)) {
        const cached = geocodeCache.get(cacheKey);
        addressTextEl.textContent = cached.formatted;
      } else if (geocoder) {
        geocoder.geocode({ location: { lat: m.lat, lng: m.lng } }, (results, status) => {
          let formatted;
          if (status === "OK" && results && results[0]) {
            formatted = results[0].formatted_address;
          } else {
            formatted = m.neighborhood
              ? `${m.neighborhood}, ${m.borough || 'New York'}, NY`
              : `${m.borough || 'New York'}, NY`;
          }
          geocodeCache.set(cacheKey, { formatted });
          const el = document.getElementById(`${popupId}-address-text`);
          if (el) el.textContent = formatted;
        });
      } else {
        addressTextEl.textContent = m.neighborhood
          ? `${m.neighborhood}, ${m.borough || 'New York'}, NY`
          : `${m.borough || 'New York'}, NY`;
      }
    }
    // ─────────────────────────────────────────────────────────────────────
  }, 100);
}

/**
 * Renders a 'My Maps' style itinerary in the sidebar when a tour is active.
 */
function renderTourItinerary() {
  const container = document.getElementById("tourCards");
  const subtitle = document.querySelector(".tours-panel-subtitle");
  if (!container || !activeTourDefinition) return;

  const tourColor = activeTourDefinition.color || "#3b82f6";
  if (subtitle) subtitle.style.display = 'none';

  if (!activeTourOrderedStops || activeTourOrderedStops.length === 0) {
    const tourEntryForOrdering = curatedTourStops.get(activeTourDefinition.id);
    if (tourEntryForOrdering) {
      activeTourOrderedStops = orderStopsForTour(tourEntryForOrdering.stops);
    }
    activeTourCursor = Math.max(0, Math.min(activeTourCursor, activeTourOrderedStops.length - 1));
  }

  const currentStop = activeTourOrderedStops[activeTourCursor] || { name: '' };
  const nextStop = activeTourOrderedStops[activeTourCursor + 1];

  let html = `
    <div class="tour-itinerary-wrapper">
      <div class="tour-itinerary-header" style="border-left: 4px solid ${tourColor};">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px;">
          <h3 style="margin:0; flex:1;">${activeTourDefinition.name}</h3>
          <button id="backToTours" style="background:#ef4444; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:600; cursor:pointer; font-size:12px; white-space:nowrap; transition:background 0.2s;" onmouseover="this.style.background='#dc2626';" onmouseout="this.style.background='#ef4444';">✕ End Tour</button>
        </div>
        <p style="font-size:12px; color: var(--text-muted); margin:0 0 8px 0;">${activeTourDefinition.description}</p>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px;">
          <span id="tourStopStatus" style="font-size:12px; color:var(--text-muted);">
            Stop ${activeTourCursor + 1} of ${activeTourOrderedStops.length}
          </span>
          <div style="display:flex; gap:6px; flex-wrap: wrap;">
            <button id="tourPrevStop" class="ghost-btn" style="padding:8px 12px;">Previous</button>
            <button id="tourNextStop" class="ghost-btn" style="padding:8px 12px;">Next</button>
            <button id="tourGoNext" class="ghost-btn" style="padding:8px 12px;">Navigate</button>
          </div>
        </div>
        <div id="tourNextHint" style="font-size:12px; color:var(--text-muted); margin-top:8px;">
          ${nextStop ? `Next: ${nextStop.name}` : 'This is the final stop.'}
        </div>
      </div>
      <div class="tour-itinerary-list">
  `;

  const tourEntry = curatedTourStops.get(activeTourDefinition.id);
  if (!tourEntry) return;
  const stops = orderStopsForTour(tourEntry.stops);
  const escapeAttr = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  
  stops.forEach((stop, idx) => {
    const isActiveStop = idx === activeTourCursor;
    html += `
      <div class="tour-itinerary-card${isActiveStop ? ' active-stop' : ''}" data-stop-uid="${escapeAttr(stop.uid)}">
        <div class="stop-badge" style="background: ${tourColor}">${idx + 1}</div>
        <div class="stop-content">
          <h4>${stop.name}</h4>
          <p>${stop.school || stop.borough}</p>
          ${stop.description ? `<p style="font-size:11px; opacity:0.7; font-style:italic; margin-top:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4;">${stop.description}</p>` : ''}
        </div>
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;
  container.querySelectorAll('.tour-itinerary-card').forEach(card => {
    const uid = card.dataset.stopUid;
    if (!uid) return;
    card.addEventListener('click', () => focusOnMuralByUid(uid));
  });

  container.querySelector('#backToTours').onclick = () => {
    activeFilters.tour = null;
    activeTourDefinition = null;
    activeTourCursor = 0;
    activeTourOrderedStops = [];
    if (subtitle) subtitle.style.display = 'block';
    applyFilters();
    renderTourCards();
  };

  container.querySelector('#tourPrevStop')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (activeTourCursor > 0) {
      setActiveTourStop(activeTourCursor - 1);
    }
  });
  container.querySelector('#tourNextStop')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (activeTourCursor < activeTourOrderedStops.length - 1) {
      setActiveTourStop(activeTourCursor + 1);
    }
  });
  container.querySelector('#tourGoNext')?.addEventListener('click', (e) => {
    e.preventDefault();
    const nextStop = activeTourOrderedStops[activeTourCursor + 1];
    if (!nextStop) return;
    const origin = userLocation || activeTourOrderedStops[activeTourCursor] || null;
    if (!origin) return;
    if (!userLocation) {
      window.userLocation = { lat: origin.lat, lng: origin.lng };
    }
    window.calculateTransitDirections(nextStop.lat, nextStop.lng, nextStop.name);
  });

  updateTourNextHintAddress(nextStop);
}


function setActiveTourStop(index) {
  if (!activeTourOrderedStops || !activeTourOrderedStops.length) return;
  activeTourCursor = Math.max(0, Math.min(index, activeTourOrderedStops.length - 1));
  const stop = activeTourOrderedStops[activeTourCursor];
  if (!stop) return;

  const statusEl = document.getElementById('tourStopStatus');
  if (statusEl) {
    statusEl.textContent = `Stop ${activeTourCursor + 1} of ${activeTourOrderedStops.length}`;
  }

  const hintEl = document.getElementById('tourNextHint');
  if (hintEl) {
    const nextStop = activeTourOrderedStops[activeTourCursor + 1];
    hintEl.textContent = nextStop ? `Next: ${nextStop.name}` : 'This is the final stop.';
  }

  focusOnMuralByUid(stop.uid);
}

function refreshCustomTourIfActive() {
  if (!userLocation || activeFilters.tour !== `${CURATED_TOUR_PREFIX}custom-near-me`) return;

  const settingEl = document.getElementById('customTourSetting');
  const radiusEl = document.getElementById('customTourRadius');
  const limitEl = document.getElementById('customTourLimit');
  if (!settingEl || !radiusEl || !limitEl) return;

  const selectedSetting = settingEl.value || 'exterior';
  const radiusMiles = Number(radiusEl.value) || 1;
  const limitStops = Number(limitEl.value) || 6;
  const radiusMeters = Math.max(0.5, radiusMiles) * 1609.344;
  const nearby = getNearbyTourStops(userLocation, radiusMeters, limitStops, selectedSetting);

  if (nearby.stops.length < 2) {
    const summary = document.getElementById('customTourSummary');
    if (summary) {
      summary.textContent = `Not enough stops to create a tour with current settings. Increase radius or mural count.`;
    }
    return;
  }

  const customTour = {
    id: "custom-near-me",
    name: "My Local Mural Tour",
    description: `Local mural tour: ${nearby.uniqueStopCount} stops within ${radiusMiles} mile${radiusMiles === 1 ? '' : 's'}${selectedSetting !== 'any' ? ` (${selectedSetting})` : ''}.`,
    color: "#fbbf24",
    stops: nearby.stops,
    allMurals: nearby.stops,
    uidSet: new Set(nearby.stops.map(m => m.uid))
  };

  curatedTourStops.set(customTour.id, { definition: customTour, stops: customTour.stops, allMurals: customTour.allMurals, uidSet: customTour.uidSet });
  activeTourDefinition = customTour;
  activeTourOrderedStops = orderStopsForTour(customTour.stops);
  activeTourCursor = Math.min(activeTourCursor, activeTourOrderedStops.length - 1);

  applyFilters();
  renderTourItinerary();
  if (directionsPanel) {
    window.calculateTourDirections(activeTourOrderedStops, activeTourDefinition.name);
  }
}

function getNearbyTourStops(origin, radiusMeters, limit = 6, selectedSetting = 'exterior') {
  const normalizedSetting = (selectedSetting || 'exterior').toLowerCase();

  const nearby = allMurals
    .filter(m => m.lat !== null && m.lng !== null)
    .filter(m => {
      if (normalizedSetting === 'any') return true;
      const muralSetting = (m.setting || '').toLowerCase();
      if (normalizedSetting === 'interior') {
        return muralSetting.includes('interior') || muralSetting.includes('indoor');
      }
      if (normalizedSetting === 'exterior') {
        return muralSetting.includes('exterior') || muralSetting.includes('outdoor') || muralSetting === '';
      }
      return true;
    })
    .map(m => ({
      ...m,
      distance: calculateDistanceMeters(origin, { lat: m.lat, lng: m.lng })
    }))
    .filter(m => m.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance);

  const uniqueStops = [];
  const seenLocations = new Set();
  for (const mural of nearby) {
    const locationKey = getLocationKey(mural.lat, mural.lng);
    if (!seenLocations.has(locationKey)) {
      uniqueStops.push(mural);
      seenLocations.add(locationKey);
      if (uniqueStops.length >= limit) break;
    }
  }

  return {
    stops: uniqueStops,
    muralCount: nearby.length,
    uniqueStopCount: uniqueStops.length
  };
}

/** Helper: Finds and sorts murals within a specific radius (default 1 mile) */
function getNearbyTourMurals(origin, radiusMeters, limit = 6, selectedSetting = 'any') {
  return getNearbyTourStops(origin, radiusMeters, limit, selectedSetting).stops;
}

/** Generates the dynamic guided tour */
function createCustomTourNearMe() {
  if (!userLocation) {
    alert("Please set your location first using the search bar or GPS button.");
    return;
  }

  // Reset filter state so tour murals aren't hidden by active filters
  activeFilters.search = "";
  activeFilters.year = null;
  activeFilters.school = null;
  activeFilters.borough = null;
  activeFilters.setting = null;

  const settingEl = document.getElementById('customTourSetting');
  const radiusEl = document.getElementById('customTourRadius');
  const limitEl = document.getElementById('customTourLimit');
  const selectedSetting = settingEl ? settingEl.value : 'exterior';
  const radiusMiles = radiusEl ? Number(radiusEl.value) : 1;
  const limitStops = limitEl ? Number(limitEl.value) : 6;
  const radiusMeters = Math.max(0.5, radiusMiles) * 1609.344;

  const nearby = getNearbyTourStops(userLocation, radiusMeters, limitStops, selectedSetting);

  if (nearby.stops.length < 2) {
    const settingLabel = selectedSetting === 'any' ? '' : ` (${selectedSetting})`;
    alert(`Only ${nearby.uniqueStopCount} stop${nearby.uniqueStopCount === 1 ? '' : 's'} found${settingLabel} within ${radiusMiles} mile${radiusMiles === 1 ? '' : 's'}. Try a larger radius, more stops, or another setting!`);
    return;
  }

  const customTour = {
    id: "custom-near-me",
    name: "My Local Mural Tour",
    description: `Local mural tour: ${nearby.uniqueStopCount} stops within ${radiusMiles} mile${radiusMiles === 1 ? '' : 's'}${selectedSetting !== 'any' ? ` (${selectedSetting})` : ''}.`,
    color: "#fbbf24",
    stops: nearby.stops,
    allMurals: nearby.stops,
    uidSet: new Set(nearby.stops.map(m => m.uid))
  };

  curatedTourStops.set(customTour.id, { definition: customTour, stops: customTour.stops, allMurals: customTour.allMurals, uidSet: customTour.uidSet });
  activeFilters.tour = `${CURATED_TOUR_PREFIX}${customTour.id}`;
  activeTourDefinition = customTour;
  activeTourCursor = 0;
  activeTourOrderedStops = orderStopsForTour(customTour.stops);
  
  applyFilters();
  showToast(`Custom tour created within ${radiusMiles} mile${radiusMiles === 1 ? '' : 's'}!`);

  // NEW: Ensure the Curated Tours section is expanded
  const toursContainer = document.getElementById("curatedToursContainer");
  const toggleIcon = document.getElementById("toggleCuratedToursIcon");
  if (toursContainer && toursContainer.style.display === "none") {
    toursContainer.style.display = "flex";
    if (toggleIcon) toggleIcon.textContent = "−";
  }
  renderTourItinerary();
  updateTourPolyline();

  // Automatically trigger directions for the new custom tour
  if (activeTourOrderedStops && activeTourOrderedStops.length > 1) {
    window.calculateTourDirections(activeTourOrderedStops, activeTourDefinition.name);
  }

  const container = document.getElementById("tourCards");
  if (container) container.scrollIntoView({ behavior: 'smooth' });
}

function applyFilters() {
  let filtered = allMurals.filter(m => {
    // Search filter
    if (activeFilters.search) {
      const searchLower = activeFilters.search.toLowerCase();
      const searchableText = `${m.name} ${m.school || ""} ${m.artist_names || ""} ${m.description || ""} ${m.theme || ""}`.toLowerCase();
      if (!searchableText.includes(searchLower)) {
        return false;
      }
    }

    // Year filter
    if (activeFilters.year !== null) {
      if (String(m.year) !== String(activeFilters.year)) {
        return false;
      }
    }

    // School filter
    if (activeFilters.school !== null) {
      if (m.school !== activeFilters.school) {
        return false;
      }
    }

    // Borough filter
    if (activeFilters.borough !== null) {
      if (m.borough !== activeFilters.borough) {
        return false;
      }
    }

    // Setting filter
    if (activeFilters.setting !== null) {
      const mSetting = (m.setting || "").toLowerCase();
      if (!mSetting.includes(activeFilters.setting.toLowerCase())) {
        return false;
      }
    }

    // Tour filter
    if (activeFilters.tour !== null) {
      if (activeFilters.tour.startsWith(CURATED_TOUR_PREFIX)) {
        const tourId = activeFilters.tour.replace(CURATED_TOUR_PREFIX, "");
        const entry = curatedTourStops.get(tourId);
        if (!entry || !entry.uidSet.has(m.uid)) {
          return false;
        }
      } else {
        const dataTourId = activeFilters.tour.replace(DATA_TOUR_PREFIX, "");
        if (m.tour_id !== dataTourId) {
          return false;
        }
      }
    }

    return true;
  });

  // Apply mural view percentage filter
  if (activeFilters.muralView < 100 && filtered.length > 0) {
    const targetCount = Math.ceil((filtered.length * activeFilters.muralView) / 100);
    // Randomly sample the filtered murals to show the percentage
    // Shuffle and take the first N
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    filtered = shuffled.slice(0, targetCount);
  }

  currentVisibleMurals = filtered;
  updateTourPolyline();  // must run first — rebuilds tourStopNumbers from filtered stops
  createMarkers(filtered); // then markers are drawn using the updated tourStopNumbers

  // If a curated tour is active, render the itinerary instead of cards
  if (activeTourDefinition) {
    renderTourItinerary();
  }

  if (userLocation) {
    const nearest = findNearestMurals(5);
    if (!activeFilters.tour || !activeFilters.tour.startsWith(CURATED_TOUR_PREFIX)) {
      drawSearchConnections(userLocation, nearest);
    } else {
      clearSearchConnections();
    }
    renderNearestList(nearest); 
  }
}

function populateFilters() {
  const years = new Set();
  const schools = new Set();
  const boroughs = new Set();
  const dataTours = new Set();
  const settings = new Set(); // NEW

  allMurals.forEach(m => {
    if (m.year) years.add(m.year);
    if (m.school) schools.add(m.school);
    if (m.borough) boroughs.add(m.borough);
    if (m.setting) settings.add(m.setting);
    if (m.tour_id) dataTours.add(m.tour_id);
  });

  const sortedYears    = Array.from(years).sort((a, b) => Number(b) - Number(a));
  const sortedSchools  = Array.from(schools).sort();
  const sortedBoroughs = Array.from(boroughs).sort();
  const sortedSettings = Array.from(settings).sort(); // NEW

  // ── helper: rebuild a <select> without losing the listener ────────────────
  function buildSelect(id, options, activeValue, onChangeFn) {
    const sel = document.getElementById(id);
    if (!sel) return;
    // Preserve only the first "All …" option then re-add the rest
    const placeholder = sel.options[0]?.text || "All";
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    options.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === activeValue) opt.selected = true;
      sel.appendChild(opt);
    });
    // Remove old listeners and attach new one efficiently
    sel.onchange = (e) => onChangeFn(e.target.value || null);
  }

  // Year
  buildSelect(
    "yearFilter",
    sortedYears.map(y => ({ value: y, label: y })),
    activeFilters.year,
    (val) => { activeFilters.year = val; applyFilters(); }
  );

  // Schools
  buildSelect(
    "schoolsFilter",
    sortedSchools.map(s => ({ value: s, label: s })),
    activeFilters.school,
    (val) => { activeFilters.school = val; applyFilters(); }
  );

  // Borough
  buildSelect(
    "boroughFilter",
    sortedBoroughs.map(b => ({ value: b, label: b })),
    activeFilters.borough,
    (val) => { activeFilters.borough = val; applyFilters(); }
  );

  // Setting
  buildSelect(
    "settingFilter",
    sortedSettings.map(s => ({ value: s, label: s })),
    activeFilters.setting,
    (val) => { activeFilters.setting = val; applyFilters(); }
  );

  // Tours
  const curatedOpts = curatedTours
    .map(t => ({ value: `${CURATED_TOUR_PREFIX}${t.id}`, label: t.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const dataOpts = Array.from(dataTours)
    .filter(Boolean).sort()
    .map(id => ({ value: `${DATA_TOUR_PREFIX}${id}`, label: `Tour ${id}` }));

  buildSelect(
    "toursFilter",
    [...curatedOpts, ...dataOpts],
    activeFilters.tour,
    (val) => { activeFilters.tour = val; applyFilters(); }
  );
}

/** NEW: Resets all filters to their default state. */
function clearAllFilters() {
  activeFilters = {
    search: "", year: null, school: null, borough: null,
    setting: null, tour: null, muralView: 100
  };

  // Helper to safely clear values only if the element exists in the HTML
  const safeClearValue = (id, val = "") => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  safeClearValue("searchInput");
  safeClearValue("yearFilter");
  safeClearValue("schoolsFilter");
  safeClearValue("boroughFilter");
  safeClearValue("settingFilter");
  safeClearValue("toursFilter");

  const slider = document.getElementById("muralViewSlider");
  if (slider) {
    slider.value = 100;
    slider.style.setProperty('--val', 100);
    const label = document.getElementById("muralViewLabel");
    if (label) label.textContent = "100%";
  }

  clearUserLocation(); // Also clear user location and its marker
  applyFilters();
  populateFilters(); // Re-populate to ensure dropdowns reflect reset state
  renderTourCards(); // Re-render tour cards to reflect active tour state
}

function setupViewAllModals({ schools = [], boroughs = [], tours = [] } = {}) {
  modalData = { schools, boroughs, tours };
  const modal = document.getElementById("viewAllModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");

  function openModal(filterType) {
    modalBody.innerHTML = "";
    let title = "";
    let items = [];

    if (filterType === "school") {
      title = "All Schools / Sites";
      items = modalData.schools;
    } else if (filterType === "borough") {
      title = "All Boroughs";
      items = modalData.boroughs;
    } else {
      title = "All Tours";
      items = modalData.tours;
    }

    modalTitle.textContent = title;

    items.forEach(item => {
      const value = filterType === "tour" ? item.id : item;
      const label = filterType === "tour" ? item.label : item;

      const div = document.createElement("div");
      div.className = "modal-item";
      if (filterType === "school" && activeFilters.school === value) div.classList.add("active");
      if (filterType === "borough" && activeFilters.borough === value) div.classList.add("active");
      if (filterType === "tour" && activeFilters.tour === value) div.classList.add("active");

      div.textContent = label;
      div.addEventListener("click", () => {
        if (filterType === "school") {
          activeFilters.school = activeFilters.school === value ? null : value;
        } else if (filterType === "borough") {
          activeFilters.borough = activeFilters.borough === value ? null : value;
        } else if (filterType === "tour") {
          activeFilters.tour = activeFilters.tour === value ? null : value;
        }
        applyFilters();
        populateFilters();
        modal.classList.add("hidden");
      });
      modalBody.appendChild(div);
    });

    modal.classList.remove("hidden");
  }

  if (!modalListenersBound) {
    document.getElementById("schoolsViewAll")?.addEventListener("click", () => openModal("school"));
    document.getElementById("boroughViewAll")?.addEventListener("click", () => openModal("borough"));
    document.getElementById("toursViewAll")?.addEventListener("click", () => openModal("tour"));

    modalClose?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    modal?.addEventListener("click", e => {
      if (e.target === modal) {
        modal.classList.add("hidden");
      }
    });

    modalListenersBound = true;
  }
}

function setupSearch() {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return;

  let searchTimeout;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      activeFilters.search = e.target.value;
      applyFilters();
    }, 300); // Debounce search
  });
}

function setupMuralView() {
  const slider = document.getElementById("muralViewSlider");
  const label  = document.getElementById("muralViewLabel");

  function syncTrack(val) {
    if (slider) slider.style.setProperty('--val', val);
  }

  if (slider) {
    syncTrack(slider.value); // initialise fill on load
    slider.addEventListener("input", () => {
      const val = parseInt(slider.value);
      if (label) label.textContent = `${val}%`;
      syncTrack(val);
      activeFilters.muralView = val;
      applyFilters();
    });
  }
}

/** NEW: Sets up event listeners for filter controls like "Clear All Filters". */
function setupFilterControls() {
  const clearAllFiltersBtn = document.getElementById("clearAllFiltersBtn");
  if (clearAllFiltersBtn) {
    clearAllFiltersBtn.addEventListener("click", clearAllFilters);
  }
}

/** Efficient zoom handler for clustering */
function onZoomChanged() {
  if (!map || !clusterer) return;

  const currentZoom = map.getZoom();
  if (currentZoom === lastZoomLevel) return;
  lastZoomLevel = currentZoom;
  if (activeFilters.muralView === 25) return;

  clearTimeout(zoomTimeout);
  zoomTimeout = setTimeout(() => {
    if (!map || map.getZoom() !== currentZoom) return;
    updateClusterer();
  }, 500);
}

function initLayoutControls() {
  const hideBtn = document.getElementById("sidebarHideBtn") || document.querySelector(".sidebar-hide-btn");
  const showTab = document.getElementById("sidebarShowTab") || document.querySelector(".sidebar-show-tab");
  const sidebar = document.getElementById("sidebar");
  const body = document.body; // Reference to the body element
  const mq = window.matchMedia("(max-width: 768px)"); // Use phone breakpoint for auto-hide on mobile devices

  function updateSidebarVisibility(isVisible) {
    if (isVisible) {
      sidebar?.classList.remove("hidden");
      showTab?.classList.add("hidden");
      showTab?.setAttribute("aria-expanded", "true");
      body.classList.add("sidebar-open");
    } else {
      sidebar?.classList.add("hidden");
      showTab?.classList.remove("hidden");
      showTab?.setAttribute("aria-expanded", "false");
      body.classList.remove("sidebar-open");
    }
  }

  // Export to global scope so focusOnMuralByUid can minimize the sidebar
  window.setSidebarVisibility = updateSidebarVisibility;

  function syncSidebarState() {
    if (!mq.matches) {
      body.classList.add("sidebar-open");
      updateSidebarVisibility(true);
    } else {
      body.classList.remove("sidebar-open");
      updateSidebarVisibility(false);
    }
  }

  syncSidebarState();
  mq.addEventListener("change", syncSidebarState);

  // Hide sidebar button
  hideBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    updateSidebarVisibility(false);
  });

  // Show sidebar tab (left edge)
  showTab?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    updateSidebarVisibility(true);
  });
}

function setupNearestControls() {
  // The Clear button and GPS button are now wired inside setupManualLocationSearch().
  // This function is kept as a no-op so existing initMap call doesn't break.
}

function updateCustomTourSummary() {
  const summary = document.getElementById('customTourSummary');
  if (!summary) return;

  const radiusEl = document.getElementById('customTourRadius');
  const limitEl = document.getElementById('customTourLimit');
  const settingEl = document.getElementById('customTourSetting');
  if (!radiusEl || !limitEl || !settingEl) return;

  const radiusMiles = Number(radiusEl.value) || 1;
  const limitStops = Number(limitEl.value) || 6;
  const selectedSetting = settingEl.value || 'exterior';

  if (!userLocation) {
    summary.textContent = 'Set your location first to preview local tour stops.';
    return;
  }

  const radiusMeters = Math.max(0.5, radiusMiles) * 1609.344;
  const nearby = getNearbyTourStops(userLocation, radiusMeters, limitStops, selectedSetting);
  const stopsText = `${nearby.uniqueStopCount} stop${nearby.uniqueStopCount === 1 ? '' : 's'}`;
  const muralsText = `${nearby.muralCount} mural${nearby.muralCount === 1 ? '' : 's'}`;
  summary.textContent = `${stopsText} available within ${radiusMiles} mile${radiusMiles === 1 ? '' : 's'} (${muralsText} total).`;
}

function setupCustomTourRadiusControl() {
  const configs = [
    { id: 'customTourRadius', labelId: 'customTourRadiusLabel', unit: 'mile', suffix: 's' },
    { id: 'customTourLimit', labelId: 'customTourLimitLabel', unit: 'stop', suffix: 's' }
  ];

  configs.forEach(config => {
    const slider = document.getElementById(config.id);
    const label = document.getElementById(config.labelId);
    if (!slider || !label) return;

    const update = () => {
      const val = Number(slider.value);
      label.textContent = `${val} ${config.unit}${val === 1 ? '' : config.suffix}`;

      // Update the slider track fill gradient
      const min = parseFloat(slider.min) || 0;
      const max = parseFloat(slider.max) || (config.id === 'customTourRadius' ? 5 : 20);
      const percent = ((val - min) / (max - min)) * 100;
      slider.style.setProperty('--val', percent);
      updateCustomTourSummary();
      refreshCustomTourIfActive();
    };

    update();
    slider.addEventListener('input', update);
  });

  const settingEl = document.getElementById('customTourSetting');
  if (settingEl) {
    settingEl.addEventListener('change', () => {
      updateCustomTourSummary();
      refreshCustomTourIfActive();
    });
  }
}

function setLocateButtonState(isLoading) {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.disabled = isLoading;
  locateBtn.textContent = isLoading ? "Locating…" : "Find Murals Near Me";
}

function requestUserLocation() {
  if (!navigator.geolocation) {
    renderNearestList([], "Geolocation is not supported in this browser.");
    return;
  }
  setLocateButtonState(true);
  navigator.geolocation.getCurrentPosition(handleLocationSuccess, handleLocationError, LOCATION_OPTIONS);
}

function handleLocationSuccess(position) {
  setLocateButtonState(false);
  const coords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };
  userLocation = coords;
  setUserLocationMarker(coords, position.coords.accuracy);
  applyFilters(); // Ensure nearest murals and route connections are rendered immediately
  updateCustomTourSummary();

  const clearBtn = document.getElementById("clearLocationBtn");
  if (clearBtn) {
    clearBtn.disabled = false;
  }
}

function handleLocationError(error) {
  setLocateButtonState(false);
  console.error("Geolocation error", error);
  const message =
    error.code === error.PERMISSION_DENIED
      ? "Location permission denied. Enable it in your browser and try again."
      : "Unable to fetch your location. Please try again.";
  renderNearestList([], message);
}

function setUserLocationMarker(position, accuracyMeters = 50) {
  if (!map) return;

  // Hardcoded label as requested
  const labelHtml = `<div style="background: #3b82f6; color: white; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 900; text-transform: uppercase; margin-bottom: 6px; white-space: nowrap; border: 2.5px solid white; line-height: 1;">You are here</div>`;

  // Anchor logic: AdvancedMarkerElement anchors the center of the content to the position.
  // We use translateY(-50%) to shift the marker assembly so the bottom (the red dot) 
  // rests exactly on the user's coordinate on the map.
  // Added mural-marker-vnode class to ensure it's not inverted in dark mode
  const markerContent = createMarkerElement(`
    <div class="mural-marker-vnode" style="display: flex; flex-direction: column; align-items: center; transform: translateY(-50%); pointer-events: none; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));">
      ${labelHtml}
      <div style="width:26px; height:26px; background:#ef4444; border:4px solid white; border-radius:50%; box-shadow: 0 0 25px rgba(239, 68, 68, 0.7); flex-shrink: 0; position:relative;">
        <div class="user-location-pulse"></div>
      </div>
    </div>
  `);

  if (!userLocationMarker) {
    userLocationMarker = new google.maps.marker.AdvancedMarkerElement({
      map: map,
      zIndex: 9999,
      content: markerContent
    });
  } else {
    userLocationMarker.content = markerContent;
  }

  if (userAccuracyCircle) {
    userAccuracyCircle.setMap(null);
  }

  userAccuracyCircle = new google.maps.Circle({
    map,
    center: position,
    radius: Math.max(accuracyMeters, 30),
    fillColor: "#ef4444",
    fillOpacity: 0.1,
    strokeColor: "#ef4444",
    strokeOpacity: 0.4,
    strokeWeight: 1
  });

  userLocationMarker.position = position;
  userLocationMarker.map = map;

  map.panTo(position);
}

function clearUserLocation() {
  userLocation = null;
  applyFilters();
  
  if (userLocationMarker) {
    userLocationMarker.setMap(null);
    userLocationMarker = null;
  }
  if (userAccuracyCircle) {
    userAccuracyCircle.setMap(null);
    userAccuracyCircle = null;
  }

  // Close and remove the directions panel (route finder) if it's currently open
  if (directionsPanel) {
    directionsPanel.remove();
    directionsPanel = null;
  }

  // ==========================================
  // NEW CODE: Clear the transit routes!
  // ==========================================
  if (typeof routeRenderers !== 'undefined' && routeRenderers.length > 0) {
    routeRenderers.forEach(renderer => renderer.setMap(null));
    routeRenderers = []; // Empty the array
  }
  
  if (typeof directionsRenderer !== 'undefined' && directionsRenderer) {
    directionsRenderer.setMap(null); 
    directionsRenderer = new google.maps.DirectionsRenderer({ map: map }); 
  }
  // ==========================================

  const clearBtn = document.getElementById("clearLocationBtn");
  if (clearBtn) {
    clearBtn.disabled = true;
  }
  
  renderNearestList();
  updateCustomTourSummary();
}

function findNearestMurals(limit = 4) {
  if (!userLocation) return [];
  const source = currentVisibleMurals.length ? currentVisibleMurals : allMurals;
  return source
    .map(mural => {
      const distance = calculateDistanceMeters(userLocation, { lat: mural.lat, lng: mural.lng });
      return { ...mural, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function focusOnMuralByUid(uid) {
  // 1. Close the search results summary popup
  if (searchInfoWindow) searchInfoWindow.close();

  const marker = markers.find(m => m.mural.uid === uid) || tourMarkers.find(m => m.mural.uid === uid);
  const mural = marker ? marker.mural : allMurals.find(m => m.uid === uid);

  if (!mural) return;

  // NEW: Hide sidebar on mobile so the user can see the map result
  if (window.setSidebarVisibility && window.matchMedia("(max-width: 768px)").matches) {
    window.setSidebarVisibility(false);
  }

  if (activeTourDefinition && activeTourOrderedStops && activeTourOrderedStops.length) {
    const tourIndex = activeTourOrderedStops.findIndex(stop => stop.uid === uid);
    if (tourIndex !== -1) {
      activeTourCursor = tourIndex;
      renderTourItinerary();
      const nextStop = activeTourOrderedStops[activeTourCursor + 1];
      updateTourNextHintAddress(nextStop);
      const currentStop = activeTourOrderedStops[activeTourCursor];
      if (currentStop && userLocation) {
        window.calculateTransitDirections(currentStop.lat, currentStop.lng, currentStop.name);
      }
    }
  }

  const pos = { lat: parseFloat(mural.lat), lng: parseFloat(mural.lng) };
  map.panTo(pos);
  if (map.getZoom() < 15) {
    map.setZoom(15);
  }

  // Use a small delay to allow map to settle and markers to uncluster
  setTimeout(() => {
    if (marker && marker.map) {
      google.maps.event.trigger(marker, "gmp-click");
    } else {
      // Fallback: If marker is missing or clustered, open popup at position
      showMuralPopup(marker || mural);
    }
  }, 300);
}
window.focusOnMuralByUid = focusOnMuralByUid;

function renderNearestList(results = null, customMessage = "") {
  const container = document.getElementById("nearestResults");
  if (!container) return;

  container.innerHTML = "";

  if (customMessage) {
    container.classList.remove("empty");
    container.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center;">${customMessage}</p>`;
    return;
  }

  if (results && results.length) {
    container.classList.remove("empty");
    results.slice(0, 5).forEach((m, idx) => {
      const card = document.createElement("div");
      card.className = "nearest-card";
      card.innerHTML = `
        <header style="align-items:flex-start;">
          <div style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1;">
            <span style="font-size:10px; font-weight:800; color:#ffffff; background:var(--brand-blue); width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:2px;">${idx + 1}</span>
            <h3 style="margin:0; font-size:15px; line-height:1.4; overflow-wrap:break-word;">${m.name}</h3>
          </div>
          <span class="distance-pill" style="margin-top:2px;">${formatDistance(m.distance)}</span>
        </header>
        <p style="margin:0; line-height:1.4; overflow-wrap:break-word;">${m.school || m.borough || "Mural Location"}</p>
      `;
      card.addEventListener("click", () => {
        focusOnMuralByUid(m.uid);
        if (userLocation) {
          window.calculateTransitDirections(m.lat, m.lng, m.name);
        }
      });
      container.appendChild(card);
    });
    return;
  }

  container.classList.add("empty");
}

function clearMapRoutes() {
  // Clear transit route lines
  if (routeRenderers && routeRenderers.length > 0) {
    routeRenderers.forEach(r => r.setMap(null));
    routeRenderers = [];
  }
  if (directionsRenderer) directionsRenderer.setMap(null);
  
  // Clear search connection lines
  clearSearchConnections();
}

function clearSearchConnections() {
  searchConnectionLines.forEach(line => line.setMap(null));
  searchConnectionLines = [];
}

/** Draws lines connecting the search location to the nearest murals */
function drawSearchConnections(origin, nearestMurals) {
  clearSearchConnections();
  if (!map || !origin) return;

  nearestMurals.forEach((m, idx) => {
    const line = new google.maps.Polyline({
      path: [origin, { lat: m.lat, lng: m.lng }],
      geodesic: true,
      strokeColor: "#fbbf24",
      strokeOpacity: idx === 0 ? 0.8 : 0.3,
      strokeWeight: idx === 0 ? 3 : 1.5,
      map: map
    });
    searchConnectionLines.push(line);
  });

  // Automatically calculate proper transit route for the #1 closest mural
  if (nearestMurals.length > 0) {
    const closest = nearestMurals[0];
    window.calculateTransitDirections(closest.lat, closest.lng, closest.name);
  }
}

// Called by Google Maps JS API via callback parameter in index.html
async function initMap() {
  try {
    setupNearestControls();
    showError(false);
    showLoading(true);

    // Load mural data before rendering the map and UI panels.
    const murals = await loadMuralsFromSheet();
    allMurals = murals;

    // Handle the 'Clear Location' button in the sidebar
    const clearBtn = document.getElementById('clearLocationBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        // End active tour when location is cleared
        if (activeTourDefinition) {
          activeFilters.tour = null;
          activeTourDefinition = null;
          activeTourCursor = 0;
          activeTourOrderedStops = [];
          if (activeTourPolyline) {
            activeTourPolyline.setMap(null);
            activeTourPolyline = null;
          }
          tourMarkers.forEach(m => m.setMap(null));
          tourMarkers = [];
          if (directionsPanel) {
            directionsPanel.remove();
            directionsPanel = null;
          }
          routeRenderers.forEach(r => r.setMap(null));
          routeRenderers = [];
        }
        
        clearMapRoutes();
        const addressInput = document.getElementById('manual-address-input');
        if (addressInput) addressInput.value = "";
        userLocation = null;
        clearUserLocation();
      });
    }

    const isLight = getInitialThemeIsLight();
    const isPhoneViewport = window.matchMedia("(max-width: 768px)").matches;
    map = new google.maps.Map(document.getElementById("map"), {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      mapId: MAP_ID,
      mapTypeControl: false,
      zoomControl: true,
      zoomControlOptions: { position: isPhoneViewport ? google.maps.ControlPosition.RIGHT_BOTTOM : google.maps.ControlPosition.LEFT_BOTTOM },
      scaleControl: true,
      fullscreenControl: true,
      streetViewControl: true,
      controlSize: isPhoneViewport ? 28 : 22,
      gestureHandling: isPhoneViewport ? 'greedy' : 'auto',
      disableDoubleClickZoom: isPhoneViewport,
      backgroundColor: isLight ? '#f8fafc' : '#030712'
    });
    
    if (isPhoneViewport) {
      map.addListener('idle', onZoomChanged);
    } else {
      map.addListener('zoom_changed', onZoomChanged);
    }

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
      map: map,
      suppressMarkers: false, 
      polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 5, strokeOpacity: 0.8 }
    });

    const transitLayer = new google.maps.TransitLayer();
    transitLayer.setMap(map);
    
    const infoWindowMaxWidth = isPhoneViewport ? Math.max(280, window.innerWidth - 32) : 500;
    infoWindow = new google.maps.InfoWindow({ maxWidth: infoWindowMaxWidth });
    geocoder = new google.maps.Geocoder();
    renderSavedMurals();
    renderFeaturedMurals();

    // Render what we have first, then geocode in the background
    currentVisibleMurals = allMurals;
    createMarkers(allMurals);
    populateFilters();
    setupManualLocationSearch();
    setupSearch();
    setupFilterControls(); 

    // HIDE LOADING SCREEN NOW - geocoding will happen in background
    showLoading(false);

    // background geocoding (non-blocking)
    geocodeMuralsWithAddresses(allMurals);

    // Setup Districts Layer
    districtLabels = [];
    map.data.loadGeoJson('City_Council_Districts.geojson');
    map.data.setStyle({ fillColor: 'transparent', strokeColor: '#60a5fa', strokeWeight: 1.5, clickable: true });

    map.data.addListener('addfeature', function(e) {
      const distNum = e.feature.getProperty('coundist'); 
      if (!distNum) return;
      const bounds = new google.maps.LatLngBounds();
      e.feature.getGeometry().forEachLatLng(ll => bounds.extend(ll));
      const labelMarker = new google.maps.marker.AdvancedMarkerElement({
        position: bounds.getCenter(),
        map: map,
        content: createMarkerElement(`<div class="mural-marker-vnode" style="color: #FFF; font-size: 11px; font-weight: bold; text-shadow: 0 0 5px #000;">District ${distNum}</div>`)
      });
      districtLabels.push(labelMarker);
    });

    const districtToggle = document.getElementById('toggleDistricts');
    if (districtToggle) {
      districtToggle.addEventListener('change', (e) => {
        const isVisible = e.target.checked;
        map.data.setStyle({ 
          visible: isVisible,
          fillColor: 'transparent',
          strokeColor: '#60a5fa',
          strokeWeight: 1.5,
          clickable: isVisible
        });
        districtLabels.forEach(m => m.setMap(isVisible ? map : null));
      });
    }

    // ── Handle Fullscreen State ──────────────────────────────────────────────
    // Listen for fullscreen changes and toggle UI visibility
    const mapElement = document.getElementById('map');
    const mapContainerElement = document.getElementById('map-container');
    const htmlElement = document.documentElement;
    
    function updateFullscreenState() {
      const fullscreenEl = document.fullscreenElement;
      const isFullscreen = fullscreenEl === mapElement || fullscreenEl === mapContainerElement;
      if (isFullscreen) {
        htmlElement.classList.add('fullscreen-active');
      } else {
        htmlElement.classList.remove('fullscreen-active');
      }
    }
    
    // Listen for fullscreen changes (multiple event names for cross-browser support)
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    document.addEventListener('mozfullscreenchange', updateFullscreenState);
    document.addEventListener('MSFullscreenChange', updateFullscreenState);

  } catch (err) {
    console.error(err);
    showError(true, err.message || "Failed to load mural data.");
    showLoading(false);
  }
}

/**
 * Fires four parallel direction requests — walking, bicycling, bus, and train —
 * and draws each as a distinct coloured polyline on the map simultaneously.
 * Clears any previously drawn routes first. Closes the popup so routes are visible.
 *
 * Colours:
 *   🟢 Green  — walking
 *   🟡 Yellow — bicycling
 *   🔵 Blue   — bus (TRANSIT, BUS mode)
 *   🟠 Orange — train / subway (TRANSIT, SUBWAY + RAIL mode)
 */
// ─── DIRECTIONS PANEL ────────────────────────────────────────────────────────
// Injects a full-featured directions panel into the map (below the popup).
// Shows travel time per mode, multiple route alternatives, step-by-step
// instructions, and a departure-time selector — mirroring Google Maps.

let directionsPanel = null; // The injected panel DOM element
let activeModeTab   = 'TRANSIT'; // Currently selected travel mode

/**
 * Master entry point called by the Directions button in the popup.
 * Builds or re-uses the panel, then fetches all travel modes in parallel.
 */
window.calculateTransitDirections = function(destLat, destLng, destName) {
  if (!userLocation) {
    alert("Please set your starting location first using the address bar or GPS button in the sidebar.");
    return;
  }

  // Close the mural popup so the panel has room
  if (infoWindow) infoWindow.close();

  // Clear previously drawn route lines
  routeRenderers.forEach(r => r.setMap(null));
  routeRenderers = [];
  if (directionsRenderer) directionsRenderer.setMap(null);

  const origin      = new google.maps.LatLng(userLocation.lat, userLocation.lng);
  const destination = new google.maps.LatLng(parseFloat(destLat), parseFloat(destLng));
  const label       = destName || 'Mural';

  // Build or reset the panel
  _buildDirectionsPanel(label, destLat, destLng);
  updateDirectionsPanelAddress(destLat, destLng);

  // Travel modes to query in parallel
  const modes = [
    { key: 'TRANSIT',   label: 'Transit',  color: '#4ade80', travelMode: google.maps.TravelMode.TRANSIT   },
    { key: 'WALKING',   label: 'Walk',      color: '#60a5fa', travelMode: google.maps.TravelMode.WALKING   },
    { key: 'DRIVING',   label: 'Drive',     color: '#f472b6', travelMode: google.maps.TravelMode.DRIVING   },
    { key: 'BICYCLING', label: 'Bike',      color: '#fbbf24', travelMode: google.maps.TravelMode.BICYCLING },
  ];

  // Fetch all modes and populate panel tabs + route list
  const results = {};
  let completed = 0;

  modes.forEach(mode => {
    const req = {
      origin,
      destination,
      travelMode: mode.travelMode,
      provideRouteAlternatives: true,
      ...(mode.key === 'TRANSIT' ? {
        transitOptions: { departureTime: new Date() }
      } : {})
    };

    directionsService.route(req, (response, status) => {
      completed++;
      if (status === 'OK') {
        results[mode.key] = { response, mode };
        _updateModeTab(mode.key, response, mode);
      } else {
        _updateModeTab(mode.key, null, mode);
      }
      // Once all requests are in, draw the active mode
      if (completed === modes.length) {
        _drawMode(results, activeModeTab, origin, destination);
        _showRouteList(results, activeModeTab, origin, destination);
      }
    });
  });

  // Tab click handler — redraw route and update list when user switches modes
  window._directionsSelectMode = function(modeKey) {
    activeModeTab = modeKey;

    // Scope to the panel so the query always resolves regardless of DOM position
    const tabContainer = directionsPanel || document;
    tabContainer.querySelectorAll('.dir-tab').forEach(t => {
      const isActive = t.dataset.mode === modeKey;
      t.classList.toggle('dir-tab--active', isActive);
    });
    
    // Blur the element to ensure the Mouse-Out transparency can trigger
    if (document.activeElement) document.activeElement.blur();

    _drawMode(results, modeKey, origin, destination);
    _showRouteList(results, modeKey, origin, destination);
  };
};

window.calculateTourDirections = function(stops, tourName) {
  if (!userLocation || !stops || stops.length === 0) return;
  if (infoWindow) infoWindow.close();
  
  routeRenderers.forEach(r => r.setMap(null));
  routeRenderers = [];
  if (directionsRenderer) directionsRenderer.setMap(null);

  const origin = new google.maps.LatLng(userLocation.lat, userLocation.lng);
  const lastStop = stops[stops.length - 1];
  const destination = new google.maps.LatLng(lastStop.lat, lastStop.lng);
  
  const waypoints = stops.slice(0, -1).map(s => ({
    location: new google.maps.LatLng(s.lat, s.lng),
    stopover: true
  }));

  _buildDirectionsPanel(tourName, lastStop.lat, lastStop.lng, true);
  updateDirectionsPanelAddress(lastStop.lat, lastStop.lng, lastStop.address || '');

  const modes = [
    { key: 'TRANSIT',   label: 'Transit',  color: '#4ade80', travelMode: google.maps.TravelMode.TRANSIT },
    { key: 'WALKING',   label: 'Walk',     color: '#60a5fa', travelMode: google.maps.TravelMode.WALKING },
    { key: 'DRIVING',   label: 'Drive',    color: '#f472b6', travelMode: google.maps.TravelMode.DRIVING },
    { key: 'BICYCLING', label: 'Bike',     color: '#fbbf24', travelMode: google.maps.TravelMode.BICYCLING }
  ];

  const results = {};
  let completed = 0;
  let anyRouteOk = false;

  updateTourPolyline();

  modes.forEach(mode => {
    const req = {
      origin,
      destination,
      waypoints,
      travelMode: mode.travelMode,
      provideRouteAlternatives: true
    };
    if (mode.key === 'DRIVING' || mode.key === 'BICYCLING') {
      req.optimizeWaypoints = true;
    }
    if (mode.key === 'TRANSIT') {
      req.transitOptions = { departureTime: new Date() };
    }

    directionsService.route(req, (response, status) => {
      completed++;
      if (status === 'OK') {
        anyRouteOk = true;
        results[mode.key] = { response, mode };
        _updateModeTab(mode.key, response, mode);
      } else {
        _updateModeTab(mode.key, null, mode);
      }
      if (completed === modes.length) {
        if (!anyRouteOk) {
          // If no route results were returned, keep the tour polyline visible as a fallback.
          showToast('No multi-stop route available; showing direct tour path instead.');
        }
        activeModeTab = 'TRANSIT';
        _drawMode(results, activeModeTab, origin, destination);
        _showRouteList(results, activeModeTab, origin, destination);
        window._directionsSelectMode(activeModeTab);
      }
    });
  });
};

/** Makes an element draggable via a handle */
function _makeElementDraggable(el, handle) {
  let offsetX = 0, offsetY = 0, initialX = 0, initialY = 0;

  handle.addEventListener('mousedown', dragMouseDown);

  function dragMouseDown(e) {
    // Don't drag if clicking buttons in the header
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

    e.preventDefault();
    initialX = e.clientX;
    initialY = e.clientY;
    
    const rect = el.getBoundingClientRect();
    offsetX = initialX - rect.left;
    offsetY = initialY - rect.top;

    document.addEventListener('mousemove', elementDrag);
    document.addEventListener('mouseup', closeDragElement);
    
    el.style.transition = 'none';
  }

  function elementDrag(e) {
    e.preventDefault();
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;

    // Boundary constraints: Keep the panel within the visible viewport
    const maxX = window.innerWidth - el.offsetWidth;
    const maxY = window.innerHeight - el.offsetHeight;

    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function closeDragElement() {
    document.removeEventListener('mousemove', elementDrag);
    document.removeEventListener('mouseup', closeDragElement);
    // Remove inline transition to let CSS handle the Mouse-Out fade
    el.style.removeProperty('transition');
  }
}

/** Inject / reset the directions panel below the map controls */
function _buildDirectionsPanel(label, destLat, destLng, isTour = false) {
  // Remove old panel if present
  if (directionsPanel) {
    directionsPanel.remove();
    directionsPanel = null;
  }

  // Calculate position flush against the right edge of the sidebar
  const sidebar   = document.getElementById('sidebar');
  const sidebarLeft  = sidebar ? sidebar.offsetLeft  : 72;
  const sidebarTop   = sidebar ? sidebar.offsetTop   : 16;
  const sidebarWidth = sidebar ? sidebar.offsetWidth : 380;
  const gap = 10; // px gap between sidebar and panel

  const borderColor = isTour ? 'var(--brand-pink)' : 'var(--panel-border)';
  const panelShadow = isTour ? '0 0 30px rgba(244, 114, 182, 0.25)' : 'var(--panel-shadow)';
  const headerBg = isTour ? 'rgba(244, 114, 182, 0.1)' : 'transparent';

  const panel = document.createElement('div');
  panel.id = 'directions-panel';
  panel.style.cssText = `
    position: absolute;
    top: ${sidebarTop}px;
    left: ${sidebarLeft + sidebarWidth + gap}px;
    width: 280px;
    height: calc(100vh - ${sidebarTop + 16}px);
    background: var(--panel-bg, rgba(17,24,39,0.92));
    border: 1px solid ${borderColor};
    border-radius: 5px;
    box-shadow: ${panelShadow};
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    font-family: inherit;
    color: var(--text-main);
    overflow: hidden;
    opacity: 0;
    transform: translateX(-8px);
  `;

  panel.innerHTML = `
    <!-- Header -->
    <div id="dir-panel-header" style="display:flex; justify-content:space-between; align-items:center; background: ${headerBg};
                padding:10px 12px 8px; border-bottom:1px solid rgba(148,163,184,0.15); flex-shrink:0; cursor: move; border-radius: 5px 5px 0 0;">
      <div>
        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Directions to</div>
        <div style="font-size:13px; font-weight:600; color:var(--heading-color); margin-top:1px;
                    line-height:1.3; max-width:230px;">
          ${label}
        </div>
        <div id="dir-destination-address" style="font-size:12px; color:var(--text-muted); margin-top:6px; max-width:230px; line-height:1.4;"></div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button id="dir-panel-clear"
          style="background:rgba(148,163,184,0.15); border:1px solid var(--panel-border); color:var(--text-muted);
                 font-size:10px; font-weight:600; border-radius:999px; padding:2px 8px;
                 cursor:pointer; white-space:nowrap; transition: background 0.2s, border-color 0.2s;"
                 onmouseover="this.style.background='rgba(148,163,184,0.25)';"
                 onmouseout="this.style.background='rgba(148,163,184,0.15)';"
                 data-is-tour="${isTour}">
          ${isTour ? 'End Tour' : 'Clear'}
        </button>
        <button id="dir-panel-minimize" title="Minimize"
          style="background:#4a5568; border:1px solid #64748b; color:#ffffff;
                 font-size:16px; cursor:pointer; width:24px; height:24px; display:flex;
                 align-items:center; justify-content:center; border-radius:4px; line-height:1;
                 transition: background 0.2s, border-color 0.2s, color 0.2s;"
                 onmouseover="this.style.background='#64748b'; this.style.borderColor='#94a3b8';"
                 onmouseout="this.style.background='#4a5568'; this.style.borderColor='#64748b';">
          −</button>
        <button id="dir-panel-close" title="Close"
          style="background:#4a5568; border:1px solid #64748b; color:#ffffff;
                 font-size:16px; cursor:pointer; width:24px; height:24px; display:flex;
                 align-items:center; justify-content:center; border-radius:4px; line-height:1;
                 transition: background 0.2s, border-color 0.2s, color 0.2s;"
                 onmouseover="this.style.background='#64748b'; this.style.borderColor='#94a3b8';"
                 onmouseout="this.style.background='#4a5568'; this.style.borderColor='#64748b';">
          ×</button>
      </div>
    </div>

    <!-- Mode tabs -->
    <div id="dir-tabs" style="display:flex; width:100%; flex-shrink:0; overflow-x:auto; scrollbar-width:none; padding:0; background: rgba(148, 163, 184, 0.05); border-bottom: 1px solid rgba(148, 163, 184, 0.15); gap:0; margin-bottom: 10px;">
      <button class="dir-tab ${isTour ? '' : 'dir-tab--active'}" data-mode="TRANSIT" onclick="window._directionsSelectMode('TRANSIT')">
        <span style="font-size:16px;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M297.5-422.5Q280-405 280-380t17.5 42.5Q315-320 340-320t42.5-17.5Q400-355 400-380t-17.5-42.5Q365-440 340-440t-42.5 17.5Zm532.5-93Q880-471 880-400v160q0 33-23.5 56.5T800-160l80 80H520l80-80q-33 0-56.5-23.5T520-240v-160q0-71 50-115.5T700-560q80 0 130 44.5ZM679-291q-9 9-9 21t9 21q9 9 21 9t21-9q9-9 9-21t-9-21q-9-9-21-9t-21 9Zm-91-149q-4 9-6 19t-2 21v40h240v-40q0-11-2-21t-6-19H588ZM480-880q172 0 246 37t74 123v96q-18-6-38-9.5t-42-5.5v-41H240v120h260q-16 17-27.5 37T453-480H240v120q0 33 23.5 56.5T320-280h120v80H320v40q0 17-11.5 28.5T280-120h-40q-17 0-28.5-11.5T200-160v-82q-18-20-29-44.5T160-340v-380q0-83 77-121.5T480-880Zm2 120h224-448 224Zm-224 0h448q-15-17-64.5-28.5T482-800q-107 0-156.5 12.5T258-760Zm195 280Z"/></svg></span>
        <span style="font-size:11px; font-weight:600; margin-top:2px;">Transit</span>
        <span id="dir-time-TRANSIT" style="font-size:10px; opacity:0.8; margin-top:1px;">…</span>
      </button>
      <button class="dir-tab ${isTour ? 'dir-tab--active' : ''}" data-mode="WALKING" onclick="window._directionsSelectMode('WALKING')">
        <span style="font-size:16px;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m280-40 112-564-72 28v136h-80v-188l202-86q14-6 29.5-7t29.5 4q14 5 26.5 14t20.5 23l40 64q26 42 70.5 69T760-520v80q-70 0-125-29t-94-74l-25 123 84 80v300h-80v-260l-84-64-72 324h-84Zm203.5-723.5Q460-787 460-820t23.5-56.5Q507-900 540-900t56.5 23.5Q620-853 620-820t-23.5 56.5Q573-740 540-740t-56.5-23.5Z"/></svg></span>
        <span style="font-size:11px; font-weight:600; margin-top:2px;">${isTour ? 'Tour Path' : 'Walk'}</span>
        <span id="dir-time-WALKING" style="font-size:10px; opacity:0.8; margin-top:1px;">…</span>
      </button>
      <button class="dir-tab" data-mode="DRIVING" onclick="window._directionsSelectMode('DRIVING')">
        <span style="font-size:16px;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M240-200v40q0 17-11.5 28.5T200-120h-40q-17 0-28.5-11.5T120-160v-320l84-240q6-18 21.5-29t34.5-11h440q19 0 34.5 11t21.5 29l84 240v320q0 17-11.5 28.5T800-120h-40q-17 0-28.5-11.5T720-160v-40H240Zm-8-360h496l-42-120H274l-42 120Zm-32 80v200-200Zm100 160q25 0 42.5-17.5T360-380q0-25-17.5-42.5T300-440q-25 0-42.5 17.5T240-380q0 25 17.5 42.5T300-320Zm360 0q25 0 42.5-17.5T720-380q0-25-17.5-42.5T660-440q-25 0-42.5 17.5T600-380q0 25 17.5 42.5T660-320Zm-460 40h560v-200H200v200Z"/></svg></span>
        <span style="font-size:11px; font-weight:600; margin-top:2px;">Drive</span>
        <span id="dir-time-DRIVING" style="font-size:10px; opacity:0.8; margin-top:1px;">…</span>
      </button>
      <button class="dir-tab" data-mode="BICYCLING" onclick="window._directionsSelectMode('BICYCLING')">
        <span style="font-size:16px;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M200-80q-83 0-141.5-58.5T0-280q0-83 58.5-141.5T200-480q83 0 141.5 58.5T400-280q0 83-58.5 141.5T200-80Zm85-115q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm155-5v-200L312-512q-12-11-18-25.5t-6-30.5q0-16 6.5-30.5T312-624l112-112q12-12 27.5-18t32.5-6q17 0 32.5 6t27.5 18l76 76q28 28 64 44t76 16v80q-57 0-108.5-22T560-604l-32-32-96 96 88 92v248h-80Zm123.5-563.5Q540-787 540-820t23.5-56.5Q587-900 620-900t56.5 23.5Q700-853 700-820t-23.5 56.5Q653-740 620-740t-56.5-23.5ZM760-80q-83 0-141.5-58.5T560-280q0-83 58.5-141.5T760-480q83 0 141.5 58.5T960-280q0 83-58.5 141.5T760-80Zm85-115q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Z"/></svg></span>
        <span style="font-size:11px; font-weight:600; margin-top:2px;">Bike</span>
        <span id="dir-time-BICYCLING" style="font-size:10px; opacity:0.8; margin-top:1px;">…</span>
      </button>
    </div>

    <!-- Route list -->
    <div id="dir-route-list"
      style="overflow-y:auto; padding:8px 10px 12px; flex:1; scrollbar-width:thin;
             scrollbar-color:var(--panel-border) transparent;">
      <div style="text-align:center; color:var(--text-muted); padding:24px 0; font-size:13px;">
        Fetching routes…
      </div>
    </div>
  `;

  // Append to #app so it sits beside the sidebar, not inside it
  document.getElementById('app').appendChild(panel);
  directionsPanel = panel;

  // Make it draggable via the header
  const header = panel.querySelector('#dir-panel-header');
  if (header) {
    _makeElementDraggable(panel, header);
  }

  // Trigger slide-in on next frame
  requestAnimationFrame(() => {
    panel.style.opacity   = '1';
    panel.style.transform = 'translateX(0)';
    // After the initial entrance animation, clear the inline styles 
    // so the CSS :hover transparency rules can take effect.
    setTimeout(() => {
      if (panel) panel.style.removeProperty('opacity');
      if (panel) panel.style.removeProperty('transition');
      if (panel) panel.style.removeProperty('box-shadow');
    }, 400);
  });

  // Close button
  panel.querySelector('#dir-panel-close').addEventListener('click', () => {
    panel.remove();
    directionsPanel = null;
    routeRenderers.forEach(r => r.setMap(null));
    routeRenderers = [];
    if (directionsRenderer) directionsRenderer.setMap(null);
  });

  // Clear button — resets to default state (removes routes + itinerary, resets tabs)
  panel.querySelector('#dir-panel-clear').addEventListener('click', (e) => {
    e.currentTarget.blur();
    const isTourPanel = e.currentTarget.dataset.isTour === 'true';

    if (isTourPanel) {
      // End the tour
      activeFilters.tour = null;
      activeTourDefinition = null;
      activeTourCursor = 0;
      activeTourOrderedStops = [];
      if (activeTourPolyline) {
        activeTourPolyline.setMap(null);
        activeTourPolyline = null;
      }
      tourMarkers.forEach(m => m.setMap(null));
      tourMarkers = [];
      applyFilters();
      renderTourCards();
      // Close the panel
      panel.remove();
      directionsPanel = null;
      routeRenderers.forEach(r => r.setMap(null));
      routeRenderers = [];
      if (directionsRenderer) directionsRenderer.setMap(null);
      return;
    }

    // Clear drawn routes from map
    routeRenderers.forEach(r => r.setMap(null));
    routeRenderers = [];
    if (directionsRenderer) directionsRenderer.setMap(null);

    // Reset route list to default message
    const listEl = panel.querySelector('#dir-route-list');
    if (listEl) {
      listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px 0; font-size:13px;">
        Select a travel mode above to see routes.
      </div>`;
    }

    // Reset all tabs to inactive state, highlight Transit as default
    activeModeTab = 'TRANSIT';
    panel.querySelectorAll('.dir-tab').forEach(t => {
      const isTransit = t.dataset.mode === 'TRANSIT';
      t.classList.toggle('dir-tab--active', isTransit);
    });
  });

  // Minimize button logic
  const minBtn = panel.querySelector('#dir-panel-minimize');
  minBtn.addEventListener('click', (e) => {
    const isMin = panel.classList.toggle('minimized');
    minBtn.textContent = isMin ? '+' : '−';
    minBtn.title = isMin ? 'Expand' : 'Minimize';
    // Blur the button so the panel can fade out when the mouse leaves
    e.currentTarget.blur();
  });
}

/** Update a mode tab's time estimate once its request returns */
async function updateDirectionsPanelAddress(lat, lng, explicitText = '') {
  const labelEl = document.getElementById('dir-destination-address');
  if (!labelEl) return;
  if (explicitText && explicitText.trim()) {
    labelEl.textContent = explicitText.trim();
    return;
  }

  labelEl.textContent = 'Loading address...';
  try {
    const address = await getAddressFromLatLng(lat, lng);
    labelEl.textContent = address || 'Address not available';
  } catch (err) {
    labelEl.textContent = 'Address not available';
  }
}

async function updateTourNextHintAddress(stop) {
  const hintEl = document.getElementById('tourNextHint');
  if (!hintEl) return;
  if (!stop) {
    hintEl.textContent = 'This is the final stop.';
    return;
  }

  const address = stop.address || (stop.neighborhood ? `${stop.neighborhood}, ${stop.borough || 'NY'}` : '');
  hintEl.textContent = `Next: ${stop.name}` + (address ? ` — ${address}` : '');

  if (!address && stop.lat != null && stop.lng != null) {
    const resolved = await getAddressFromLatLng(stop.lat, stop.lng);
    if (hintEl) {
      hintEl.textContent = `Next: ${stop.name} — ${resolved}`;
    }
  }
}

function _updateModeTab(modeKey, response, mode) {
  const timeEl = document.getElementById(`dir-time-${modeKey}`);
  if (!timeEl) return;

  const tabBtn = timeEl.closest('.dir-tab');
  const isHidden = tabBtn && tabBtn.style.display === 'none';

  if (!response) {
    timeEl.textContent = isHidden ? '' : 'N/A';
    return;
  }
  const best = response.routes.reduce((min, r) => {
    const secs = r.legs[0]?.duration?.value || Infinity;
    return secs < min ? secs : min;
  }, Infinity);
  timeEl.textContent = best === Infinity ? 'N/A' : _fmtDuration(best);
}

/** Returns polylineOptions for a given mode key.
 *  Walking gets a blue dotted line matching the transit walking segments. */
function _polylineOpts(modeKey, fallbackColor = '#3b82f6') {
  const color = fallbackColor;
  if (modeKey === 'WALKING') {
    return {
      strokeColor:   color,
      strokeOpacity: 0,           // hide the solid line
      strokeWeight:  5,
      icons: [{
        icon: {
          path:         google.maps.SymbolPath.CIRCLE,
          fillColor:    color,
          fillOpacity:  1,
          strokeColor:  color,
          strokeOpacity:1,
          scale:        3
        },
        offset: '0',
        repeat: '12px'            // dot spacing
      }]
    };
  }
  return { strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85 };
}

/** Draw the route line for the selected mode */
function _drawMode(results, modeKey, origin, destination) {
  routeRenderers.forEach(r => r.setMap(null));
  routeRenderers = [];
  if (directionsRenderer) directionsRenderer.setMap(null);

  const entry = results[modeKey];
  if (!entry) return;

  const colors = { TRANSIT:'#65FE08', WALKING:'#3b82f6', DRIVING:'#FE1CCF', BICYCLING:'#F3FF00' };
  const color  = entry.mode?.color || colors[modeKey] || '#3b82f6';

  const renderer = new google.maps.DirectionsRenderer({
    map,
    directions: entry.response,
    routeIndex: 0,
    suppressMarkers: false,
    polylineOptions: _polylineOpts(modeKey, color)
  });
  routeRenderers.push(renderer);
}

/** Render route alternatives + step-by-step for the selected mode */
function _showRouteList(results, modeKey, origin, destination) {
  const listEl = document.getElementById('dir-route-list');
  if (!listEl) return;

  const entry = results[modeKey];
  if (!entry) {
    listEl.innerHTML = `
      <div style="text-align:center; color:var(--brand-pink); padding:20px 0; font-size:13px;">
        No routes available for this mode.
      </div>`;
    return;
  }

  const routes   = entry.response.routes;
  const mode     = entry.mode;
  const colors   = { TRANSIT:'#65FE08', WALKING:'#3b82f6', DRIVING:'#FE1CCF', BICYCLING:'#F3FF00' };
  const color    = mode?.color || colors[modeKey] || '#3b82f6';

  listEl.innerHTML = '';

  routes.forEach((route, idx) => {
    const leg      = route.legs[0];
    const duration = leg.duration?.text || '?';
    const distance = leg.distance?.text || '?';
    const summary  = route.summary || '';
    const isBest   = idx === 0;

    // Build transit step chips (bus lines, subway lines, walk segments)
    let stepsHtml = '';
    if (modeKey === 'TRANSIT') {
      const chips = leg.steps.map(step => {
        if (step.travel_mode === 'WALKING') {
          return `<span style="display:inline-flex; align-items:center; gap:3px; color:var(--text-muted);">
  <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor">
    <path d="m280-40 112-564-72 28v136h-80v-188l202-86q14-6 29.5-7t29.5 4q14 5 26.5 14t20.5 23l40 64q26 42 70.5 69T760-520v80q-70 0-125-29t-94-74l-25 123 84 80v300h-80v-260l-84-64-72 324h-84Zm203.5-723.5Q460-787 460-820t23.5-56.5Q507-900 540-900t56.5 23.5Q620-853 620-820t-23.5 56.5Q573-740 540-740t-56.5-23.5Z"/>
  </svg>
  ${step.duration?.text}
</span>`;
        }
        if (step.travel_mode === 'TRANSIT') {
          const t = step.transit;
          const lineName  = t?.line?.short_name || t?.line?.name || '';
          const lineColor = t?.line?.color ? `#${t.line.color}` : color;
          const lineText  = t?.line?.text_color ? `#${t.line.text_color}` : '#ffffff';
          const vehicle   = t?.line?.vehicle?.type || '';
          const emoji     = vehicle === 'SUBWAY' ? '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M240-120v-40l60-40q-59 0-99.5-40.5T160-340v-380q0-83 77-121.5T480-880q172 0 246 37t74 123v380q0 59-40.5 99.5T660-200l60 40v40H240Zm0-440h200v-120H240v120Zm420 80H240h480-60Zm-140-80h200v-120H520v120ZM382.5-337.5Q400-355 400-380t-17.5-42.5Q365-440 340-440t-42.5 17.5Q280-405 280-380t17.5 42.5Q315-320 340-320t42.5-17.5Zm280 0Q680-355 680-380t-17.5-42.5Q645-440 620-440t-42.5 17.5Q560-405 560-380t17.5 42.5Q595-320 620-320t42.5-17.5ZM300-280h360q26 0 43-17t17-43v-140H240v140q0 26 17 43t43 17Zm180-520q-86 0-142.5 10T258-760h448q-18-20-74.5-30T480-800Zm0 40h226-448 222Z"/></svg>'
                          : vehicle === 'BUS'    ? '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M264-144q-10.2 0-17.1-6.9-6.9-6.9-6.9-17.1v-85q-23-19-35.5-47T192-360v-360q0-72 58-108t230-36q171 0 229.5 36T768-720v360q0 32-12.5 60T720-253v85q0 10.2-6.9 17.1-6.9 6.9-17.1 6.9h-48q-10.2 0-17.1-6.9-6.9-6.9-6.9-17.1v-48H336v48q0 10.2-6.9 17.1-6.9 6.9-17.1 6.9h-48Zm218.18-600H692 269h213.18ZM624-480H264h432-72Zm-360-72h432v-120H264v120Zm130 202q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14Zm240 0q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14ZM269-744h423q-20-29-66-38.5T480-792q-93 0-140.5 10T269-744Zm67.06 456h288.22Q654-288 675-309.15T696-360v-120H264v120q0 30 21.17 51 21.16 21 50.89 21Z"/></svg>'
                          : vehicle === 'RAIL'   ? '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M264-144v-24l50-50q-53-9-87.5-49T192-360v-360q0-72 66-108t222-36q156 0 222 36t66 108v360q0 53-34.5 93T646-218l50 50v24H264Zm0-408h432v-120H264v120Zm378 72H264h432-54ZM514-350q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14Zm-178 62h288q30 0 51-21t21-51v-120H264v120q0 30 21 51t51 21Zm144-504q-98 0-147 12.5T269-744h423q-14-23-64-35.5T480-792Zm0 48h212-423 211Z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="m168-96 72-72h480l72 72H168Zm95-120 49-50q-52-9-86-49t-34-93v-264q0-113 84-176.5T480-912q120 0 204 63.5T768-672v264q0 53-34 93t-86 49l48 50H263Zm73-120h288q30 0 51-21t21-51v-120H264v120q0 30 21 51t51 21Zm178-62q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14ZM264-600h432v-72q0-13-1.5-25t-5.5-23H271q-4 11-5.5 23t-1.5 25v72Zm58-192h316q-30-23-70.5-35.5T480-840q-47 0-87.5 12.5T322-792Zm158 264Zm0-264Z"/></svg>';
          return `<span style="display:inline-flex; align-items:center; gap:3px;
                               padding:2px 7px; border-radius:999px;
                               background:${lineColor}; color:${lineText};
                               font-size:10px; font-weight:700;">
                    ${emoji} ${lineName}
                  </span>`;
        }
        return '';
      }).filter(Boolean);

      if (chips.length) {
        stepsHtml = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px;">
                       ${chips.join('<span style="color:#475569;font-size:11px;">›</span>')}
                     </div>`;
      }

      // Departure / arrival times
      const dep = leg.departure_time?.text || '';
      const arr = leg.arrival_time?.text || '';
      if (dep && arr) {
        stepsHtml += `<div style="margin-top:6px; font-size:11px; color:var(--text-muted);">
                        Departs ${dep} · Arrives ${arr}
                      </div>`;
      }
    } else {
      // Driving / Walking / Biking — show top 3 steps
      const topSteps = leg.steps.slice(0, 3);
      if (topSteps.length) {
        stepsHtml = `<ol style="margin:8px 0 0 0; padding-left:16px; font-size:11px; color: var(--text-muted); line-height:1.5;">
          ${topSteps.map(s => `<li>${s.instructions?.replace(/<[^>]+>/g, '') || ''}</li>`).join('')}
          ${leg.steps.length > 3 ? `<li style="list-style:none; margin-left:-16px; color:#60a5fa;">
            + ${leg.steps.length - 3} more steps…</li>` : ''}
        </ol>`;
      }
    }

    const card = document.createElement('div');
    card.className = 'dir-route-card';
    card.style.cssText = `
      padding:10px 12px;
      margin-bottom:6px;
      background:${isBest ? 'rgba(59,130,246,0.1)' : 'var(--card-bg)'};
      border:1px solid ${isBest ? 'rgba(59,130,246,0.35)' : 'rgba(148,163,184,0.15)'};
      border-radius:5px;
      cursor:pointer;
      transition:background 0.15s;
    `;
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px;">
            ${isBest ? `<span style="font-size:10px; background:${color}; color:#0f172a;
                          font-weight:700; padding:1px 7px; border-radius:999px;">Best</span>` : ''}
            <span style="font-size:16px; font-weight:700; color:var(--heading-color);">${duration}</span>
            <span style="font-size:12px; color:var(--text-muted); white-space:normal;">${distance}</span>
          </div>
          ${summary ? `<div style="font-size:11px; color:var(--text-muted); margin-top:1px; white-space:normal; line-height:1.2;">via ${summary}</div>` : ''}
          ${stepsHtml}
        </div>
        <button class="dir-go-btn"
          data-route-idx="${idx}"
          style="flex-shrink:0; border:none; border-radius:999px; background:${color};
                 color:#0f172a; font-weight:700; font-size:12px; padding:7px 14px;
                 cursor:pointer; white-space:nowrap;"
          onclick="event.stopPropagation(); window._selectRoute(${idx})">
          Go
        </button>
      </div>
    `;

    // Highlight this route on the map when card is hovered
    card.addEventListener('mouseenter', () => {
      routeRenderers.forEach(r => r.setMap(null));
      routeRenderers = [];
      const r = new google.maps.DirectionsRenderer({
        map,
        directions: entry.response,
        routeIndex: idx,
        suppressMarkers: false,
        polylineOptions: _polylineOpts(modeKey, color)
      });
      routeRenderers.push(r);
    });

    listEl.appendChild(card);
  });

  // Store for Go button
  window._directionsResultsStore = { results, modeKey, color };
}

/** Switch to a specific route alternative when user clicks Go.
 *  Draws the route on the map AND expands the card to show a full
 *  stop-by-stop itinerary for every transit and walking leg. */
window._selectRoute = function(routeIdx) {
  const store = window._directionsResultsStore;
  if (!store) return;
  const entry = store.results[store.modeKey];
  if (!entry) return;

  // ── 1. Draw the route on the map ───────────────────────────────────────
  routeRenderers.forEach(r => r.setMap(null));
  routeRenderers = [];
  if (directionsRenderer) directionsRenderer.setMap(null);

  const renderer = new google.maps.DirectionsRenderer({
    map,
    directions: entry.response,
    routeIndex: routeIdx,
    suppressMarkers: false,
    polylineOptions: _polylineOpts(store.modeKey, store.color)
  });
  routeRenderers.push(renderer);

  // Fit map to the selected route
  const bounds = new google.maps.LatLngBounds();
  entry.response.routes[routeIdx].legs[0].steps.forEach(s => {
    bounds.extend(s.start_location);
    bounds.extend(s.end_location);
  });
  map.fitBounds(bounds, { padding: 80 });

  // ── 2. Expand the correct route card with stop-by-stop itinerary ───────
  const listEl = document.getElementById('dir-route-list');
  if (!listEl) return;

  // Clear any previously expanded itinerary panels
  listEl.querySelectorAll('.dir-itinerary').forEach(el => el.remove());
  listEl.querySelectorAll('.dir-go-btn').forEach(btn => {
    btn.textContent = 'Go';
    btn.style.background = store.color;
  });

  // Find the Go button for this route index and mark it active
  const goBtn = listEl.querySelector(`[data-route-idx="${routeIdx}"]`);
  if (goBtn) {
    goBtn.textContent = '✓';
    goBtn.style.background = '#22c55e';
  }

  // Find the card for this route and inject the itinerary after it
  const cards = listEl.querySelectorAll('.dir-route-card');
  const targetCard = cards[routeIdx];
  if (!targetCard) return;

  const itinerary = _buildItinerary(
    entry.response.routes[routeIdx],
    store.modeKey,
    store.color
  );

  // Insert the itinerary panel immediately after the route card
  targetCard.insertAdjacentElement('afterend', itinerary);

  // Scroll so the itinerary is visible
  itinerary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/**
 * Build a DOM element containing the full step-by-step itinerary for a route.
 * Transit legs show: board station, every intermediate stop, and alight station.
 * Walk legs show direction instructions and distance.
 */
function _buildItinerary(route, modeKey, color) {
  const leg    = route.legs[0];
  const wrap   = document.createElement('div');
  wrap.className = 'dir-itinerary';
  wrap.style.cssText = `
    margin: -4px 0 8px 0;
    padding: 10px 12px;
    background: var(--card-bg);
    border: 1px solid rgba(148,163,184,0.18);
    border-top: none;
    border-radius: 0 0 8px 8px;
    font-size: 11px;
    color: var(--text-main);
    line-height: 1.4;
  `;

  const colors = { TRANSIT:'#65FE08', WALKING:'#3b82f6', DRIVING:'#FE1CCF', BICYCLING:'#F3FF00' };

  // ── Header row ──────────────────────────────────────────────────────────
  const dep = leg.departure_time?.text || '';
  const arr = leg.arrival_time?.text   || '';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;';
  header.innerHTML = `
    <span style="font-weight:700; font-size:12px; color:var(--heading-color);">Itinerary</span>
    <div style="display:flex; align-items:center; gap:8px;">
      ${dep && arr ? `<span style="font-size:10px; color:var(--text-muted);">${dep} → ${arr}</span>` : ''}
      <button class="dir-itinerary-clear"
        style="background:none; border:1px solid var(--panel-border); color:var(--text-muted);
               font-size:11px; font-weight:600; border-radius:999px; padding:3px 9px;
               cursor:pointer; white-space:nowrap; line-height:1.4;">
        Clear
      </button>
    </div>
  `;

  // Wire the clear button: removes itinerary, resets Go button, clears route line
  header.querySelector('.dir-itinerary-clear').addEventListener('click', () => {
    // Remove this itinerary panel
    wrap.remove();

    // Reset all Go buttons back to their default state
    const listEl = document.getElementById('dir-route-list');
    const store  = window._directionsResultsStore;
    if (listEl && store) {
      listEl.querySelectorAll('.dir-go-btn').forEach(btn => {
        btn.textContent = 'Go';
        btn.style.background = store.color;
      });
    }

    // Clear the drawn route line from the map
    routeRenderers.forEach(r => r.setMap(null));
    routeRenderers = [];
    if (directionsRenderer) directionsRenderer.setMap(null);
  });

  wrap.appendChild(header);

  // ── Step list ────────────────────────────────────────────────────────────
  leg.steps.forEach((step, stepIdx) => {
    const isLast = stepIdx === leg.steps.length - 1;

    if (step.travel_mode === 'WALKING') {
      // Walking segment
      const instructions = step.instructions?.replace(/<[^>]+>/g, '') || 'Walk';
      const dur  = step.duration?.text  || '';
      const dist = step.distance?.text  || '';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:10px; margin-bottom:8px;';
      row.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:20px;">
          <div style="width:18px; height:18px; border-radius:50%;
                      background:rgba(34,197,94,0.18); border:1.5px solid #22c55e;
                      display:flex; align-items:center; justify-content:center; flex-shrink:0;
                      font-size:10px;">🚶</div>
          ${!isLast ? `<div style="width:2px; flex:1; background:rgba(148,163,184,0.2); margin:3px 0;"></div>` : ''}
        </div>
        <div style="flex:1; padding-top:1px;">
          <div style="color:var(--text-main);">${instructions}</div>
          <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">${[dur, dist].filter(Boolean).join(' · ')}</div>
        </div>
      `;
      wrap.appendChild(row);

    } else if (step.travel_mode === 'TRANSIT') {
      // Transit segment — board, intermediate stops, alight
      const t         = step.transit;
      const lineName  = t?.line?.short_name || t?.line?.name || '';
      const lineColor = t?.line?.color      ? `#${t.line.color}`      : color;
      const lineText  = t?.line?.text_color ? `#${t.line.text_color}` : '#ffffff';
      const vehicle   = t?.line?.vehicle?.type || '';
      const emoji     = vehicle === 'SUBWAY' ? '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M192-312v-360q0-36 16.5-63t51-45q34.5-18 89.5-27t131-9q77 0 131.5 9t89 27q34.5 18 51 45t16.5 63v360q0 54-34.5 94T645-170l51 50v24h-78l-72-72H414l-72 72h-78v-24l50-50q-53-8-87.5-48T192-312Zm288-432q-103 0-147 11.5T269-696h423q-17-25-58.5-36.5T480-744ZM264-504h180v-120H264v120Zm378 72H264h432-54Zm-126-72h180v-120H516v120ZM394-302q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14Zm240 0q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14Zm-298 62h288q30 0 51-21t21-51v-120H264v120q0 30 21 51t51 21Zm144-456h212-423 211Z"/></svg>' : 
                        vehicle === 'BUS' ? '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M264-144q-10.2 0-17.1-6.9-6.9-6.9-6.9-17.1v-85q-23-19-35.5-47T192-360v-360q0-72 58-108t230-36q171 0 229.5 36T768-720v360q0 32-12.5 60T720-253v85q0 10.2-6.9 17.1-6.9 6.9-17.1 6.9h-48q-10.2 0-17.1-6.9-6.9-6.9-6.9-17.1v-48H336v48q0 10.2-6.9 17.1-6.9 6.9-17.1 6.9h-48Zm218.18-600H692 269h213.18ZM624-480H264h432-72Zm-360-72h432v-120H264v120Zm130 202q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14Zm240 0q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14ZM269-744h423q-20-29-66-38.5T480-792q-93 0-140.5 10T269-744Zm67.06 456h288.22Q654-288 675-309.15T696-360v-120H264v120q0 30 21.17 51 21.16 21 50.89 21Z"/></svg>' : 
                        vehicle === 'RAIL' ? '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M264-144v-24l50-50q-53-9-87.5-49T192-360v-360q0-72 66-108t222-36q156 0 222 36t66 108v360q0 53-34.5 93T646-218l50 50v24H264Zm0-408h432v-120H264v120Zm378 72H264h432-54ZM514-350q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14Zm-178 62h288q30 0 51-21t21-51v-120H264v120q0 30 21 51t51 21Zm144-504q-98 0-147 12.5T269-744h423q-14-23-64-35.5T480-792Zm0 48h212-423 211Z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="m168-96 72-72h480l72 72H168Zm95-120 49-50q-52-9-86-49t-34-93v-264q0-113 84-176.5T480-912q120 0 204 63.5T768-672v264q0 53-34 93t-86 49l48 50H263Zm73-120h288q30 0 51-21t21-51v-120H264v120q0 30 21 51t51 21Zm178-62q14-14 14-34t-14-34q-14-14-34-14t-34 14q-14 14-14 34t14 34q14 14 34 14t34-14ZM264-600h432v-72q0-13-1.5-25t-5.5-23H271q-4 11-5.5 23t-1.5 25v72Zm58-192h316q-30-23-70.5-35.5T480-840q-47 0-87.5 12.5T322-792Zm158 264Zm0-264Z"/></svg>';
      const headsign  = t?.headsign || '';
      const numStops  = t?.num_stops || 0;
      const stops     = t?.stops || [];        // array of {name, location} if provided by API
      const boardStop = t?.departure_stop?.name || step.start_location?.toString() || '';
      const alightStop= t?.arrival_stop?.name   || step.end_location?.toString()   || '';
      const stepDep   = t?.departure_time?.text || '';
      const stepArr   = t?.arrival_time?.text   || '';

      // ── Board station ──
      const boardRow = document.createElement('div');
      boardRow.style.cssText = 'display:flex; gap:10px; margin-bottom:4px;';
      boardRow.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:20px;">
          <div style="width:18px; height:18px; border-radius:50%;
                      background:${lineColor}; border:2px solid ${lineColor};
                      display:flex; align-items:center; justify-content:center; flex-shrink:0;
                      font-size:9px; color:${lineText}; font-weight:700;">
            ${emoji} 
          </div>
          <div style="width:2px; flex:1; background:${lineColor}; opacity:0.5; margin:3px 0;"></div>
        </div>
        <div style="flex:1; padding-top:1px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="color:var(--heading-color); font-weight:600;">Board at ${boardStop}</span>
            <span style="padding:1px 8px; border-radius:999px; background:${lineColor};
                         color:${lineText}; font-size:10px; font-weight:700;">${lineName}</span>
          </div>
          ${headsign ? `<div style="color:var(--text-muted); font-size:11px; margin-top:2px;">Direction: ${headsign}</div>` : ''}
          ${stepDep   ? `<div style="color:var(--text-muted); font-size:11px;">Departs ${stepDep}</div>` : ''}
        </div>
      `;
      wrap.appendChild(boardRow);

      // ── Intermediate stops ──────────────────────────────────────────────
      // Both paths render a clickable link. Named stops expand immediately;
      // the count-only fallback also becomes a link (no list to show but
      // still formatted consistently as a link).
      if (stops.length > 2) {
        // API returned named stops — list every intermediate one on expand
        const midStops = stops.slice(1, -1);
        const toggleId = `stops-${stepIdx}-${Math.random().toString(36).substr(2,5)}`;
        const stopCount = midStops.length;
        const dur = step.duration?.text || '';

        const toggleRow = document.createElement('div');
        toggleRow.style.cssText = 'display:flex; gap:10px; margin-bottom:4px;';
        toggleRow.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:20px;">
            <div style="width:2px; flex:1; background:${lineColor}; opacity:0.5;"></div>
          </div>
          <div style="flex:1;">
            <a id="${toggleId}-btn" href="javascript:void(0)"
               style="color:var(--brand-blue); font-size:11px; font-weight:500;
                      text-decoration:underline; cursor:pointer; display:inline-block; padding:2px 0;">
              ${stopCount} intermediate stop${stopCount !== 1 ? 's' : ''}${dur ? ` (${dur})` : ''}
            </a>
            <ol id="${toggleId}-list"
              style="display:none; margin:6px 0 2px 0; padding-left:14px;
                     color:var(--text-muted); font-size:11px; line-height:1.8; list-style:disc;">
              ${midStops.map(s => `<li>${s.name}</li>`).join('')}
            </ol>
          </div>
        `;
        wrap.appendChild(toggleRow);

        // Wire toggle after appending so IDs resolve
        setTimeout(() => {
          const btn  = document.getElementById(`${toggleId}-btn`);
          const list = document.getElementById(`${toggleId}-list`);
          if (btn && list) {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              const open = list.style.display !== 'none';
              list.style.display = open ? 'none' : 'block';
              btn.textContent = open
                ? `${stopCount} intermediate stop${stopCount !== 1 ? 's' : ''}${dur ? ` (${dur})` : ''}`
                : `▾ Hide stops`;
            });
          }
        }, 0);

      } else if (numStops > 0) {
        // API returned only a count — render as a link (no named list available)
        const count = numStops - 1;
        const dur   = step.duration?.text || '';
        const toggleId = `stops-${stepIdx}-${Math.random().toString(36).substr(2,5)}`;

        const countRow = document.createElement('div');
        countRow.style.cssText = 'display:flex; gap:10px; margin-bottom:4px;';
        countRow.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:20px;">
            <div style="width:2px; flex:1; background:${lineColor}; opacity:0.4;
                        border-left:2px dashed ${lineColor};"></div>
          </div>
          <div style="flex:1; padding-top:2px;">
            <a id="${toggleId}-btn" href="javascript:void(0)"
               style="color:var(--brand-blue); font-size:11px; font-weight:500;
                      text-decoration:underline; cursor:pointer; display:inline-block;">
              ${count} intermediate stop${count !== 1 ? 's' : ''}${dur ? ` (${dur})` : ''}
            </a>
            <div id="${toggleId}-note"
              style="display:none; margin-top:4px; font-size:10px; color:var(--text-muted); font-style:italic;">
              Stop names not available for this route.
            </div>
          </div>
        `;
        wrap.appendChild(countRow);

        // Wire toggle — shows a note since the API didn't return named stops
        setTimeout(() => {
          const btn  = document.getElementById(`${toggleId}-btn`);
          const note = document.getElementById(`${toggleId}-note`);
          if (btn && note) {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              const open = note.style.display !== 'none';
              note.style.display = open ? 'none' : 'block';
              btn.textContent = open
                ? `${count} intermediate stop${count !== 1 ? 's' : ''}${dur ? ` (${dur})` : ''}`
                : `▾ ${count} stop${count !== 1 ? 's' : ''}${dur ? ` (${dur})` : ''}`;
            });
          }
        }, 0);
      }

      // ── Arrive station ──
      const alightRow = document.createElement('div');
      alightRow.style.cssText = 'display:flex; gap:10px; margin-bottom:8px;';
      alightRow.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:20px;">
          <div style="width:12px; height:12px; border-radius:50%;
                      border:2px solid ${lineColor}; background:#1e293b;
                      margin:0 3px; flex-shrink:0;"></div>
          ${!isLast ? `<div style="width:2px; flex:1; background:rgba(148,163,184,0.2); margin:3px 0;"></div>` : ''}
        </div>
        <div style="flex:1; padding-top:1px;">
          <div style="color:var(--heading-color); font-weight:600;">Arrive at ${alightStop}</div>
          ${stepArr ? `<div style="color:var(--text-muted); font-size:11px;">Arrives ${stepArr}</div>` : ''}
        </div>
      `;
      wrap.appendChild(alightRow);
    }
  });

  // ── Final destination marker ─────────────────────────────────────────────
  const dest = document.createElement('div');
  dest.style.cssText = 'display:flex; gap:10px; align-items:flex-start;';
  dest.innerHTML = `
    <div style="width:18px; height:18px; border-radius:50%;
                background:#ef4444; border:2px solid #f87171;
                display:flex; align-items:center; justify-content:center;
                font-size:10px; flex-shrink:0;">📍</div>
    <div style="flex:1; padding-top:1px; color:#f87171; font-weight:600; font-size:11px;">
      Destination — ${leg.end_address || ''}
    </div>
  `;
  wrap.appendChild(dest);

  return wrap;
}

/** Format seconds → "X min" or "X hr Y min" */
function _fmtDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}
// ─── END DIRECTIONS PANEL ─────────────────────────────────────────────────────
function setupManualLocationSearch() {
  const addressInput = document.getElementById('manual-address-input');
  const startBtn     = document.getElementById('start-search-btn');
  const gpsBtn       = document.getElementById('use-device-gps-btn');
  const clearBtn     = document.getElementById('clearLocationBtn');

  if (!addressInput) return;

  // ── Shared helper: apply a resolved location ──────────────────────────────
  function applyLocation(lat, lng, labelText) {
    // End active tour when a new address is entered
    if (activeTourDefinition) {
      activeFilters.tour = null;
      activeTourDefinition = null;
      activeTourCursor = 0;
      activeTourOrderedStops = [];
      if (activeTourPolyline) {
        activeTourPolyline.setMap(null);
        activeTourPolyline = null;
      }
      tourMarkers.forEach(m => m.setMap(null));
      tourMarkers = [];
      if (directionsPanel) {
        directionsPanel.remove();
        directionsPanel = null;
      }
      routeRenderers.forEach(r => r.setMap(null));
      routeRenderers = [];
    }
    
    userLocation = { lat, lng };
    addressInput.value = labelText;
    addressInput.style.borderColor = '#22c55e'; // green = confirmed
    setUserLocationMarker(userLocation, 50);
    
    // Let applyFilters handle the logic of finding nearest and updating markers
    applyFilters();

    if (clearBtn) clearBtn.disabled = false;
  }

  // ── Geocode a free-text address string using the Geocoder API ─────────────
  function geocodeAddress(query) {
    if (!query.trim()) return;
    addressInput.disabled = true;
    addressInput.style.borderColor = 'rgba(148,163,184,0.35)';
    addressInput.value = 'Looking up address…';

    const gc = geocoder || new google.maps.Geocoder();
    gc.geocode(
      { address: query + ', New York, NY', region: 'us' },
      (results, status) => {
        addressInput.disabled = false;
        if (status === 'OK' && results[0]) {
          const loc  = results[0].geometry.location;
          const label = results[0].formatted_address;
          applyLocation(loc.lat(), loc.lng(), label);
        } else {
          // Geocoding failed — restore original text and show error
          addressInput.value = query;
          addressInput.style.borderColor = '#ef4444'; // red = not found
          const nearestResults = document.getElementById('nearestResults');
          if (nearestResults) {
            nearestResults.classList.remove('empty');
            nearestResults.innerHTML = `<p style="color:#fca5a5; font-size:12px; margin:0;">
              Address not found. Try a more specific address or zip code.
            </p>`;
          }
          setTimeout(() => {
            addressInput.style.borderColor = 'rgba(148,163,184,0.35)';
          }, 3000);
        }
      }
    );
  }

  // ── Google Places Autocomplete (primary path) ─────────────────────────────
  const autocomplete = new google.maps.places.Autocomplete(addressInput, {
    bounds: map ? map.getBounds() : undefined,
    fields: ['geometry', 'formatted_address'],
    componentRestrictions: { country: 'us' }
  });

  // Bias autocomplete results towards NYC
  if (map) {
    autocomplete.bindTo('bounds', map);
  }

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (place.geometry?.location) {
      // Autocomplete returned full geometry — use it directly
      applyLocation(
        place.geometry.location.lat(),
        place.geometry.location.lng(),
        place.formatted_address || addressInput.value
      );
    } else {
      // Places API blocked or user picked a text-only suggestion —
      // fall back to geocoding whatever text is in the input
      geocodeAddress(addressInput.value);
    }
  });

  // ── Start button handler ──────────────────────────────────────────────────
  startBtn?.addEventListener('click', () => {
    if (addressInput.value && addressInput.value !== 'Looking up address…') {
      geocodeAddress(addressInput.value);
    }
  });

  // ── Enter key fallback (user typed without selecting a suggestion) ─────────
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Small delay so autocomplete has a chance to fire place_changed first
      setTimeout(() => {
        // Only geocode if userLocation wasn't already set by place_changed
        if (addressInput.value && addressInput.value !== 'Looking up address…') {
          geocodeAddress(addressInput.value);
        }
      }, 150);
    }
  });

  // Reset border color when user starts typing again
  addressInput.addEventListener('input', () => {
    addressInput.style.borderColor = 'rgba(148,163,184,0.35)';
  });

  // ── GPS button ──────────────────────────────────────────────────────────
  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        renderNearestList([], "Geolocation is not supported in this browser.");
        return;
      }
      gpsBtn.textContent = "Locating…";
      gpsBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          applyLocation(
            position.coords.latitude,
            position.coords.longitude,
            "Current Location"
          );
          gpsBtn.textContent = "Use Device GPS";
          gpsBtn.disabled = false;
        },
        () => {
          renderNearestList([], "Location access denied. Type your address instead.");
          gpsBtn.textContent = "Use Device GPS";
          gpsBtn.disabled = false;
        }
      );
    });
  }

  // ── Clear button ────────────────────────────────────────────────────────
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.addEventListener('click', () => {
      // End active tour when address is cleared
      if (activeTourDefinition) {
        activeFilters.tour = null;
        activeTourDefinition = null;
        activeTourCursor = 0;
        activeTourOrderedStops = [];
        if (activeTourPolyline) {
          activeTourPolyline.setMap(null);
          activeTourPolyline = null;
        }
        tourMarkers.forEach(m => m.setMap(null));
        tourMarkers = [];
        if (directionsPanel) {
          directionsPanel.remove();
          directionsPanel = null;
        }
        routeRenderers.forEach(r => r.setMap(null));
        routeRenderers = [];
      }
      
      addressInput.value = "";
      addressInput.style.borderColor = 'rgba(148,163,184,0.35)';
      clearSearchConnections();
      clearUserLocation();
      clearBtn.disabled = true;
      const nearestResults = document.getElementById('nearestResults');
      if (nearestResults) {
        nearestResults.innerHTML = '';
        nearestResults.classList.add('empty');
      }
    });
  }
}

function setupThemeToggle() {
  const toggleBtn = document.getElementById('themeToggle');
  const toggleText = document.getElementById('themeToggleText');
  if (!toggleBtn || !toggleText) return;

  // Set initial label
  const isInitiallyLight = document.documentElement.classList.contains('light-mode');
  toggleText.textContent = isInitiallyLight ? "Dark Mode" : "Light Mode";

  toggleBtn.addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    toggleText.textContent = isLight ? "Dark Mode" : "Light Mode";
    
    // Update map style if map is initialized (moved here to ensure it runs after theme change)
    if (map) map.setOptions({ backgroundColor: isLight ? '#f8fafc' : '#000000' });
  });
}

function setupNarratorToggle() {
  const toggle = document.getElementById('enableNarrator');
  if (!toggle) return;

  toggle.checked = narratorEnabled;
  toggle.addEventListener('change', (event) => {
    narratorEnabled = event.target.checked;
    localStorage.setItem('enableNarrator', narratorEnabled);
    if (!narratorEnabled && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  });
}

function speakNarration(text) {
  if (!narratorEnabled || !text || typeof window.speechSynthesis === 'undefined') return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

/** Toggles the standard Google Maps navigation UI */
function setupMapControlsToggle() {
  const toggle = document.getElementById('toggleMapUI');
  if (!toggle) return;
  toggle.addEventListener('change', (e) => {
    map.setOptions({ disableDefaultUI: !e.target.checked });
  });
}

/** NEW: Toggles the visibility of the advanced search and filter section. */
function setupSearchFiltersToggle() {
  const toggleBtn = document.getElementById("toggleSearchFiltersBtn");
  const filtersContainer = document.getElementById("searchFiltersContainer");
  const toggleIcon = document.getElementById("toggleSearchFiltersIcon");

  if (!toggleBtn || !filtersContainer || !toggleIcon) return;

  toggleBtn.addEventListener("click", () => {
    if (filtersContainer.style.display === "none") {
      filtersContainer.style.display = "flex";
      toggleIcon.textContent = "−";
    } else {
      filtersContainer.style.display = "none";
      toggleIcon.textContent = "+";
    }
  });
}

/** NEW: Toggles the visibility of the curated tours section. */
function setupCreateCustomTourButton() {
  const topBtn = document.getElementById("createCustomTourBtn");
  if (!topBtn) {
    console.warn("createCustomTourBtn element not found");
    return;
  }

  console.log("Setting up createCustomTourBtn handler");

  // Remove any existing listeners to avoid duplicates
  topBtn.replaceWith(topBtn.cloneNode(true));
  const freshBtn = document.getElementById("createCustomTourBtn");
  
  if (!freshBtn) return;

  freshBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log("Create Local Tour button clicked, userLocation:", userLocation);
    
    if (!userLocation) {
      alert("Please set your location first using the search bar or GPS button.");
      return;
    }

    const customTourId = `${CURATED_TOUR_PREFIX}custom-near-me`;
    const isCustomActive = activeFilters.tour === customTourId;

    if (isCustomActive) {
      // End tour
      console.log("Ending custom tour");
      activeFilters.tour = null;
      activeTourDefinition = null;
      activeTourCursor = 0;
      activeTourOrderedStops = [];
      if (activeTourPolyline) {
        activeTourPolyline.setMap(null);
        activeTourPolyline = null;
      }
      tourMarkers.forEach(m => m.setMap(null));
      tourMarkers = [];
      applyFilters();
      renderTourCards();
    } else {
      // Create custom tour
      console.log("Creating custom tour");
      createCustomTourNearMe();
    }
  });
}

function setupCuratedToursToggle() {
  const toggleBtn = document.getElementById("toggleCuratedToursBtn");
  const toursContainer = document.getElementById("curatedToursContainer");
  const toggleIcon = document.getElementById("toggleCuratedToursIcon");

  if (!toggleBtn || !toursContainer || !toggleIcon) return;

  toggleBtn.addEventListener("click", () => {
    if (toursContainer.style.display === "none") {
      toursContainer.style.display = "flex";
      toggleIcon.textContent = "−";
    } else {
      toursContainer.style.display = "none";
      toggleIcon.textContent = "+";
    }
  });
}

// Expose to global so Google Maps callback can find it
window.initMap = initMap;

// Ensure layout controls are initialized early for button visibility
// This runs immediately when the script loads, before Google Maps API loads
// This should be the final block in your file
(function() {
  const start = () => {
    if (typeof initLayoutControls === 'function') initLayoutControls();
    if (typeof setupThemeToggle === 'function') setupThemeToggle();
    if (typeof setupNarratorToggle === 'function') setupNarratorToggle();
    if (typeof setupMapControlsToggle === 'function') setupMapControlsToggle();
    if (typeof setupSearchFiltersToggle === 'function') setupSearchFiltersToggle(); // Existing toggle
    if (typeof setupCuratedToursToggle === 'function') setupCuratedToursToggle();   // New toggle
    if (typeof setupCreateCustomTourButton === 'function') setupCreateCustomTourButton(); // Tour creation button
    
    // Initialize range sliders immediately so fills are rendered on load
    if (typeof setupMuralView === 'function') setupMuralView();
    if (typeof setupCustomTourRadiusControl === 'function') setupCustomTourRadiusControl();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();