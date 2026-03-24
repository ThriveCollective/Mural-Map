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
  tour: null,
  muralView: 100 // Percentage of murals to show (25, 50, 75, 100)
};
let userLocation = null;
let userLocationMarker = null;
let userAccuracyCircle = null;
let curatedTours = [];
let curatedTourStops = new Map();
let activeTourPolyline = null;
let modalData = { schools: [], boroughs: [], tours: [] };
let modalListenersBound = false;
let directionsService = null;
let directionsRenderer = null;
let activeDirections = null;
let tourStopNumbers = new Map(); // Maps mural UID to stop number for active tour
let tourMarkers = []; // Separate array for numbered tour markers (not clustered)

// Convenience access to config with fallbacks
const CONFIG = window.MURAL_MAP_CONFIG || {};
const CSV_URL = CONFIG.CSV_URL || "";
const DEFAULT_CENTER = CONFIG.DEFAULT_CENTER || { lat: 40.7128, lng: -74.006 };
const DEFAULT_ZOOM = CONFIG.DEFAULT_ZOOM || 11;
const TOUR_DEFINITIONS = Array.isArray(window.MURAL_TOURS) ? window.MURAL_TOURS : [];
const CURATED_TOUR_PREFIX = "curated:";
const DATA_TOUR_PREFIX = "data:";
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
};
const NEAREST_DEFAULT_MESSAGE =
  "Tap “Find murals near me” to surface the closest murals and walking directions.";

