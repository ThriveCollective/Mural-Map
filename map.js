/* ══════════════════════════════════════════════════════
   THRIVE COLLECTIVE — MURAL MAP  |  map.js
   Handles: Google Maps, markers, clustering, filters,
            info panel, street view, transit directions
══════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────
   MURAL DATA
   Each mural object:
   {
     id, title, artist, year, borough, school, address,
     lat, lng, description, image, tags
   }
   ─────────────────────────────────────────────────── */
const MURALS = [
  // ── MANHATTAN ──────────────────────────────────────
  {
    id: 1,
    title: "Roots & Wings",
    artist: "Thrive Youth Cohort 2025",
    year: 2025,
    borough: "Manhattan",
    school: "PS 123",
    address: "301 W 140th St, New York, NY 10030",
    lat: 40.8173, lng: -73.9440,
    description: "A sweeping celebration of Harlem's cultural roots, painted by 24 students across two summers. Towering figures reach upward through lush foliage, representing the community's growth.",
    image: "https://images.unsplash.com/photo-1555685812-4b943f1cb0eb?w=800&q=80",
    tags: ["Harlem", "Student-Led", "2025"]
  },
  {
    id: 2,
    title: "City of Stars",
    artist: "Thrive + Marcus Rivera",
    year: 2024,
    borough: "Manhattan",
    school: "12C Outdoor Gallery",
    address: "55 W 125th St, New York, NY 10027",
    lat: 40.8079, lng: -73.9455,
    description: "A cosmic streetscape blending Harlem's skyline with constellations, commissioned for the 12C Outdoor Gallery's annual showcase.",
    image: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=800&q=80",
    tags: ["Harlem", "Commissioned", "2024"]
  },
  {
    id: 3,
    title: "The Woven Neighborhood",
    artist: "Yasmin Torres & Thrive Cohort",
    year: 2026,
    borough: "Manhattan",
    school: "Community Center",
    address: "215 E 116th St, New York, NY 10029",
    lat: 40.7960, lng: -73.9367,
    description: "Inspired by textile traditions from East Harlem's Latino community, this 2026 mural weaves together patterns from Puerto Rico, Mexico, and the Dominican Republic.",
    image: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800&q=80",
    tags: ["East Harlem", "2026", "Cultural"]
  },
  {
    id: 4,
    title: "Washington Heights Rises",
    artist: "Thrive Cohort 2023",
    year: 2023,
    borough: "Manhattan",
    school: "PS 123",
    address: "551 W 179th St, New York, NY 10033",
    lat: 40.8507, lng: -73.9360,
    description: "Young artists from Washington Heights documented their neighborhood in vivid color — bodegas, fire escapes, and family portraits rendered monumental.",
    image: "https://images.unsplash.com/photo-1574182245530-967d9b3831af?w=800&q=80",
    tags: ["Washington Heights", "Documentary", "2023"]
  },

  // ── BROOKLYN ───────────────────────────────────────
  {
    id: 5,
    title: "Community: I Am 282",
    artist: "PS/MS 282 Students",
    year: 2025,
    borough: "Brooklyn",
    school: "PS/MS 282",
    address: "180 6th Ave, Brooklyn, NY 11217",
    lat: 40.6776, lng: -73.9747,
    description: "Students at PS/MS 282 designed every inch of this facade mural, weaving their names, faces, and dreams into an epic 120-foot composition.",
    image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
    tags: ["Park Slope", "School Facade", "2025"]
  },
  {
    id: 6,
    title: "Flatbush Generations",
    artist: "Thrive Youth + Aisha Williams",
    year: 2024,
    borough: "Brooklyn",
    school: "Community Center",
    address: "900 Flatbush Ave, Brooklyn, NY 11226",
    lat: 40.6462, lng: -73.9556,
    description: "Three generations of a Flatbush family are rendered at monumental scale — grandmother, mother, and child — anchoring the mural's message of continuity and pride.",
    image: "https://images.unsplash.com/photo-1572375992501-4b0892d50c69?w=800&q=80",
    tags: ["Flatbush", "Portrait", "2024"]
  },
  {
    id: 7,
    title: "Ocean Dreaming",
    artist: "Thrive Marine Cohort",
    year: 2025,
    borough: "Brooklyn",
    school: "161 Studio",
    address: "161 Sands St, Brooklyn, NY 11201",
    lat: 40.6980, lng: -73.9892,
    description: "Painted by the Thrive Marine Science cohort, this mural transforms the 161 Studio exterior into an underwater world native to New York Harbor.",
    image: "https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=800&q=80",
    tags: ["DUMBO", "Environment", "2025"]
  },
  {
    id: 8,
    title: "Crown Heights Mosaic",
    artist: "Multi-Artist Collective",
    year: 2023,
    borough: "Brooklyn",
    school: "Community Center",
    address: "1375 Bedford Ave, Brooklyn, NY 11216",
    lat: 40.6693, lng: -73.9553,
    description: "A tile-influenced mural celebrating the Caribbean and African diasporas that form the cultural heartbeat of Crown Heights.",
    image: "https://images.unsplash.com/photo-1562619425-c307bb82f9e2?w=800&q=80",
    tags: ["Crown Heights", "Mosaic-Style", "2023"]
  },
  {
    id: 9,
    title: "Thrive Gala 2024",
    artist: "PS/MS 282 Spring Cohort",
    year: 2024,
    borough: "Brooklyn",
    school: "PS/MS 282",
    address: "180 6th Ave, Brooklyn, NY 11217",
    lat: 40.6783, lng: -73.9752,
    description: "Created as the centerpiece for Thrive's 2024 Gala, this mural was live-painted during the event and later permanently installed.",
    image: "https://images.unsplash.com/photo-1547826039-bfc35e0f1ea8?w=800&q=80",
    tags: ["Park Slope", "Gala", "2024"]
  },

  // ── THE BRONX ──────────────────────────────────────
  {
    id: 10,
    title: "Hunts Point Horizon",
    artist: "Thrive South Bronx Cohort",
    year: 2024,
    borough: "Bronx",
    school: "Community Center",
    address: "780 Garrison Ave, Bronx, NY 10474",
    lat: 40.8152, lng: -73.8786,
    description: "Reclaiming a formerly blighted wall, this mural shows Hunts Point not as it was but as its youth envision it — verdant, bold, and proud.",
    image: "https://images.unsplash.com/photo-1531804055935-76f44d7c3621?w=800&q=80",
    tags: ["Hunts Point", "Vision", "2024"]
  },
  {
    id: 11,
    title: "Concourse Portrait Wall",
    artist: "Thrive x Grand Concourse Alliance",
    year: 2026,
    borough: "Bronx",
    school: "12C Outdoor Gallery",
    address: "1 E 161st St, Bronx, NY 10451",
    lat: 40.8282, lng: -73.9258,
    description: "An 80-foot portrait wall honoring eight influential Bronxites — teachers, organizers, and artists — painted in collaboration with the Grand Concourse Alliance for 2026.",
    image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80",
    tags: ["Grand Concourse", "Portraits", "2026"]
  },
  {
    id: 12,
    title: "Mott Haven Bloom",
    artist: "Sofía Reyes & Thrive Cohort",
    year: 2023,
    borough: "Bronx",
    school: "PS 123",
    address: "350 Willis Ave, Bronx, NY 10454",
    lat: 40.8066, lng: -73.9248,
    description: "Botanically inspired, this mural lines an entire city block with oversized flowers native to Central America, honoring the neighborhood's immigrant community.",
    image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
    tags: ["Mott Haven", "Botanical", "2023"]
  },
  {
    id: 13,
    title: "Yankee Stadium Block",
    artist: "Thrive Athletics Cohort",
    year: 2022,
    borough: "Bronx",
    school: "Community Center",
    address: "153 E 161st St, Bronx, NY 10451",
    lat: 40.8296, lng: -73.9276,
    description: "Sports-themed mural celebrating the Bronx's legacy in baseball, basketball, and boxing, painted by students in the Thrive Athletics cohort.",
    image: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80",
    tags: ["Concourse", "Sports", "2022"]
  },

  // ── QUEENS ─────────────────────────────────────────
  {
    id: 14,
    title: "Jackson Heights Tapestry",
    artist: "Thrive Queens Cohort",
    year: 2025,
    borough: "Queens",
    school: "PS 123",
    address: "75-01 37th Ave, Jackson Heights, NY 11372",
    lat: 40.7479, lng: -73.8900,
    description: "Representing the dozens of languages spoken in Jackson Heights, this mural weaves script from 12 languages into a luminous composition honoring New York's most diverse zip code.",
    image: "https://images.unsplash.com/photo-1548625361-58a9d86b0e8f?w=800&q=80",
    tags: ["Jackson Heights", "Multilingual", "2025"]
  },
  {
    id: 15,
    title: "Flushing River Walk",
    artist: "Thrive Environmental Cohort",
    year: 2024,
    borough: "Queens",
    school: "Community Center",
    address: "133-32 39th Ave, Flushing, NY 11354",
    lat: 40.7605, lng: -73.8296,
    description: "An environmental mural documenting the history and restoration of the Flushing River, painted along the underpass connecting Flushing Meadows to Main Street.",
    image: "https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=800&q=80",
    tags: ["Flushing", "Environmental", "2024"]
  },
  {
    id: 16,
    title: "Long Island City Gateway",
    artist: "Thrive x LIC Arts Open",
    year: 2026,
    borough: "Queens",
    school: "12C Outdoor Gallery",
    address: "5-25 46th Ave, Long Island City, NY 11101",
    lat: 40.7446, lng: -73.9512,
    description: "Commissioned as a gateway mural for the LIC Arts Open 2026, this large-scale work depicts the borough of Queens as a constellation of interconnected communities.",
    image: "https://images.unsplash.com/photo-1578926375605-eaf7559b1458?w=800&q=80",
    tags: ["LIC", "Gateway", "2026"]
  },

  // ── STATEN ISLAND ──────────────────────────────────
  {
    id: 17,
    title: "North Shore Story",
    artist: "Thrive SI Cohort",
    year: 2023,
    borough: "Staten Island",
    school: "Community Center",
    address: "40 Richmond Terrace, Staten Island, NY 10301",
    lat: 40.6432, lng: -74.0770,
    description: "Thrive's first Staten Island mural, created with North Shore youth, tells the story of the waterfront's industrial past and its hopeful future.",
    image: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&q=80",
    tags: ["North Shore", "History", "2023"]
  }
];

