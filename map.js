let map;
let markers = [];
let infoWindow;
let allMurals = [];
let clusterer;
let activeFilters = {
  search: "",
  year: null,
  school: null,
  borough: null,
  tour: null,
  muralView: 100 // Percentage of murals to show (100%, 75%, 50%, 25%)
};
let userLocation = null;
let nearestMurals = [];
let activeTourPolyline = null;
let activeTourStopMarkers = [];
let activeTourDirectionsRenderer = null; // For Google Maps Directions routes
let tourRoutesCache = new Map(); // Cache for Directions API responses
let boroughMarkers = []; // For 25% view mode

// Borough centroids for 25% view mode (approximate centers)
const BOROUGH_CENTROIDS = {
  "Manhattan": { lat: 40.7831, lng: -73.9712 },
  "Brooklyn": { lat: 40.6782, lng: -73.9442 },
  "Queens": { lat: 40.7282, lng: -73.7949 },
  "Bronx": { lat: 40.8448, lng: -73.8648 },
  "Staten Island": { lat: 40.5795, lng: -74.1502 }
};

// Color constants
const MARKER_COLOR = "#65c6c7";
const CURATED_TOUR_COLOR = "#c24f02";

// Convenience access to config with fallbacks
const CONFIG = window.MURAL_MAP_CONFIG || {};
const CSV_URL = CONFIG.CSV_URL || "";
const TOURS_CSV_URL = CONFIG.TOURS_CSV_URL || null; // Optional tours CSV URL
const DEFAULT_CENTER = CONFIG.DEFAULT_CENTER || { lat: 40.7128, lng: -74.006 };
const DEFAULT_ZOOM = CONFIG.DEFAULT_ZOOM || 11;

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

      return {
        name: val(idxName),
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

function createMarkers(murals) {
  // Clear existing markers
  markers.forEach(marker => marker.setMap(null));
  markers = [];

  if (clusterer) {
    clusterer.clearMarkers();
  }

  murals.forEach(mural => {
    // Log mural data for debugging misplaced markers
    // Check if coordinates seem reasonable for the stated borough
    const lat = mural.lat;
    const lng = mural.lng;
    const borough = mural.borough;
    
    // Rough bounds for NYC boroughs (approximate)
    const boroughBounds = {
      "Manhattan": { latMin: 40.7, latMax: 40.9, lngMin: -74.05, lngMax: -73.9 },
      "Brooklyn": { latMin: 40.55, latMax: 40.75, lngMin: -74.05, lngMax: -73.85 },
      "Queens": { latMin: 40.55, latMax: 40.8, lngMin: -73.95, lngMax: -73.7 },
      "Bronx": { latMin: 40.78, latMax: 40.92, lngMin: -73.95, lngMax: -73.75 },
      "Staten Island": { latMin: 40.48, latMax: 40.65, lngMin: -74.26, lngMax: -74.05 }
    };
    
    if (borough && boroughBounds[borough]) {
      const bounds = boroughBounds[borough];
      const outOfBounds = lat < bounds.latMin || lat > bounds.latMax || 
                         lng < bounds.lngMin || lng > bounds.lngMax;
      
      if (outOfBounds) {
        console.warn(`⚠️ Potential misplaced mural: "${mural.name}"`, {
          borough: borough,
          coordinates: `${lat}, ${lng}`,
          expectedBounds: bounds,
          googleMapsLink: `https://www.google.com/maps?q=${lat},${lng}`
        });
      }
    }
    
    const marker = new google.maps.Marker({
      position: { lat: mural.lat, lng: mural.lng },
      map: null, // Don't add to map directly, let clusterer handle it
      title: mural.name,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
          <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="12" fill="${MARKER_COLOR}" stroke="#ffffff" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="#ffffff"/>
          </svg>
        `),
        scaledSize: new google.maps.Size(32, 32),
        anchor: new google.maps.Point(16, 16)
      }
    });

    marker.mural = mural;

    marker.addListener("click", () => {
      showMuralPopup(marker);
    });

    markers.push(marker);
  });

  // Update clusterer with markers
  updateClusterer();
}

// Create custom renderer for blue clusters
function createClusterRenderer() {
  return {
    render: ({ count, position }) => {
      // Create a cluster icon with marker color
      const svg = `
        <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="18" fill="${MARKER_COLOR}" stroke="#ffffff" stroke-width="2"/>
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
// Mural View Levels:
// - 100%: Full detail, fine-grained clustering (radius: 60, maxZoom: 14)
// - 75%: More aggregation, fewer clusters (radius: 90, maxZoom: 13)
// - 50%: High aggregation, neighborhood-level clusters (radius: 120, maxZoom: 12)
// - 25%: Special mode - exactly 5 borough clusters (handled separately, not using clusterer)
function updateClusterer() {
  // For 25% view, use borough markers instead of clustering
  if (activeFilters.muralView === 25) {
    // Hide all regular markers and clusters
    if (clusterer) {
      clusterer.clearMarkers();
    }
    markers.forEach(m => m.setMap(null));
    
    // Create borough markers
    createBoroughMarkers();
    return;
  }
  
  // For 100%, 75%, 50% views, use progressive clustering
  // Remove borough markers if they exist
  clearBoroughMarkers();
  
  // Show all markers again
  markers.forEach(m => m.setMap(map));
  
  const renderer = createClusterRenderer();
  
  // Helper function to create algorithm with view-level-specific settings
  function createAlgorithm() {
    let radius = 60; // Default for 100%
    let maxZoom = 14; // Default for 100%
    
    // Adjust clustering parameters based on view level
    if (activeFilters.muralView === 75) {
      radius = 90;  // Larger radius = more aggregation
      maxZoom = 13; // Stop clustering earlier
    } else if (activeFilters.muralView === 50) {
      radius = 120; // Even larger radius = high aggregation
      maxZoom = 12; // Stop clustering even earlier
    }
    // 100% uses defaults (radius: 60, maxZoom: 14)
    
    try {
      if (typeof markerClusterer !== 'undefined' && markerClusterer.gridAlgorithm && markerClusterer.gridAlgorithm.GridAlgorithm) {
        return new markerClusterer.gridAlgorithm.GridAlgorithm({
          radius: radius,
          maxZoom: maxZoom
        });
      } else if (window.markerClusterer && window.markerClusterer.gridAlgorithm && window.markerClusterer.gridAlgorithm.GridAlgorithm) {
        return new window.markerClusterer.gridAlgorithm.GridAlgorithm({
          radius: radius,
          maxZoom: maxZoom
        });
      }
    } catch (e) {
      console.log('Using default clustering algorithm');
    }
    return undefined;
  }
  
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

// Create borough markers for 25% view mode
// Shows exactly 5 clusters, one per borough, with mural counts
function createBoroughMarkers() {
  clearBoroughMarkers();
  
  const boroughCounts = {};
  const boroughCoords = {};
  
  // Count murals per borough and calculate centroids
  allMurals.forEach(mural => {
    if (!mural.borough || !mural.lat || !mural.lng) return;
    
    const borough = mural.borough;
    if (!boroughCounts[borough]) {
      boroughCounts[borough] = 0;
      boroughCoords[borough] = { latSum: 0, lngSum: 0, count: 0 };
    }
    
    boroughCounts[borough]++;
    boroughCoords[borough].latSum += mural.lat;
    boroughCoords[borough].lngSum += mural.lng;
    boroughCoords[borough].count++;
  });
  
  // Create markers for each borough
  Object.keys(boroughCounts).forEach(borough => {
    const count = boroughCounts[borough];
    const coords = boroughCoords[borough];
    
    // Use calculated centroid or fallback to predefined centroid
    let position;
    if (coords.count > 0) {
      position = {
        lat: coords.latSum / coords.count,
        lng: coords.lngSum / coords.count
      };
    } else {
      position = BOROUGH_CENTROIDS[borough] || { lat: 40.7128, lng: -74.006 };
    }
    
    // Create cluster-style marker with borough count
    const svg = `
      <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
        <circle cx="25" cy="25" r="22" fill="${MARKER_COLOR}" stroke="#ffffff" stroke-width="3"/>
        <text x="25" y="25" text-anchor="middle" dominant-baseline="central" 
              fill="#ffffff" font-size="16" font-weight="bold" font-family="Arial, sans-serif">
          ${count}
        </text>
      </svg>
    `;
    
    const marker = new google.maps.Marker({
      position: position,
      map: map,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(50, 50),
        anchor: new google.maps.Point(25, 25)
      },
      title: `${borough}: ${count} murals`,
      zIndex: 1000
    });
    
    // Store borough info
    marker.borough = borough;
    marker.muralCount = count;
    
    // Add click handler to filter by borough
    marker.addListener('click', () => {
      activeFilters.borough = borough;
      activeFilters.muralView = 100; // Switch to 100% view when clicking borough
      populateFilters();
      applyFilters();
    });
    
    boroughMarkers.push(marker);
  });
}

// Clear borough markers
function clearBoroughMarkers() {
  boroughMarkers.forEach(marker => {
    marker.setMap(null);
  });
  boroughMarkers = [];
}

function showMuralPopup(marker) {
  const m = marker.mural;
  const panel = document.getElementById("muralDetailPanel");
  
  if (!panel) {
    console.error("Mural detail panel not found");
    return;
  }

  // Calculate distance if user location is available
  let distanceText = "";
  if (userLocation) {
    const distanceKm = getDistanceFromLatLonInKm(
      userLocation.lat,
      userLocation.lng,
      m.lat,
      m.lng
    );
    const distanceMiles = (distanceKm * 0.621371).toFixed(1);
    distanceText = `<span style="color: #9ca3af; font-size: 12px;">${distanceMiles} miles away</span>`;
  }

  // Build HTML for the detail panel
  const html = `
    <div class="mural-detail-panel-header">
      <h2 class="mural-detail-panel-title">
        ${m.name}${m.year ? ` (${m.year})` : ''}
        ${distanceText ? `<br>${distanceText}` : ''}
      </h2>
      <button class="mural-detail-panel-close" data-close aria-label="Close">
        &times;
      </button>
    </div>
    
    ${m.image_url ? `
      <div class="mural-detail-panel-image">
        <img src="${m.image_url}" alt="${m.name}" />
      </div>
    ` : ''}
    
    <div class="mural-detail-panel-meta">
      <div class="mural-detail-meta-item">
        <div class="mural-detail-meta-label">Students</div>
        <div class="mural-detail-meta-value">${m.students_involved || '—'}</div>
      </div>
      <div class="mural-detail-meta-item">
        <div class="mural-detail-meta-label">Teaching Artist</div>
        <div class="mural-detail-meta-value">${m.artist_names || '—'}</div>
      </div>
      <div class="mural-detail-meta-item">
        <div class="mural-detail-meta-label">School</div>
        <div class="mural-detail-meta-value">${m.school || '—'}</div>
      </div>
      <div class="mural-detail-meta-item">
        <div class="mural-detail-meta-label">Borough</div>
        <div class="mural-detail-meta-value">${m.borough || '—'}</div>
          </div>
        </div>
    
    ${m.theme ? `
      <div class="mural-detail-panel-description">
        <h3>Mural Description</h3>
        <p>${m.theme}</p>
      </div>
    ` : ''}
    
    <div class="mural-detail-panel-actions">
      <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(m.lat + "," + m.lng)}${userLocation ? `&origin=${encodeURIComponent(userLocation.lat + "," + userLocation.lng)}` : ''}"
               target="_blank" rel="noopener"
         class="mural-detail-btn mural-detail-btn-primary"
         data-directions>
        ${userLocation ? 'Walking Directions' : 'Get Directions'}
      </a>
      <button class="mural-detail-btn" data-focus>
        Center Map
      </button>
        </div>
      `;

  panel.innerHTML = html;
  panel.classList.remove("hidden");

  // Prevent clicks inside panel from closing it
  panel.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Wire up event listeners
  const closeBtn = panel.querySelector('[data-close]');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.add("hidden");
    });
  }

  const directionsBtn = panel.querySelector('[data-directions]');
  if (directionsBtn) {
    // Link already has href, no additional handler needed
    // But we can add analytics or tracking here if needed
  }

  const focusBtn = panel.querySelector('[data-focus]');
  if (focusBtn) {
    focusBtn.addEventListener('click', () => {
      map.panTo({ lat: m.lat, lng: m.lng });
      const currentZoom = map.getZoom();
      if (currentZoom < 15) {
        map.setZoom(15);
      }
    });
  }
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

    // Tour filter - check if it's a curated tour ID or CSV tour_id
    if (activeFilters.tour !== null) {
      // Check if it's a curated tour (from MURAL_TOURS)
      const curatedTour = (window.MURAL_TOURS || []).find(t => t.id === activeFilters.tour);
      if (curatedTour) {
        // Match by borough
        if (curatedTour.borough && m.borough !== curatedTour.borough) {
          return false;
        }
        // Match by keywords
        if (curatedTour.keywords && curatedTour.keywords.length > 0) {
          const searchText = `${m.name} ${m.school || ''} ${m.borough || ''} ${m.theme || ''}`.toLowerCase();
          const matchesKeyword = curatedTour.keywords.some(keyword => 
            searchText.includes(keyword.toLowerCase())
          );
          if (!matchesKeyword) return false;
        }
      } else {
        // It's a CSV tour_id value
        if (m.tour_id !== activeFilters.tour) {
          return false;
        }
      }
    }

    return true;
  });

  // Apply tour limit if it's a curated tour
  let tourLimit = null;
  if (activeFilters.tour) {
    const curatedTour = (window.MURAL_TOURS || []).find(t => t.id === activeFilters.tour);
    if (curatedTour && curatedTour.limit) {
      tourLimit = curatedTour.limit;
    }
  }

  // Apply tour limit first (before mural view percentage)
  if (tourLimit && filtered.length > tourLimit) {
    filtered = filtered.slice(0, tourLimit);
  }

  // Apply mural view percentage filter (show only X% of filtered results)
  if (activeFilters.muralView < 100) {
    const totalCount = filtered.length;
    const targetCount = Math.ceil((activeFilters.muralView / 100) * totalCount);
    // Randomly sample or take first N (for consistency, we'll shuffle and take first N)
    filtered = shuffleArray([...filtered]).slice(0, targetCount);
  }

  createMarkers(filtered);
  
  // Fit bounds to filtered markers with max zoom limit (20m per 44 pixels ≈ zoom 17)
  // Only auto-fit if a filter is active (not on initial load)
  const hasActiveFilter = activeFilters.search || 
                          activeFilters.year !== null || 
                          activeFilters.school !== null || 
                          activeFilters.borough !== null || 
                          activeFilters.tour !== null;
  
  if (filtered.length > 0 && hasActiveFilter) {
    const bounds = new google.maps.LatLngBounds();
    filtered.forEach(m => bounds.extend({ lat: m.lat, lng: m.lng }));
    
    // Calculate the zoom level that fitBounds would use
    const listener = google.maps.event.addListener(map, 'bounds_changed', () => {
      const currentZoom = map.getZoom();
      // Limit max zoom to 17 (approximately 20m per 44 pixels at NYC latitude)
      if (currentZoom > 17) {
        map.setZoom(17);
      }
      google.maps.event.removeListener(listener);
    });
    
    map.fitBounds(bounds, { padding: 50 });
  }
}

function populateFilters() {
  const years = new Set();
  const schools = new Set();
  const boroughs = new Set();
  const tours = new Set();

  allMurals.forEach(m => {
    if (m.year) years.add(m.year);
    if (m.school) schools.add(m.school);
    if (m.borough) boroughs.add(m.borough);
    if (m.tour_id) tours.add(m.tour_id);
  });

  // Populate year filter (circular buttons)
  const yearContainer = document.getElementById("yearFilter");
  if (yearContainer) {
    yearContainer.innerHTML = "";
    yearContainer.classList.add("year-filter");
    Array.from(years)
      .sort((a, b) => b - a) // Sort descending
      .forEach(year => {
        const btn = document.createElement("button");
        btn.className = "filter-btn";
        btn.textContent = year;
        btn.dataset.value = year;
        btn.addEventListener("click", () => {
          // Toggle year filter
          if (activeFilters.year === year) {
            activeFilters.year = null;
            btn.classList.remove("active");
          } else {
            // Remove active from all year buttons
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
    Array.from(schools)
      .sort()
      .forEach(school => {
        const btn = document.createElement("button");
        btn.className = "filter-btn";
        btn.textContent = school;
        btn.dataset.value = school;
        btn.addEventListener("click", () => {
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
  Array.from(boroughs)
    .sort()
      .forEach(borough => {
        const btn = document.createElement("button");
        btn.className = "filter-btn";
        btn.textContent = borough;
        btn.dataset.value = borough;
        btn.addEventListener("click", () => {
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

  // Tours filter removed - only Curated Tours are available now

  // Setup "View All" modals (no tours)
  setupViewAllModals(schools, boroughs, new Set());
}

function setupViewAllModals(schools, boroughs, tours) {
  const modal = document.getElementById("viewAllModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");

  function showModal(title, items, filterType) {
    modalTitle.textContent = title;
    modalBody.innerHTML = "";
    
    Array.from(items)
    .sort()
      .forEach(item => {
        const div = document.createElement("div");
        div.className = "modal-item";
        if (filterType === 'school' && activeFilters.school === item) div.classList.add("active");
        if (filterType === 'borough' && activeFilters.borough === item) div.classList.add("active");
        
        div.textContent = item;
        div.addEventListener("click", () => {
          // Toggle filter
          if (filterType === 'school') {
            activeFilters.school = activeFilters.school === item ? null : item;
          } else if (filterType === 'borough') {
            activeFilters.borough = activeFilters.borough === item ? null : item;
          }
          applyFilters();
          populateFilters(); // Refresh to update active states
          modal.classList.add("hidden");
        });
        modalBody.appendChild(div);
      });
    
    modal.classList.remove("hidden");
  }

  document.getElementById("schoolsViewAll")?.addEventListener("click", () => {
    showModal("All Schools", schools, 'school');
  });

  document.getElementById("boroughViewAll")?.addEventListener("click", () => {
    showModal("All Boroughs", boroughs, 'borough');
  });

  // Tours View All removed - only Curated Tours are available now

  modalClose?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });
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

// Clear active tour overlays (polyline, directions renderer, and stop markers)
function clearActiveTour() {
  if (activeTourPolyline) {
    activeTourPolyline.setMap(null);
    activeTourPolyline = null;
  }
  
  if (activeTourDirectionsRenderer) {
    activeTourDirectionsRenderer.setMap(null);
    activeTourDirectionsRenderer = null;
  }
  
  activeTourStopMarkers.forEach(marker => {
    marker.setMap(null);
  });
  activeTourStopMarkers = [];
}

// Reset map view to default state
function resetMapView() {
  // Clear active tour overlays
  clearActiveTour();
  
  // Clear all active filters
  activeFilters = {
    search: "",
    year: null,
    school: null,
    borough: null,
    tour: null,
    muralView: 100
  };

  // Reset filter UI controls
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.value = "";
  }

  // Reset mural view filter to 100%
  const muralViewContainer = document.getElementById("muralViewFilter");
  if (muralViewContainer) {
    muralViewContainer.querySelectorAll(".filter-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.value === "100");
    });
  }

  // Reset all filter buttons (year, school, borough)
  document.querySelectorAll(".filter-scroll .filter-btn").forEach(btn => {
    btn.classList.remove("active");
  });

  // Hide the detail panel
  const panel = document.getElementById("muralDetailPanel");
  if (panel) {
    panel.classList.add("hidden");
  }

  // Clear user location if set
  userLocation = null;
  nearestMurals = [];
  const nearestResults = document.getElementById("nearestResults");
  if (nearestResults) {
    nearestResults.innerHTML = '<p>Tap "Find murals near me" to surface the closest murals and walking directions.</p>';
    nearestResults.classList.add("empty");
  }
  
  // Remove user location marker
  if (window.userLocationMarker) {
    window.userLocationMarker.setMap(null);
    window.userLocationMarker = null;
  }

  // Reset map viewport to default
  map.setCenter(DEFAULT_CENTER);
  map.setZoom(DEFAULT_ZOOM);

  // Show all markers by applying empty filters
  applyFilters();
}

// Setup Reset View button
function setupResetView() {
  const resetBtn = document.getElementById("resetViewBtn");
  if (!resetBtn) return;

  resetBtn.addEventListener("click", () => {
    resetMapView();
  });
}

// Helper function to shuffle array (for random sampling)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Setup Mural View filter (100%, 75%, 50%, 25%)
function setupMuralViewFilter() {
  const muralViewContainer = document.getElementById("muralViewFilter");
  if (!muralViewContainer) return;

  muralViewContainer.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // Remove active from all buttons
      muralViewContainer.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      // Add active to clicked button
      btn.classList.add("active");
      // Update filter
      activeFilters.muralView = parseInt(btn.dataset.value);
      applyFilters();
    });
  });
}

// Setup location services (Find murals near me)
function setupLocationServices() {
  const locateBtn = document.getElementById("locateMeBtn");
  const clearBtn = document.getElementById("clearLocationBtn");
  const nearestResults = document.getElementById("nearestResults");

  if (!locateBtn || !clearBtn || !nearestResults) return;

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      nearestResults.innerHTML = '<p style="color: #ef4444;">Geolocation is not supported by your browser.</p>';
      return;
    }

    locateBtn.disabled = true;
    locateBtn.textContent = "Locating...";

    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        // Find nearest murals
        const muralsWithDistance = allMurals.map(mural => {
          const distance = getDistanceFromLatLonInKm(
            userLocation.lat,
            userLocation.lng,
            mural.lat,
            mural.lng
          );
          return { ...mural, distance };
        });

        // Sort by distance and take top 5
        nearestMurals = muralsWithDistance
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 5);

        // Display results
        if (nearestMurals.length > 0) {
          let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
          nearestMurals.forEach((mural, index) => {
            const distanceMiles = (mural.distance * 0.621371).toFixed(1);
            html += `
              <div style="padding: 12px; background: rgba(59, 130, 246, 0.1); border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.3);">
                <div style="font-weight: 600; margin-bottom: 4px;">${index + 1}. ${mural.name}</div>
                <div style="font-size: 12px; color: #9ca3af; margin-bottom: 8px;">${distanceMiles} miles away</div>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mural.lat + "," + mural.lng)}&origin=${encodeURIComponent(userLocation.lat + "," + userLocation.lng)}"
                   target="_blank" rel="noopener"
                   style="font-size: 12px; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: ${MARKER_COLOR}; color: #ffffff; display: inline-block;">
                  Get Directions
                </a>
              </div>
            `;
          });
          html += '</div>';
          nearestResults.innerHTML = html;
          nearestResults.classList.remove("empty");

          // Center map on user location
          map.setCenter(userLocation);
          map.setZoom(13);

          // Add user location marker
          if (window.userLocationMarker) {
            window.userLocationMarker.setMap(null);
          }
          window.userLocationMarker = new google.maps.Marker({
            position: userLocation,
            map: map,
            icon: {
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" fill="${MARKER_COLOR}" stroke="#ffffff" stroke-width="2"/>
                  <circle cx="12" cy="12" r="4" fill="#ffffff"/>
                </svg>
              `),
              scaledSize: new google.maps.Size(24, 24),
              anchor: new google.maps.Point(12, 12)
            },
            title: "Your location"
          });
        } else {
          nearestResults.innerHTML = '<p>No murals found nearby.</p>';
          nearestResults.classList.remove("empty");
        }

        locateBtn.disabled = false;
        locateBtn.textContent = "Find murals near me";
      },
      (error) => {
        let errorMsg = "Unable to retrieve your location.";
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = "Location access denied. Please enable location permissions.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = "Location information unavailable.";
        } else if (error.code === error.TIMEOUT) {
          errorMsg = "Location request timed out.";
        }
        nearestResults.innerHTML = `<p style="color: #ef4444;">${errorMsg}</p>`;
        nearestResults.classList.remove("empty");
        locateBtn.disabled = false;
        locateBtn.textContent = "Find murals near me";
      }
    );
  });

  clearBtn.addEventListener("click", () => {
    userLocation = null;
    nearestMurals = [];
    nearestResults.innerHTML = '<p>Tap "Find murals near me" to surface the closest murals and walking directions.</p>';
    nearestResults.classList.add("empty");
    
    if (window.userLocationMarker) {
      window.userLocationMarker.setMap(null);
      window.userLocationMarker = null;
    }

    // Reset map to default view
    map.setCenter(DEFAULT_CENTER);
    map.setZoom(DEFAULT_ZOOM);
  });
}

// Calculate distance between two coordinates in kilometers (Haversine formula)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Setup sidebar toggle
function setupSidebarToggle() {
  const sidebar = document.getElementById("sidebar");
  const hideBtn = document.getElementById("sidebarHideBtn");
  const showTab = document.getElementById("sidebarShowTab");

  if (!sidebar || !hideBtn || !showTab) return;

  hideBtn.addEventListener("click", () => {
    sidebar.classList.add("hidden");
    showTab.classList.remove("hidden");
    showTab.setAttribute("aria-expanded", "false");
  });

  showTab.addEventListener("click", () => {
    sidebar.classList.remove("hidden");
    showTab.classList.add("hidden");
    showTab.setAttribute("aria-expanded", "true");
  });
}

// Helper function to group murals by site (school/location)
function groupMuralsBySite(murals) {
  const siteMap = new Map();
  
  murals.forEach(mural => {
    // Use school as the site key, or fallback to coordinates if no school
    const siteKey = mural.school || `${mural.lat.toFixed(4)},${mural.lng.toFixed(4)}`;
    
    if (!siteMap.has(siteKey)) {
      siteMap.set(siteKey, {
        siteName: mural.school || 'Unknown Site',
        murals: [],
        lat: mural.lat,
        lng: mural.lng
      });
    }
    
    const site = siteMap.get(siteKey);
    site.murals.push(mural);
    
    // Use average coordinates for sites with multiple murals
    const avgLat = site.murals.reduce((sum, m) => sum + m.lat, 0) / site.murals.length;
    const avgLng = site.murals.reduce((sum, m) => sum + m.lng, 0) / site.murals.length;
    site.lat = avgLat;
    site.lng = avgLng;
  });
  
  return Array.from(siteMap.values());
}

// Render curated tour cards
function renderTourCards() {
  const tourCardsContainer = document.getElementById("tourCards");
  if (!tourCardsContainer) {
    console.warn("Tour cards container not found");
    return;
  }
  
  if (!window.MURAL_TOURS) {
    console.warn("MURAL_TOURS not defined");
    tourCardsContainer.innerHTML = '<p style="color: #9ca3af; font-size: 14px;">No curated tours available.</p>';
    return;
  }

  const tours = window.MURAL_TOURS || [];
  console.log(`Rendering ${tours.length} curated tours`);

  if (tours.length === 0) {
    tourCardsContainer.innerHTML = '<p style="color: #9ca3af; font-size: 14px;">No curated tours available.</p>';
    return;
  }
  
  if (allMurals.length === 0) {
    console.warn("No murals loaded yet, cannot render tour cards");
    tourCardsContainer.innerHTML = '<p style="color: #9ca3af; font-size: 14px;">Loading tours...</p>';
    return;
  }

  tourCardsContainer.innerHTML = tours.map(tour => {
    // Find murals that match this tour
    const matchingMurals = allMurals.filter(m => {
      // Match by borough
      if (tour.borough && m.borough !== tour.borough) return false;
      
      // Match by keywords
      if (tour.keywords && tour.keywords.length > 0) {
        const searchText = `${m.name} ${m.school || ''} ${m.borough || ''} ${m.theme || ''}`.toLowerCase();
        const matchesKeyword = tour.keywords.some(keyword => 
          searchText.includes(keyword.toLowerCase())
        );
        if (!matchesKeyword) return false;
      }
      
      return true;
    }).slice(0, tour.limit || 10);

    // Group by site to get actual stop count
    const sites = groupMuralsBySite(matchingMurals);
    const stopCount = sites.length;
    const color = CURATED_TOUR_COLOR;

    return `
      <div class="tour-card" data-tour-id="${tour.id}" style="border-left-color: ${color};">
        <div class="tour-card-header">
          <h3 class="tour-card-title">${tour.name}</h3>
          <span class="tour-card-count">${stopCount} stops</span>
        </div>
        <p class="tour-card-description">${tour.description || ''}</p>
        <button class="tour-card-btn" data-tour-id="${tour.id}">
          View Tour
        </button>
      </div>
    `;
  }).join('');

  // Add click handlers to tour cards
  tourCardsContainer.querySelectorAll('.tour-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tourId = btn.dataset.tourId;
      activateTour(tourId);
    });
  });
}

// Create tour route using Google Maps Directions API
// Uses walking mode for mural tours (appropriate for walking tours)
// Falls back to simple polyline if Directions API fails
// Caches routes in memory to avoid repeated API calls
async function createTourRoute(sites, tourId) {
  if (!sites || sites.length < 2) {
    // Not enough sites for a route, use simple polyline
    createSimpleTourPolyline(sites);
    return;
  }
  
  // Check cache first
  const cacheKey = `${tourId}-${sites.map(s => `${s.lat},${s.lng}`).join('|')}`;
  if (tourRoutesCache.has(cacheKey)) {
    const cachedRoute = tourRoutesCache.get(cacheKey);
    displayTourRoute(cachedRoute);
    return;
  }
  
  // Use Directions Service to get walking route
  if (!window.directionsService) {
    window.directionsService = new google.maps.DirectionsService();
  }
  
  // Build waypoints (all sites except first and last)
  const waypoints = sites.slice(1, -1).map(site => ({
    location: { lat: site.lat, lng: site.lng },
    stopover: true
  }));
  
  const request = {
    origin: { lat: sites[0].lat, lng: sites[0].lng },
    destination: { lat: sites[sites.length - 1].lat, lng: sites[sites.length - 1].lng },
    waypoints: waypoints,
    travelMode: google.maps.TravelMode.WALKING, // Walking mode for mural tours
    optimizeWaypoints: false // Keep order as specified
  };
  
  try {
    window.directionsService.route(request, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK) {
        // Cache the result
        tourRoutesCache.set(cacheKey, result);
        displayTourRoute(result);
      } else {
        console.warn(`Directions API failed (${status}), falling back to simple polyline`);
        createSimpleTourPolyline(sites);
      }
    });
  } catch (error) {
    console.error('Error calling Directions API:', error);
    createSimpleTourPolyline(sites);
  }
}

// Display tour route using Directions Renderer
function displayTourRoute(directionsResult) {
  // Clear any existing directions renderer
  if (activeTourDirectionsRenderer) {
    activeTourDirectionsRenderer.setMap(null);
  }
  
  // Create new directions renderer with custom styling
  activeTourDirectionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    directions: directionsResult,
    suppressMarkers: true, // We use our own numbered stop markers
    polylineOptions: {
      strokeColor: CURATED_TOUR_COLOR,
      strokeOpacity: 0.8,
      strokeWeight: 4,
      zIndex: 1
    }
  });
}

// Fallback: Create simple polyline connecting sites
function createSimpleTourPolyline(sites) {
  if (!sites || sites.length < 2) return;
  
  const path = sites.map(site => ({ lat: site.lat, lng: site.lng }));
  
  activeTourPolyline = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: CURATED_TOUR_COLOR,
    strokeOpacity: 0.8,
    strokeWeight: 4,
    map: map,
    zIndex: 1
  });
}

// Activate a curated tour
async function activateTour(tourId) {
  const tour = (window.MURAL_TOURS || []).find(t => t.id === tourId);
  if (!tour) return;

  // Clear any existing tour overlays
  clearActiveTour();

  // Find matching murals
  const matchingMurals = allMurals.filter(m => {
    // Match by borough
    if (tour.borough && m.borough !== tour.borough) return false;
    
    // Match by keywords
    if (tour.keywords && tour.keywords.length > 0) {
      const searchText = `${m.name} ${m.school || ''} ${m.borough || ''} ${m.theme || ''}`.toLowerCase();
      const matchesKeyword = tour.keywords.some(keyword => 
        searchText.includes(keyword.toLowerCase())
      );
      if (!matchesKeyword) return false;
    }
    
    return true;
  }).slice(0, tour.limit || 10);

  if (matchingMurals.length === 0) {
    alert('No murals found for this tour.');
    return;
  }

  // Group murals by site
  const sites = groupMuralsBySite(matchingMurals);
  
  // Sort sites by distance to create a logical route (simple nearest-neighbor)
  const sortedSites = [];
  const remainingSites = [...sites];
  
  if (remainingSites.length > 0) {
    // Start with first site
    let currentSite = remainingSites.shift();
    sortedSites.push(currentSite);
    
    // Greedy nearest-neighbor to build route
    while (remainingSites.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      
      for (let i = 0; i < remainingSites.length; i++) {
        const distance = getDistanceFromLatLonInKm(
          currentSite.lat, currentSite.lng,
          remainingSites[i].lat, remainingSites[i].lng
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }
      
      currentSite = remainingSites.splice(nearestIndex, 1)[0];
      sortedSites.push(currentSite);
    }
  }

  // Create route using Google Maps Directions API (walking mode for mural tours)
  // Falls back to simple polyline if Directions API fails
  await createTourRoute(sortedSites, tourId);

  // Create numbered stop markers for each site
  sortedSites.forEach((site, index) => {
    const stopNumber = index + 1;
    const svg = `
      <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
        <circle cx="18" cy="18" r="16" fill="${CURATED_TOUR_COLOR}" stroke="#ffffff" stroke-width="2"/>
        <text x="18" y="18" text-anchor="middle" dominant-baseline="central" 
              fill="#ffffff" font-size="14" font-weight="bold" font-family="Arial, sans-serif">
          ${stopNumber}
        </text>
      </svg>
    `;
    
    const stopMarker = new google.maps.Marker({
      position: { lat: site.lat, lng: site.lng },
      map: map,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(36, 36),
        anchor: new google.maps.Point(18, 18)
      },
      title: `Stop ${stopNumber}: ${site.siteName}`,
      zIndex: 1000 + stopNumber
    });
    
    // Store site info on marker
    stopMarker.siteInfo = site;
    stopMarker.stopNumber = stopNumber;
    
    // Add click handler to show site info
    stopMarker.addListener('click', () => {
      // Show first mural from this site in detail panel
      if (site.murals.length > 0) {
        // Find the marker for this mural
        const muralMarker = markers.find(m => m.mural === site.murals[0]);
        if (muralMarker) {
          showMuralPopup(muralMarker);
        }
      }
    });
    
    activeTourStopMarkers.push(stopMarker);
  });

  // Set tour filter to curated tour ID
  activeFilters.tour = tourId;
  
  // Clear other filters that might conflict
  activeFilters.borough = null;
  activeFilters.school = null;
  activeFilters.year = null;
  activeFilters.search = "";
  
  // Update filter UI
  document.getElementById("searchInput").value = "";
  populateFilters(); // This will update all filter buttons

  // Apply filters to show only tour murals
  applyFilters();

  // Fit bounds to tour polyline and stops
  if (sortedSites.length > 0) {
    const bounds = new google.maps.LatLngBounds();
    sortedSites.forEach(site => bounds.extend({ lat: site.lat, lng: site.lng }));
    
    const listener = google.maps.event.addListener(map, 'bounds_changed', () => {
      const currentZoom = map.getZoom();
      if (currentZoom > 17) {
        map.setZoom(17);
      }
      google.maps.event.removeListener(listener);
    });
    
    map.fitBounds(bounds, { padding: 80 });
  }
}

// Called by Google Maps JS API via callback parameter in index.html
async function initMap() {
  try {
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

    // InfoWindow no longer used for mural details (we use fixed panel instead)
    // Keeping it in case it's needed for other purposes
    infoWindow = new google.maps.InfoWindow({
      maxWidth: 500
    });
    
    // Close detail panel when clicking on the map
    map.addListener("click", () => {
      const panel = document.getElementById("muralDetailPanel");
      if (panel && !panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
      }
    });

    const murals = await loadMuralsFromSheet();
    console.log(`Loaded ${murals.length} murals from CSV`);
    allMurals = murals;

    if (murals.length === 0) {
      throw new Error("No murals found in CSV. Check that the CSV has valid data with 'mural_title', 'lat', and 'lng' columns.");
    }

    createMarkers(murals);
    populateFilters();
    setupSearch();
    setupMuralViewFilter();
    setupLocationServices();
    setupSidebarToggle();
    setupResetView();
    renderTourCards();

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