// Dark theme for Google Maps
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#757575" }]
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9e9e9e" }]
  },
  {
    featureType: "administrative.land_parcel",
    stylers: [{ visibility: "off" }]
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#bdbdbd" }]
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }]
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#181818" }]
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }]
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1b1b1b" }]
  },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#2c2c2c" }]
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8a8a" }]
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#373737" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3c3c3c" }]
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry",
    stylers: [{ color: "#4e4e4e" }]
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }]
  },
  {
    featureType: "transit",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }]
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#000000" }]
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3d3d3d" }]
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
  const feet = meters * 3.28084; // Convert meters to feet
  if (feet >= 5280) {
    const miles = feet / 5280;
    return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
  }
  return `${Math.round(feet)} ft`;
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
    
    curatedTours.push({ ...definition, stops: uniqueStops });
    curatedTourStops.set(definition.id, {
      definition,
      stops: uniqueStops, // For polyline - unique locations only
      allMurals: allMatching, // For filtering - all matching murals
      uidSet: new Set(allMatching.map(m => m.uid)) // For filtering
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

  if (!curatedTours.length) {
    const note = document.createElement("p");
    note.className = "tours-panel-subtitle";
    note.textContent = "Add tour definitions in js/config.js to surface curated walking routes.";
    container.appendChild(note);
    return;
  }

  curatedTours.forEach(tour => {
    const card = document.createElement("article");
    card.className = "tour-card";

    const chipBg = tour.color || "rgba(59, 130, 246, 0.2)";
    const chipBorder = tour.color || "rgba(59, 130, 246, 0.4)";

    card.innerHTML = `
      <div class="tour-card-head">
        <h3>${tour.name}</h3>
        <span class="tour-chip" style="background:${chipBg}; border:1px solid ${chipBorder};">
          ${tour.stops.length || 0} stops
        </span>
      </div>
      <p>${tour.description || "Add a description in js/config.js"}</p>
      <footer>
        <span class="tour-card-meta">${tour.borough || "Multi-borough"}</span>
        <button type="button" data-tour-id="${tour.id}">Start tour</button>
      </footer>
    `;

    const btn = card.querySelector("button");
    btn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const prefixedId = `${CURATED_TOUR_PREFIX}${tour.id}`;
      activeFilters.tour = activeFilters.tour === prefixedId ? null : prefixedId;
      applyFilters();
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

  // Clear any existing directions when starting a tour
  clearDirections();

  // Clear stop numbers if no tour is active
  if (!map || !activeFilters.tour || !activeFilters.tour.startsWith(CURATED_TOUR_PREFIX)) {
    tourStopNumbers.clear();
    // Update markers to remove numbers
    if (currentVisibleMurals.length > 0) {
      createMarkers(currentVisibleMurals);
    }
    return;
  }

  const tourId = activeFilters.tour.replace(CURATED_TOUR_PREFIX, "");
  const entry = curatedTourStops.get(tourId);
  if (!entry || entry.stops.length < 2) {
    return;
  }

  if (!directionsService || !directionsRenderer) {
    // Fallback to simple polyline if Directions Service not available
    const orderedStops = orderStopsForTour(entry.stops);
    const path = orderedStops.map(stop => ({ lat: stop.lat, lng: stop.lng }));
    const color = entry.definition.color || "#3b82f6";
    activeTourPolyline = new google.maps.Polyline({
      map,
      path,
      strokeColor: color,
      strokeOpacity: 0.9,
      strokeWeight: 3
    });
    return;
  }

  const color = entry.definition.color || "#3b82f6";
  
  // Order stops logically using nearest-neighbor algorithm
  const orderedStops = orderStopsForTour(entry.stops);

  // Store stop numbers for marker numbering
  tourStopNumbers.clear();
  orderedStops.forEach((stop, index) => {
    tourStopNumbers.set(stop.uid, index + 1);
  });

  // Update markers to show numbers
  createMarkers(currentVisibleMurals);

  // Set up the directions renderer with tour styling
  directionsRenderer.setMap(map);
  directionsRenderer.setOptions({
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: color,
      strokeWeight: 5,
      strokeOpacity: 0.8
    },
    markerOptions: {
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2
      }
    }
  });

  // Create waypoints for all stops except the first and last
  const waypoints = orderedStops.slice(1, -1).map(stop => ({
    location: new google.maps.LatLng(stop.lat, stop.lng),
    stopover: true
  }));

  // Origin is first stop, destination is last stop
  const origin = new google.maps.LatLng(orderedStops[0].lat, orderedStops[0].lng);
  const destination = new google.maps.LatLng(
    orderedStops[orderedStops.length - 1].lat,
    orderedStops[orderedStops.length - 1].lng
  );

  // Request directions with waypoints
  // Use optimizeWaypoints: true to let Google optimize the route order
  directionsService.route(
    {
      origin: origin,
      destination: destination,
      waypoints: waypoints,
      travelMode: google.maps.TravelMode.WALKING,
      unitSystem: google.maps.UnitSystem.IMPERIAL,
      optimizeWaypoints: false // Keep stops in numbered order
    },
    (result, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(result);
        
        // Fit map to show the entire route
        const bounds = new google.maps.LatLngBounds();
        result.routes[0].legs.forEach(leg => {
          bounds.extend(leg.start_location);
          bounds.extend(leg.end_location);
        });
        map.fitBounds(bounds, { padding: 80 });
      } else {
        console.error("Tour directions request failed:", status);
        // Fallback to simple polyline with ordered stops
        const path = orderedStops.map(stop => ({ lat: stop.lat, lng: stop.lng }));
        activeTourPolyline = new google.maps.Polyline({
          map,
          path,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 3
        });
      }
    }
  );
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
  for (const name of possibleNames) {
    const idx = headerRow.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
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
    const idxLat = getColumnIndex(header, ["lat", "latitude"]);
    const idxLng = getColumnIndex(header, ["lng", "lon", "long", "longitude"]);
    const idxBorough = getColumnIndex(header, ["borough"]);
    const idxYear = getColumnIndex(header, ["year"]);
    const idxSchool = getColumnIndex(header, ["school_name", "school"]);
    const idxDetailUrl = getColumnIndex(header, ["detail_url", "url", "project_url"]);
    const idxImageUrl = getColumnIndex(header, ["image_url", "image_urls", "thumbnail_url"]);
    const idxArtistNames = getColumnIndex(header, ["artist_names", "artists"]);
    const idxTheme = getColumnIndex(header, ["theme", "tags"]);
    const idxTourId = getColumnIndex(header, ["tour_id", "tour"]);
    const idxStudents = getColumnIndex(header, ["students_involved", "students"]);

    if (idxName === -1) {
      throw new Error("Could not find name column. Expected one of: mural_title, mural_name, name, title");
    }
    if (idxLat === -1) {
      throw new Error("Could not find latitude column. Expected one of: lat, latitude");
    }
    if (idxLng === -1) {
      throw new Error("Could not find longitude column. Expected one of: lng, lon, long, longitude");
    }

    return dataRows
      .map(row => {
        const val = index => (index >= 0 && index < row.length ? row[index].trim() : "");

        const latStr = val(idxLat);
        const lngStr = val(idxLng);
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        const nameValue = val(idxName);
        const uid = `${nameValue}-${lat}-${lng}`;

        return {
          uid,
          name: nameValue,
          lat: !Number.isNaN(lat) ? lat : null,
          lng: !Number.isNaN(lng) ? lng : null,
          borough: val(idxBorough),
          year: val(idxYear),
          school: val(idxSchool),
          detail_url: val(idxDetailUrl),
          image_url: val(idxImageUrl),
          artist_names: val(idxArtistNames),
          theme: val(idxTheme),
          tour_id: val(idxTourId),
          students_involved: val(idxStudents)
        };
      })
      .filter(m => {
        if (!m.name || m.lat === null || m.lng === null) {
          return false;
        }
        return true;
      });
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('CORS') || err.name === 'TypeError') {
      throw new Error('CORS error: Please run this app from a local web server, not by opening the HTML file directly. See README.md for instructions.');
    }
    throw err;
  }
}