/* ─────────────────────────────────────────────────────
   CURATED TOURS (mural IDs per tour)
   ─────────────────────────────────────────────────── */
const TOURS = {
  harlem:   [1, 2, 3, 4],
  brooklyn: [5, 6, 7, 8, 9],
  bronx:    [10, 11, 12, 13],
};

/* ─────────────────────────────────────────────────────
   STATE
   ─────────────────────────────────────────────────── */
let map, panorama, directionsService, directionsRenderer;
let markers = [];          // { mural, marker } pairs
let activeMural = null;    // currently selected mural
let activeFilters = {
  year: "all",
  borough: "all",
  school: "all",
  search: ""
};
let transitMode = "TRANSIT";
let infoOpen = false;

/* ─────────────────────────────────────────────────────
   INIT (called by Google Maps API callback)
   ─────────────────────────────────────────────────── */
function initMap() {
  // Dark-mode map style matching the UI
  const darkStyle = [
    { elementType: "geometry",            stylers: [{ color: "#0d0f14" }] },
    { elementType: "labels.text.stroke",  stylers: [{ color: "#0d0f14" }] },
    { elementType: "labels.text.fill",    stylers: [{ color: "#7a8099" }] },
    { featureType: "road",            elementType: "geometry",       stylers: [{ color: "#1b1f2b" }] },
    { featureType: "road",            elementType: "geometry.stroke", stylers: [{ color: "#13161e" }] },
    { featureType: "road",            elementType: "labels.text.fill", stylers: [{ color: "#4a5068" }] },
    { featureType: "road.highway",    elementType: "geometry",       stylers: [{ color: "#242838" }] },
    { featureType: "road.highway",    elementType: "labels.text.fill", stylers: [{ color: "#7a8099" }] },
    { featureType: "water",           elementType: "geometry",       stylers: [{ color: "#0a0c10" }] },
    { featureType: "water",           elementType: "labels.text.fill", stylers: [{ color: "#1b1f2b" }] },
    { featureType: "poi",             elementType: "geometry",       stylers: [{ color: "#13161e" }] },
    { featureType: "poi.park",        elementType: "geometry",       stylers: [{ color: "#111519" }] },
    { featureType: "poi",             elementType: "labels.text.fill", stylers: [{ color: "#4a5068" }] },
    { featureType: "transit",         elementType: "geometry",       stylers: [{ color: "#1b1f2b" }] },
    { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#7a8099" }] },
    { featureType: "administrative",  elementType: "geometry.stroke", stylers: [{ color: "#1b1f2b" }] },
    { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#4a5068" }] },
  ];

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 40.7282, lng: -73.9442 },
    zoom: 12,
    styles: darkStyle,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
    gestureHandling: "greedy",
  });

  directionsService  = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    panel: document.getElementById("directions-panel"),
    suppressMarkers: false,
    polylineOptions: { strokeColor: "#2ec4b6", strokeWeight: 4 }
  });
  directionsRenderer.setMap(map);

  createMarkers();
  applyFilters();
  bindUI();
}