// Create a numbered marker icon for tour stops
function createNumberedMarkerIcon(number, color = "#3b82f6") {
  const svg = `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="18" r="16" fill="${color}" stroke="#ffffff" stroke-width="3"/>
      <text x="18" y="18" text-anchor="middle" dominant-baseline="central" 
            fill="#ffffff" font-size="16" font-weight="bold" font-family="Arial, sans-serif">
        ${number}
      </text>
    </svg>
  `;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(36, 36),
    anchor: new google.maps.Point(18, 18)
  };
}

function createMarkers(murals) {
  // Clear existing markers
  markers.forEach(marker => marker.setMap(null));
  markers = [];
  
  // Clear existing tour markers
  tourMarkers.forEach(marker => marker.setMap(null));
  tourMarkers = [];
  
  if (clusterer) {
    clusterer.clearMarkers();
  }

  // Check if a curated tour is active
  const isTourActive = activeFilters.tour && activeFilters.tour.startsWith(CURATED_TOUR_PREFIX);
  
  // Get tour color if a tour is active
  let tourColor = "#3b82f6";
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
        const icon = createNumberedMarkerIcon(stopNumber, tourColor);

        const marker = new google.maps.Marker({
          position: { lat: mural.lat, lng: mural.lng },
          map: map, // Add directly to map, bypassing clusterer
          title: mural.name,
          icon: icon,
          zIndex: google.maps.Marker.MAX_ZINDEX + 1000
        });

        marker.mural = mural;

        marker.addListener("click", () => {
          showMuralPopup(marker);
        });

        tourMarkers.push(marker);
      }
    });
    // Don't create clusterer when tour is active - only show tour markers
    return;
  }

  // Regular view: separate tour markers from regular markers
  const regularMurals = [];
  const tourMurals = [];

  murals.forEach(mural => {
    const stopNumber = tourStopNumbers.get(mural.uid);
    if (stopNumber !== undefined) {
      tourMurals.push({ mural, stopNumber });
    } else {
      regularMurals.push(mural);
    }
  });

  // Create regular markers (will be clustered)
  regularMurals.forEach(mural => {
    const icon = {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="12" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>
          <circle cx="16" cy="16" r="6" fill="#ffffff"/>
        </svg>
      `),
      scaledSize: new google.maps.Size(32, 32),
      anchor: new google.maps.Point(16, 16)
    };

    const marker = new google.maps.Marker({
      position: { lat: mural.lat, lng: mural.lng },
      map: null, // Don't add to map directly, let clusterer handle it
      title: mural.name,
      icon: icon
    });

    marker.mural = mural;

    marker.addListener("click", () => {
      showMuralPopup(marker);
    });

    markers.push(marker);
  });

  // Create numbered tour markers (added directly to map, not clustered)
  tourMurals.forEach(({ mural, stopNumber }) => {
    const icon = createNumberedMarkerIcon(stopNumber, tourColor);

    const marker = new google.maps.Marker({
      position: { lat: mural.lat, lng: mural.lng },
      map: map, // Add directly to map, bypassing clusterer
      title: mural.name,
      icon: icon,
      zIndex: google.maps.Marker.MAX_ZINDEX + 1000 // High z-index to appear above clusters
    });

    marker.mural = mural;

    marker.addListener("click", () => {
      showMuralPopup(marker);
    });

    tourMarkers.push(marker);
  });

  // Update clusterer with only regular markers
  updateClusterer();
}

// Create custom renderer for blue clusters
function createClusterRenderer() {
  return {
    render: ({ count, position }) => {
      // Create a blue cluster icon
      const svg = `
        <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="18" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>
          <text x="20" y="20" text-anchor="middle" dominant-baseline="central" 
                fill="#ffffff" font-size="14" font-weight="bold" font-family="Arial, sans-serif">
            ${count}
          </text>
        </svg>
      `;
      
      return new google.maps.Marker({
        position,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(40, 40),
          anchor: new google.maps.Point(20, 20)
        },
        zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count
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
  // Use a debounce to avoid recreating too frequently during zoom
  // Store timeout so we can clear it if needed
  let zoomTimeout;
  let lastZoom = map ? map.getZoom() : null;
  
  function onZoomChanged() {
    // Only update clustering, don't interfere with zoom
    if (!map) return;
    
    const currentZoom = map.getZoom();
    
    // Don't update clustering if 25% view is active (it should stay at 5 clusters)
    if (activeFilters.muralView === 25) {
      lastZoom = currentZoom;
      return; // Keep the 5-cluster view regardless of zoom
    }
    
    // Only update if zoom actually changed (not just a programmatic change)
    if (currentZoom === lastZoom) return;
    lastZoom = currentZoom;
    
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => {
      if (clusterer && markers.length > 0 && map) {
        clusterer.clearMarkers();
        const algorithm = createAlgorithm();
        if (typeof markerClusterer !== 'undefined' && markerClusterer.MarkerClusterer) {
          clusterer = new markerClusterer.MarkerClusterer({ 
            map, 
            markers,
            algorithm: algorithm,
            renderer: renderer
          });
        } else if (window.markerClusterer && window.markerClusterer.MarkerClusterer) {
          clusterer = new window.markerClusterer.MarkerClusterer({ 
            map, 
            markers,
            algorithm: algorithm,
            renderer: renderer
          });
        }
      }
    }, 200); // Debounce zoom changes
  }
  
  // Listen for zoom changes to update clustering (but don't prevent zoom)
  if (map) {
    google.maps.event.clearListeners(map, 'zoom_changed');
    google.maps.event.addListener(map, 'zoom_changed', onZoomChanged);
  }
  
  // Initial clusterer creation
  if (typeof markerClusterer !== 'undefined' && markerClusterer.MarkerClusterer) {
    // Always recreate clusterer to ensure renderer is applied
    if (clusterer) {
      clusterer.clearMarkers();
    }
    const algorithm = createAlgorithm();
    clusterer = new markerClusterer.MarkerClusterer({ 
      map, 
      markers,
      algorithm: algorithm,
      renderer: renderer
    });
  } else if (window.markerClusterer && window.markerClusterer.MarkerClusterer) {
    // Always recreate clusterer to ensure renderer is applied
    if (clusterer) {
      clusterer.clearMarkers();
    }
    const algorithm = createAlgorithm();
    clusterer = new window.markerClusterer.MarkerClusterer({ 
      map, 
      markers,
      algorithm: algorithm,
      renderer: renderer
    });
  } else {
    // Fallback if clusterer library not loaded - add markers directly to map
    markers.forEach(m => m.setMap(map));
  }
}

function showMuralPopup(marker) {
  const m = marker.mural;
  
  // Create unique ID for this popup's carousel
  const popupId = 'popup-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  
  // For now, use single image. If multiple images exist, they can be added to an array
  const images = m.image_url ? [m.image_url] : [];
  let currentImageIndex = 0;
  
  const distanceAway =
    userLocation && m.lat && m.lng
      ? formatDistance(calculateDistanceMeters(userLocation, { lat: m.lat, lng: m.lng }))
      : null;

  const html = `
    <div id="${popupId}" style="width:500px; font-family: system-ui, sans-serif; color: #e5e7eb; background: #374151; padding: 20px; box-sizing: border-box;">
      <!-- Header with Title and Close Button -->
      <div style="position: relative; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #ffffff; text-align: center; padding-right: 30px;">
          ${m.name}${m.year ? ` (${m.year})` : ''}
        </h2>
        <button id="${popupId}-close" 
                style="position: absolute; top: 0; right: 0; background: rgba(255,255,255,0.1); border: none; font-size: 24px; cursor: pointer; color: #9ca3af; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; line-height: 1; border-radius: 4px; transition: all 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.2)'; this.style.color='#ffffff';"
                onmouseout="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#9ca3af';"
                title="Close">
          &times;
        </button>
      </div>
      ${
        distanceAway
          ? `<div style="display:flex; justify-content:center; margin-bottom:12px;">
              <span class="distance-pill" style="background:rgba(59,130,246,0.18); border:1px solid rgba(59,130,246,0.35); color:#dbeafe;">
                ${distanceAway} away
              </span>
            </div>`
          : ""
      }
      
      <!-- Image Carousel -->
      ${images.length > 0 ? `
        <div style="position: relative; margin-bottom: 16px; border-radius: 8px; overflow: hidden; background: #f3f4f6;">
          <div style="position: relative; width: 100%; padding-top: 56.25%; background: #e5e7eb;">
            <img id="${popupId}-img" src="${images[0]}" alt="${m.name}" 
                 style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;">
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
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <!-- Left Column -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Students:</div>
            <div style="color: #e5e7eb; font-size: 14px; font-weight: 500;">${m.students_involved || '—'}</div>
          </div>
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Teaching Artist:</div>
            <div style="color: #e5e7eb; font-size: 14px; font-weight: 500;">${m.artist_names || '—'}</div>
          </div>
        </div>
        
        <!-- Right Column -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">School:</div>
            <div style="color: #e5e7eb; font-size: 14px; font-weight: 500;">${m.school || '—'}</div>
          </div>
          <div>
            <div style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Borough:</div>
            <div style="color: #e5e7eb; font-size: 14px; font-weight: 500;">${m.borough || '—'}</div>
          </div>
        </div>
      </div>
      
      <!-- Mural Description -->
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #ffffff; text-align: center; text-transform: uppercase; letter-spacing: 0.5px;">Mural Description</h3>
        <div style="color: #d1d5db; font-size: 14px; line-height: 1.6;">
          ${m.theme ? m.theme : 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'}
        </div>
      </div>

      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top: 12px;">
        <button id="${popupId}-directions"
          style="flex:1; border:none; border-radius:999px; background:#3b82f6; color:#0f172a; font-weight:600; padding:10px 18px; cursor:pointer;">
          Get directions
        </button>
        <button id="${popupId}-focus"
          style="flex:1; border:1px solid rgba(148,163,184,0.4); border-radius:999px; background:transparent; color:#f3f4f6; font-weight:600; padding:10px 18px; cursor:pointer;">
          Center map here
        </button>
      </div>
    </div>
  `;

  infoWindow.setContent(html);
  infoWindow.open(map, marker);
  
  // Style the info window and set up close button functionality
  setTimeout(() => {
    const iwOuter = document.querySelector('.gm-style-iw-d');
    const iwContainer = document.querySelector('.gm-style-iw-c');
    
    if (iwOuter) {
      iwOuter.style.background = '#374151';
      iwOuter.style.color = '#e5e7eb';
      iwOuter.style.width = '500px';
      iwOuter.style.maxWidth = '500px';
      iwOuter.style.minWidth = '500px';
      iwOuter.style.overflow = 'hidden';
    }
    
    if (iwContainer) {
      iwContainer.style.width = '500px';
      iwContainer.style.maxWidth = '500px';
      iwContainer.style.minWidth = '500px';
      iwContainer.style.overflow = 'hidden';
    }
    
    // Hide Google Maps' default close button since we have our own
    const iwCloseBtn = document.querySelector('.gm-ui-hover-effect');
    if (iwCloseBtn) {
      iwCloseBtn.style.display = 'none';
    }
    
    // Remove any white scrollbar areas
    const scrollElements = document.querySelectorAll('.gm-style-iw-d, .gm-style-iw-c');
    scrollElements.forEach(el => {
      el.style.overflow = 'hidden';
      el.style.overflowY = 'hidden';
      el.style.overflowX = 'hidden';
    });
    
    // Set up our custom close button
    const customCloseBtn = document.getElementById(`${popupId}-close`);
    if (customCloseBtn) {
      customCloseBtn.addEventListener('click', () => {
        infoWindow.close();
      });
    }

    const directionsBtn = document.getElementById(`${popupId}-directions`);
    directionsBtn?.addEventListener("click", () => openDirectionsForMural(m));

    const focusBtn = document.getElementById(`${popupId}-focus`);
    focusBtn?.addEventListener("click", () => {
      map.panTo({ lat: m.lat, lng: m.lng });
      if (map.getZoom() < 15) {
        map.setZoom(15);
      }
    });
  }, 100);
}

function applyFilters() {
  let filtered = allMurals.filter(m => {
    // Search filter
    if (activeFilters.search) {
      const searchLower = activeFilters.search.toLowerCase();
      if (!m.name.toLowerCase().includes(searchLower) &&
          !(m.school && m.school.toLowerCase().includes(searchLower)) &&
          !(m.artist_names && m.artist_names.toLowerCase().includes(searchLower))) {
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
  createMarkers(filtered);
  updateTourPolyline();
  // Note: updateTourPolyline() now handles clearing directions when tours are active
  // Only clear directions if no tour is active
  if (!activeFilters.tour || !activeFilters.tour.startsWith(CURATED_TOUR_PREFIX)) {
    clearDirections();
  }
  
  // Don't auto-fit bounds on filter changes - let users control the map view
  // fitBounds will only be called explicitly (e.g., when clicking a filter button)

  if (userLocation) {
    renderNearestList(findNearestMurals());
  }
}

function populateFilters() {
  const years = new Set();
  const schools = new Set();
  const boroughs = new Set();
  const dataTours = new Set();

  allMurals.forEach(m => {
    if (m.year) years.add(m.year);
    if (m.school) schools.add(m.school);
    if (m.borough) boroughs.add(m.borough);
    if (m.tour_id) dataTours.add(m.tour_id);
  });

  const sortedYears = Array.from(years).sort((a, b) => Number(b) - Number(a));
  const sortedSchools = Array.from(schools).sort();
  const sortedBoroughs = Array.from(boroughs).sort();

  // Populate year filter (circular buttons)
  const yearContainer = document.getElementById("yearFilter");
  if (yearContainer) {
    yearContainer.innerHTML = "";
    yearContainer.classList.add("year-filter");
    sortedYears.forEach(year => {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.textContent = year;
      btn.dataset.value = year;
      if (activeFilters.year === year) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeFilters.year === year) {
          activeFilters.year = null;
          btn.classList.remove("active");
        } else {
          yearContainer.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
          activeFilters.year = year;
          btn.classList.add("active");
        }
        applyFilters();
      });
      yearContainer.appendChild(btn);
    });
  }

  // Populate schools filter
  const schoolsContainer = document.getElementById("schoolsFilter");
  if (schoolsContainer) {
    schoolsContainer.innerHTML = "";
    sortedSchools.forEach(school => {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.textContent = school;
      btn.dataset.value = school;
      if (activeFilters.school === school) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeFilters.school === school) {
          activeFilters.school = null;
          btn.classList.remove("active");
        } else {
          schoolsContainer.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
          activeFilters.school = school;
          btn.classList.add("active");
        }
        applyFilters();
      });
      schoolsContainer.appendChild(btn);
    });
  }

  // Populate borough filter
  const boroughContainer = document.getElementById("boroughFilter");
  if (boroughContainer) {
    boroughContainer.innerHTML = "";
    sortedBoroughs.forEach(borough => {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.textContent = borough;
      btn.dataset.value = borough;
      if (activeFilters.borough === borough) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeFilters.borough === borough) {
          activeFilters.borough = null;
          btn.classList.remove("active");
        } else {
          boroughContainer.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
          activeFilters.borough = borough;
          btn.classList.add("active");
        }
        applyFilters();
      });
      boroughContainer.appendChild(btn);
    });
  }

  // Populate tours filter (curated + data-driven)
  const toursContainer = document.getElementById("toursFilter");
  if (toursContainer) {
    toursContainer.innerHTML = "";
    const curatedButtons = curatedTours
      .map(tour => ({
        id: `${CURATED_TOUR_PREFIX}${tour.id}`,
        label: tour.name,
        count: tour.stops.length,
        type: "curated"
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const dataButtons = Array.from(dataTours)
      .filter(Boolean)
      .sort()
      .map(id => ({
        id: `${DATA_TOUR_PREFIX}${id}`,
        label: `Tour ${id}`,
        type: "data"
      }));

    const allTourButtons = [...curatedButtons, ...dataButtons];

    allTourButtons.forEach(tour => {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.textContent = tour.label;
      btn.dataset.value = tour.id;
      if (activeFilters.tour === tour.id) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeFilters.tour === tour.id) {
          activeFilters.tour = null;
          btn.classList.remove("active");
        } else {
          toursContainer.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
          activeFilters.tour = tour.id;
          btn.classList.add("active");
        }
        applyFilters();
      });
      toursContainer.appendChild(btn);
    });
  }

  // Setup "View All" modals
  setupViewAllModals({
    schools: sortedSchools,
    boroughs: sortedBoroughs,
    tours: [
      ...curatedTours
        .map(t => ({ id: `${CURATED_TOUR_PREFIX}${t.id}`, label: t.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...Array.from(dataTours)
        .filter(Boolean)
        .sort()
        .map(id => ({ id: `${DATA_TOUR_PREFIX}${id}`, label: `Tour ${id}` }))
    ]
  });
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
  const container = document.getElementById("muralViewFilter");
  if (!container) return;

  const buttons = container.querySelectorAll(".filter-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const value = parseInt(btn.dataset.value);
      
      // Remove active from all buttons
      buttons.forEach(b => b.classList.remove("active"));
      
      // Set active on clicked button
      btn.classList.add("active");
      
      // Update filter
      activeFilters.muralView = value;
      applyFilters();
    });
  });
}

function initLayoutControls() {
  const hideBtn = document.getElementById("sidebarHideBtn");
  const showTab = document.getElementById("sidebarShowTab");
  const sidebar = document.getElementById("sidebar");
  const body = document.body;
  const mq = window.matchMedia("(max-width: 768px)");

  function updateSidebarVisibility(isVisible) {
    if (isVisible) {
      sidebar?.classList.remove("hidden");
      showTab?.classList.add("hidden");
      showTab?.setAttribute("aria-expanded", "true");
    } else {
      sidebar?.classList.add("hidden");
      showTab?.classList.remove("hidden");
      showTab?.setAttribute("aria-expanded", "false");
    }
  }

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
  const locateBtn = document.getElementById("locateMeBtn");
  const clearBtn = document.getElementById("clearLocationBtn");

  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.addEventListener("click", clearUserLocation);
  }

  locateBtn?.addEventListener("click", () => requestUserLocation());
}

function setLocateButtonState(isLoading) {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.disabled = isLoading;
  locateBtn.textContent = isLoading ? "Locating…" : "Find murals near me";
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
  const nearest = findNearestMurals();
  renderNearestList(nearest);

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

  if (!userLocationMarker) {
    userLocationMarker = new google.maps.Marker({
      map,
      zIndex: google.maps.Marker.MAX_ZINDEX + 1,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#60a5fa",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2
      }
    });
  }

  userLocationMarker.setPosition(position);
  userLocationMarker.setMap(map);

  if (userAccuracyCircle) {
    userAccuracyCircle.setMap(null);
  }

  userAccuracyCircle = new google.maps.Circle({
    map,
    center: position,
    radius: Math.max(accuracyMeters, 30),
    fillColor: "#60a5fa",
    fillOpacity: 0.1,
    strokeColor: "#60a5fa",
    strokeOpacity: 0.4,
    strokeWeight: 1
  });

  map.panTo(position);
  if (map.getZoom() < 14) {
    map.setZoom(14);
  }
}