/* ─────────────────────────────────────────────────────
   CUSTOM MARKER SVG
   ─────────────────────────────────────────────────── */
function markerSVG(color = "#f7b731") {
  // Returns a data URI for a teardrop pin SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}"/>
    <circle cx="16" cy="16" r="7" fill="#0d0f14"/>
  </svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

/* ─────────────────────────────────────────────────────
   CREATE MARKERS
   ─────────────────────────────────────────────────── */
function createMarkers() {
  MURALS.forEach(mural => {
    const marker = new google.maps.Marker({
      position: { lat: mural.lat, lng: mural.lng },
      map,
      title: mural.title,
      icon: {
        url: markerSVG("#f7b731"),
        scaledSize: new google.maps.Size(32, 42),
        anchor: new google.maps.Point(16, 42),
      },
    });

    marker.addListener("click", () => {
      selectMural(mural, marker);
    });

    markers.push({ mural, marker });
  });
}

/* ─────────────────────────────────────────────────────
   SELECT MURAL — open info panel
   ─────────────────────────────────────────────────── */
function selectMural(mural, marker) {
  // Reset previous active marker
  markers.forEach(m => {
    m.marker.setIcon({ url: markerSVG("#f7b731"), scaledSize: new google.maps.Size(32, 42), anchor: new google.maps.Point(16, 42) });
    m.marker.setZIndex(1);
  });

  // Highlight active marker
  marker.setIcon({ url: markerSVG("#2ec4b6"), scaledSize: new google.maps.Size(38, 50), anchor: new google.maps.Point(19, 50) });
  marker.setZIndex(999);

  // Pan map
  map.panTo({ lat: mural.lat - 0.005, lng: mural.lng });

  activeMural = mural;
  populateInfoPanel(mural);
  openInfoPanel();
}

/* ─────────────────────────────────────────────────────
   POPULATE INFO PANEL
   ─────────────────────────────────────────────────── */
function populateInfoPanel(mural) {
  // Image with shimmer load
  const img = document.getElementById("info-image");
  img.classList.add("shimmer");
  img.src = "";
  const tempImg = new Image();
  tempImg.onload = () => {
    img.src = mural.image;
    img.classList.remove("shimmer");
  };
  tempImg.onerror = () => {
    img.src = "https://via.placeholder.com/800x400/1b1f2b/7a8099?text=No+Image";
    img.classList.remove("shimmer");
  };
  tempImg.src = mural.image;

  document.getElementById("info-year-badge").textContent = mural.year;
  document.getElementById("info-title").textContent = mural.title;
  document.getElementById("info-artist").innerHTML = `By <strong>${mural.artist}</strong>`;
  document.getElementById("info-address-text").textContent = mural.address;
  document.getElementById("info-description").textContent = mural.description;

  // Tags
  const tagsEl = document.getElementById("info-tags");
  tagsEl.innerHTML = mural.tags.map(t => `<span class="info-tag">${t}</span>`).join("");

  // Update Street View button title
  document.getElementById("sv-modal-title").textContent = `Street View — ${mural.title}`;
  document.getElementById("transit-modal-title").textContent = `Plan Visit — ${mural.title}`;
}

/* ─────────────────────────────────────────────────────
   INFO PANEL OPEN / CLOSE
   ─────────────────────────────────────────────────── */
function openInfoPanel() {
  document.getElementById("info-panel").classList.add("visible");
  infoOpen = true;
}
function closeInfoPanel() {
  document.getElementById("info-panel").classList.remove("visible");
  // Deselect marker
  markers.forEach(m => {
    m.marker.setIcon({ url: markerSVG("#f7b731"), scaledSize: new google.maps.Size(32, 42), anchor: new google.maps.Point(16, 42) });
    m.marker.setZIndex(1);
  });
  activeMural = null;
  infoOpen = false;
}

/* ─────────────────────────────────────────────────────
   STREET VIEW MODAL
   ─────────────────────────────────────────────────── */
function openStreetView(mural) {
  const svClient = new google.maps.StreetViewService();
  const location = { lat: mural.lat, lng: mural.lng };

  svClient.getPanorama({ location, radius: 100, source: google.maps.StreetViewSource.OUTDOOR }, (data, status) => {
    const modal    = document.getElementById("sv-modal");
    const panoEl   = document.getElementById("sv-panorama");
    const fallback = document.getElementById("sv-fallback");

    if (status === google.maps.StreetViewStatus.OK) {
      fallback.classList.add("hidden");
      panoEl.style.display = "block";

      panorama = new google.maps.StreetViewPanorama(panoEl, {
        position: data.location.latLng,
        pov: { heading: 34, pitch: 0 },
        zoom: 1,
        addressControl: false,
        fullscreenControl: false,
      });
    } else {
      panoEl.style.display = "none";
      fallback.classList.remove("hidden");
      const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${mural.lat},${mural.lng}`;
      document.getElementById("sv-gmaps-link").href = mapsUrl;
    }

    showModal("sv-modal");
  });
}

/* ─────────────────────────────────────────────────────
   TRANSIT / DIRECTIONS MODAL
   ─────────────────────────────────────────────────── */
function openTransitModal(mural) {
  document.getElementById("transit-origin").value = "";
  document.getElementById("directions-panel").innerHTML = "";
  showModal("transit-modal");
}

function getDirections() {
  if (!activeMural) return;
  const origin = document.getElementById("transit-origin").value.trim();
  if (!origin) {
    document.getElementById("transit-origin").style.borderColor = "#e84855";
    setTimeout(() => { document.getElementById("transit-origin").style.borderColor = ""; }, 1500);
    return;
  }

  const destination = activeMural.address;
  const travelMode  = google.maps.TravelMode[transitMode];

  directionsService.route({
    origin,
    destination,
    travelMode,
    provideRouteAlternatives: false,
  }, (result, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(result);
    } else {
      document.getElementById("directions-panel").innerHTML =
        `<p style="color:#e84855; margin-top:10px">Could not find directions. Try a different address or travel mode.</p>`;
    }
  });
}

/* ─────────────────────────────────────────────────────
   MODAL HELPERS
   ─────────────────────────────────────────────────── */
function showModal(id) {
  document.getElementById("modal-backdrop").classList.remove("hidden");
  document.getElementById(id).classList.add("visible");
}
function hideModal(id) {
  document.getElementById(id).classList.remove("visible");
  // Hide backdrop only if no other modal is open
  const anyOpen = document.querySelector(".modal.visible");
  if (!anyOpen) document.getElementById("modal-backdrop").classList.add("hidden");
}
function hideAllModals() {
  document.querySelectorAll(".modal").forEach(m => m.classList.remove("visible"));
  document.getElementById("modal-backdrop").classList.add("hidden");
}

/* ─────────────────────────────────────────────────────
   FILTER LOGIC
   ─────────────────────────────────────────────────── */
function applyFilters() {
  const { year, borough, school, search } = activeFilters;
  let visible = 0;

  markers.forEach(({ mural, marker }) => {
    const matchYear    = year    === "all" || String(mural.year)    === year;
    const matchBorough = borough === "all" || mural.borough         === borough;
    const matchSchool  = school  === "all" || mural.school          === school;
    const searchTerm   = search.toLowerCase();
    const matchSearch  = !searchTerm ||
      mural.title.toLowerCase().includes(searchTerm) ||
      mural.artist.toLowerCase().includes(searchTerm) ||
      mural.borough.toLowerCase().includes(searchTerm) ||
      mural.address.toLowerCase().includes(searchTerm) ||
      mural.tags.some(t => t.toLowerCase().includes(searchTerm));

    const show = matchYear && matchBorough && matchSchool && matchSearch;
    marker.setVisible(show);
    if (show) visible++;
  });

  document.getElementById("visible-count").textContent = visible;
}

/* ─────────────────────────────────────────────────────
   PILL GROUP HELPER
   ─────────────────────────────────────────────────── */
function bindPillGroup(groupId, filterKey, singleSelect = true) {
  const group = document.getElementById(groupId);
  group.querySelectorAll(".pill").forEach(pill => {
    pill.addEventListener("click", () => {
      if (singleSelect) {
        group.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        activeFilters[filterKey] = pill.dataset.value;
      }
      applyFilters();
    });
  });
}

/* ─────────────────────────────────────────────────────
   BIND ALL UI
   ─────────────────────────────────────────────────── */
function bindUI() {
  // Pill groups
  bindPillGroup("year-group",    "year");
  bindPillGroup("borough-group", "borough");
  bindPillGroup("school-group",  "school");

  // Mural view opacity (cosmetic — affects nothing on map, just a visual filter)
  document.getElementById("view-group").querySelectorAll(".pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.getElementById("view-group").querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      // Future hook: adjust image opacity / map style
    });
  });

  // Search
  document.getElementById("search-input").addEventListener("input", e => {
    activeFilters.search = e.target.value;
    applyFilters();
  });

  // Reset
  document.getElementById("reset-btn").addEventListener("click", () => {
    activeFilters = { year: "all", borough: "all", school: "all", search: "" };
    document.getElementById("search-input").value = "";
    // Reset pills
    ["year-group", "borough-group", "school-group", "view-group"].forEach(gid => {
      const g = document.getElementById(gid);
      g.querySelectorAll(".pill").forEach((p, i) => { p.classList.toggle("active", i === 0); });
    });
    applyFilters();
    map.setCenter({ lat: 40.7282, lng: -73.9442 });
    map.setZoom(12);
    if (infoOpen) closeInfoPanel();
  });

  // Sidebar toggle
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
  });

  // Info panel close
  document.getElementById("info-close").addEventListener("click", closeInfoPanel);

  // Street View button
  document.getElementById("street-view-btn").addEventListener("click", () => {
    if (activeMural) openStreetView(activeMural);
  });

  // Share button
  document.getElementById("share-btn").addEventListener("click", () => {
    if (!activeMural) return;
    const url = `https://maps.google.com/?q=${activeMural.lat},${activeMural.lng}`;
    if (navigator.share) {
      navigator.share({ title: activeMural.title, text: activeMural.address, url });
    } else {
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById("share-btn");
        btn.innerHTML = "<span>✓</span> Copied!";
        setTimeout(() => { btn.innerHTML = "<span>↗</span> Share"; }, 2000);
      });
    }
  });

  // Address / Transit button
  document.getElementById("info-address").addEventListener("click", () => {
    if (activeMural) openTransitModal(activeMural);
  });

  // Transit mode pills
  document.querySelectorAll(".transit-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".transit-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      transitMode = btn.dataset.mode;
    });
  });

  // Transit Go button
  document.getElementById("transit-go-btn").addEventListener("click", getDirections);
  document.getElementById("transit-origin").addEventListener("keydown", e => {
    if (e.key === "Enter") getDirections();
  });

  // Modal closes
  document.getElementById("sv-close").addEventListener("click", () => hideModal("sv-modal"));
  document.getElementById("transit-close").addEventListener("click", () => hideModal("transit-modal"));
  document.getElementById("modal-backdrop").addEventListener("click", hideAllModals);

  // Fullscreen
  document.getElementById("fullscreen-btn").addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Tour cards
  document.querySelectorAll(".tour-card").forEach(card => {
    card.addEventListener("click", () => {
      const tourKey = card.dataset.tour;
      const ids = TOURS[tourKey];
      if (!ids) return;

      // Reset filters
      activeFilters = { year: "all", borough: "all", school: "all", search: "" };

      // Show only tour murals
      markers.forEach(({ mural, marker }) => {
        const show = ids.includes(mural.id);
        marker.setVisible(show);
      });
      document.getElementById("visible-count").textContent = ids.length;

      // Fit map to tour markers
      const bounds = new google.maps.LatLngBounds();
      markers.filter(({ mural }) => ids.includes(mural.id)).forEach(({ mural }) => {
        bounds.extend({ lat: mural.lat, lng: mural.lng });
      });
      map.fitBounds(bounds, { padding: 80 });
    });
  });

  // Keyboard: Escape closes panels
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (document.querySelector(".modal.visible")) { hideAllModals(); return; }
      if (infoOpen) closeInfoPanel();
    }
  });
}