function clearUserLocation() {
  userLocation = null;
  if (userLocationMarker) {
    userLocationMarker.setMap(null);
    userLocationMarker = null;
  }
  if (userAccuracyCircle) {
    userAccuracyCircle.setMap(null);
    userAccuracyCircle = null;
  }
  const clearBtn = document.getElementById("clearLocationBtn");
  if (clearBtn) {
    clearBtn.disabled = true;
  }
  // Clear directions since they depend on user location
  clearDirections();
  renderNearestList();
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

function renderNearestList(results = null, customMessage = "") {
  const container = document.getElementById("nearestResults");
  if (!container) return;

  container.innerHTML = "";

  if (customMessage) {
    container.classList.remove("empty");
    const message = document.createElement("p");
    message.textContent = customMessage;
    container.appendChild(message);
    return;
  }

  if (!results || !results.length) {
    container.classList.add("empty");
    const placeholder = document.createElement("p");
    placeholder.textContent = NEAREST_DEFAULT_MESSAGE;
    container.appendChild(placeholder);
    return;
  }

  container.classList.remove("empty");

  results.forEach(mural => {
    const card = document.createElement("article");
    card.className = "nearest-card";

    const distance = formatDistance(mural.distance);
    card.innerHTML = `
      <header>
        <h3>${mural.name}</h3>
        <span class="distance-pill">${distance}</span>
      </header>
      <p>${mural.school || mural.borough || ""}</p>
      <footer>
        <button type="button" data-action="view">View on map</button>
        <button type="button" data-action="directions">Get directions</button>
      </footer>
    `;

    card.querySelector("[data-action='view']")?.addEventListener("click", () => {
      focusOnMuralByUid(mural.uid);
      if (window.matchMedia("(max-width: 768px)").matches) {
        document.body.classList.remove("sidebar-open");
      }
    });

    card.querySelector("[data-action='directions']")?.addEventListener("click", () => {
      openDirectionsForMural(mural);
    });

    container.appendChild(card);
  });
}

function focusOnMuralByUid(uid) {
  const marker = markers.find(m => m.mural.uid === uid);
  if (marker) {
    map.panTo(marker.getPosition());
    if (map.getZoom() < 15) {
      map.setZoom(15);
    }
    google.maps.event.trigger(marker, "click");
  }
}

function clearDirections() {
  if (directionsRenderer) {
    directionsRenderer.setDirections({ routes: [] });
    directionsRenderer.setMap(null);
  }
  activeDirections = null;
}

function openDirectionsForMural(mural) {
  if (!directionsService || !directionsRenderer) {
    // Fallback to opening Google Maps in new tab if Directions Service not available
    const params = new URLSearchParams({
      destination: `${mural.lat},${mural.lng}`,
      travelmode: "walking"
    });
    if (userLocation) {
      params.set("origin", `${userLocation.lat},${userLocation.lng}`);
    }
    window.open(`https://www.google.com/maps/dir/?api=1&${params.toString()}`, "_blank", "noopener");
    return;
  }

  const destination = new google.maps.LatLng(mural.lat, mural.lng);
  let origin = null;

  // Use user location if available, otherwise use map center
  if (userLocation) {
    origin = new google.maps.LatLng(userLocation.lat, userLocation.lng);
  } else {
    origin = map.getCenter();
  }

  // Clear any existing directions
  clearDirections();

  // Set up the directions renderer on the map
  directionsRenderer.setMap(map);

  // Request directions
  directionsService.route(
    {
      origin: origin,
      destination: destination,
      travelMode: google.maps.TravelMode.WALKING,
      unitSystem: google.maps.UnitSystem.IMPERIAL
    },
    (result, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(result);
        activeDirections = {
          origin: origin,
          destination: destination,
          mural: mural
        };
        
        // Fit map to show the entire route
        const bounds = new google.maps.LatLngBounds();
        result.routes[0].legs.forEach(leg => {
          bounds.extend(leg.start_location);
          bounds.extend(leg.end_location);
        });
        map.fitBounds(bounds, { padding: 80 });
      } else {
        console.error("Directions request failed:", status);
        // Fallback to opening Google Maps in new tab
        const params = new URLSearchParams({
          destination: `${mural.lat},${mural.lng}`,
          travelmode: "walking"
        });
        if (userLocation) {
          params.set("origin", `${userLocation.lat},${userLocation.lng}`);
        }
        window.open(`https://www.google.com/maps/dir/?api=1&${params.toString()}`, "_blank", "noopener");
      }
    }
  );
}

// Called by Google Maps JS API via callback parameter in index.html
async function initMap() {
  try {
    // Layout controls should already be initialized, but ensure they are
    if (typeof initLayoutControls === 'function') {
      try {
        initLayoutControls();
      } catch (e) {
        console.error('Error re-initializing layout controls:', e);
      }
    }
    setupNearestControls();
    showError(false);
    showLoading(true);

    map = new google.maps.Map(document.getElementById("map"), {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      styles: DARK_MAP_STYLE,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      scaleControl: true,
      streetViewControl: false,
      rotateControl: false,
      fullscreenControl: true
    });

    infoWindow = new google.maps.InfoWindow({
      maxWidth: 500
    });

    // Initialize Directions Service and Renderer
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
      map: null, // Will be set when directions are requested
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: "#3b82f6",
        strokeWeight: 5,
        strokeOpacity: 0.8
      },
      markerOptions: {
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2
        }
      }
    });

    const murals = await loadMuralsFromSheet();
    console.log(`Loaded ${murals.length} murals from CSV`);
    allMurals = murals;
    buildCuratedTours();

    if (murals.length === 0) {
      throw new Error("No murals found in CSV. Check that the CSV has valid data with 'mural_title', 'lat', and 'lng' columns.");
    }

    createMarkers(murals);
    currentVisibleMurals = murals;
    populateFilters();
    setupSearch();
    setupMuralView();

    // Keep default view centered on NYC - don't fit bounds to avoid zooming out to show all markers
    // The map is already initialized with DEFAULT_CENTER and DEFAULT_ZOOM for NYC
  } catch (err) {
    console.error(err);
    const errorMessage = err.message || "There was a problem loading mural data. Check the CSV URL or network connection.";
    showError(true, errorMessage);
  } finally {
    showLoading(false);
  }
}

// Expose to global so Google Maps callback can find it
window.initMap = initMap;

// Ensure layout controls are initialized early for button visibility
// This runs immediately when the script loads, before Google Maps API loads
(function() {
  if (typeof initLayoutControls === 'function') {
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLayoutControls);
      } else {
        initLayoutControls();
      }
    } catch (e) {
      console.error('Error initializing layout controls early:', e);
    }
  }
})();