/* ─────────────────────────────────────────────────────
   Guard: if Google Maps doesn't load (no API key),
   show a helpful message instead of a blank screen.
   ─────────────────────────────────────────────────── */
window.addEventListener("load", () => {
  setTimeout(() => {
    if (typeof google === "undefined") {
      document.getElementById("map").innerHTML = `
        <div style="
          display:flex; flex-direction:column; align-items:center;
          justify-content:center; height:100%; gap:16px;
          font-family:'Syne',sans-serif; color:#7a8099; text-align:center;
          padding:40px;
        ">
          <div style="font-size:48px">🗺️</div>
          <h2 style="color:#e8e8e8; font-size:20px">Google Maps API Key Required</h2>
          <p style="max-width:400px; line-height:1.6;">
            Open <code style="color:#f7b731">index.html</code> and replace
            <code style="color:#f7b731">YOUR_API_KEY</code> in the
            Google Maps script tag at the bottom with your actual
            <a href="https://developers.google.com/maps/documentation/javascript/get-api-key"
               style="color:#2ec4b6" target="_blank">Google Maps API key</a>.
          </p>
          <p style="font-size:12px; color:#4a5068;">
            Required APIs: Maps JavaScript API · Street View API · Directions API · Places API
          </p>
        </div>`;
    }
  }, 3000);
});
