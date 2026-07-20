(function() {
  if (!window.L) {
    console.error('Leaflet is required for the free-map fallback.');
    return;
  }

  const L = window.L;
  const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const OSM_ATTR = '&copy; OpenStreetMap contributors';

  function toLeafletLatLng(value) {
    if (Array.isArray(value)) {
      return [Number(value[0]), Number(value[1])];
    }
    if (value && typeof value.lat === 'function') {
      return [value.lat(), value.lng()];
    }
    if (value && typeof value.lat === 'number' && typeof value.lng === 'number') {
      return [value.lat, value.lng];
    }
    return [0, 0];
  }

  function normalizeLatLng(value) {
    if (!value) return { lat: 0, lng: 0 };
    if (Array.isArray(value)) {
      return { lat: Number(value[0]), lng: Number(value[1]) };
    }
    if (typeof value.lat === 'function') {
      return { lat: Number(value.lat()), lng: Number(value.lng()) };
    }
    if (typeof value.lat === 'number' && typeof value.lng === 'number') {
      return { lat: Number(value.lat), lng: Number(value.lng) };
    }
    return { lat: 0, lng: 0 };
  }

  function getMarkerIconSize(content) {
    if (!content || typeof content === 'string') {
      return [24, 24];
    }

    const className = content.className || '';
    if (className.includes('marker-highlight')) return [44, 44];
    if (className.includes('marker-number')) return [36, 36];
    if (className.includes('marker-cluster')) return [40, 40];
    if (className.includes('marker-dot')) return [24, 24];

    const width = Number(content.offsetWidth) || 24;
    const height = Number(content.offsetHeight) || 24;
    return [Math.max(20, width), Math.max(20, height)];
  }

  function metersToMiles(meters) {
    const miles = (Number(meters) || 0) / 1609.344;
    return (Math.round(miles * 10) / 10).toFixed(1);
  }

  function durationLabel(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const mins = Math.round(totalSeconds / 60);
    return `${mins} min`;
  }

  function walkGeoJsonCoordinates(coords, callback) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      callback({ lat: Number(coords[1]), lng: Number(coords[0]) });
      return;
    }

    coords.forEach((item) => walkGeoJsonCoordinates(item, callback));
  }

  function wrapGeoJsonFeature(feature) {
    const geometry = feature && feature.geometry ? feature.geometry : null;
    return {
      ...feature,
      getProperty(name) {
        return feature && feature.properties ? feature.properties[name] : null;
      },
      getGeometry() {
        return {
          forEachLatLng(callback) {
            if (typeof callback !== 'function') return;
            walkGeoJsonCoordinates(geometry && geometry.coordinates, callback);
          }
        };
      }
    };
  }

  function latLngToGoogle(value) {
    if (!value) return null;
    if (typeof value.lat === 'function') {
      return new google.maps.LatLng(value.lat(), value.lng());
    }
    return new google.maps.LatLng(value[0], value[1]);
  }

  const google = window.google || { maps: {} };
  google.maps = google.maps || {};

  class LatLng {
    constructor(lat, lng) {
      this.latValue = Number(lat);
      this.lngValue = Number(lng);
    }
    lat() { return this.latValue; }
    lng() { return this.lngValue; }
    toJSON() { return { lat: this.latValue, lng: this.lngValue }; }
  }

  class LatLngBounds {
    constructor(sw, ne) {
      this._sw = sw || new LatLng(-90, -180);
      this._ne = ne || new LatLng(90, 180);
    }
    extend(value) {
      const ll = value && value.lat && value.lng ? value : new LatLng(value[0], value[1]);
      const lat = ll.lat();
      const lng = ll.lng();
      this._sw = new LatLng(Math.min(this._sw.lat(), lat), Math.min(this._sw.lng(), lng));
      this._ne = new LatLng(Math.max(this._ne.lat(), lat), Math.max(this._ne.lng(), lng));
      return this;
    }
    getCenter() {
      return new LatLng((this._sw.lat() + this._ne.lat()) / 2, (this._sw.lng() + this._ne.lng()) / 2);
    }
    toLeaflet() {
      return [
        [this._sw.lat(), this._sw.lng()],
        [this._ne.lat(), this._ne.lng()]
      ];
    }
  }

  class Map {
    constructor(element, options = {}) {
      this._element = element;
      this._options = options;
      this._listeners = {};
      this._dataLayers = [];
      this._map = L.map(element, {
        zoomControl: options.zoomControl !== false,
        zoomSnap: 0.5,
        scrollWheelZoom: true,
        attributionControl: true,
        gestureHandling: options.gestureHandling || 'auto'
      }).setView(toLeafletLatLng(options.center || [40.7128, -74.006]), options.zoom || 11);

      this._tileLayer = L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTR }).addTo(this._map);
      this.data = {
        _layer: null,
        _style: null,
        _listener: null,
        loadGeoJson: (url) => {
          return fetch(url)
            .then(response => response.json())
            .then(geojson => {
              this._dataLayers.forEach(layer => this._map.removeLayer(layer));
              const layer = L.geoJSON(geojson, {
                style: this.data._style || { color: '#60a5fa', weight: 1.5, fillOpacity: 0 }
              });
              this._dataLayers.push(layer);
              layer.addTo(this._map);
              if (this.data._listener) {
                layer.eachLayer((item) => {
                  const feature = wrapGeoJsonFeature(item.feature || { properties: {} });
                  this.data._listener({ feature });
                });
              }
            });
        },
        setStyle: (style) => {
          this.data._style = style;
          this._dataLayers.forEach(layer => layer.setStyle(style));
        },
        addListener: (eventName, cb) => {
          this.data._listener = cb;
        }
      };
    }

    addListener(eventName, cb) {
      const handler = (evt) => cb(evt);
      this._listeners[eventName] = this._listeners[eventName] || [];
      this._listeners[eventName].push(handler);
      this._map.on(eventName, handler);
    }

    setOptions(options) {
      this._options = { ...this._options, ...options };
      if (options.backgroundColor) {
        this._element.style.background = options.backgroundColor;
      }
    }

    getZoom() {
      return this._map.getZoom();
    }

    fitBounds(bounds) {
      const leafletBounds = bounds && bounds.toLeaflet ? bounds.toLeaflet() : bounds;
      if (leafletBounds) {
        this._map.fitBounds(leafletBounds, { padding: [40, 40] });
      }
    }

    getBounds() {
      const bounds = this._map.getBounds();
      return new LatLngBounds(
        new LatLng(bounds.getSouthWest().lat, bounds.getSouthWest().lng),
        new LatLng(bounds.getNorthEast().lat, bounds.getNorthEast().lng)
      );
    }

    setZoom(zoom) {
      this._map.setZoom(zoom);
    }

    panTo(latLng) {
      this._map.panTo(toLeafletLatLng(latLng));
    }

    addLayer(layer) {
      layer.addTo(this._map);
    }

    getLeafletMap() {
      return this._map;
    }
  }

  class Marker {
    constructor(config) {
      const content = config.content;
      const position = config.position || { lat: 0, lng: 0 };
      const iconHtml = content && content.outerHTML ? content.outerHTML : content || '';
      const iconSize = getMarkerIconSize(content);
      const icon = L.divIcon({
        className: 'mural-leaflet-marker',
        html: iconHtml,
        iconSize,
        iconAnchor: [iconSize[0] / 2, iconSize[1] / 2]
      });
      this._marker = L.marker(toLeafletLatLng(position), { icon, title: config.title || '' });
      this._listeners = {};
      this._map = config.map || null;
      this._marker.on('click', () => {
        const listeners = this._listeners['gmp-click'] || [];
        listeners.forEach(fn => fn(this));
      });
      if (this._map) {
        this.setMap(this._map);
      }
    }

    addListener(eventName, callback) {
      this._listeners[eventName] = this._listeners[eventName] || [];
      this._listeners[eventName].push(callback);
    }

    setMap(map) {
      this._map = map;
      if (map) {
        if (map.getLeafletMap) {
          this._marker.addTo(map.getLeafletMap());
        } else if (map._map) {
          this._marker.addTo(map._map);
        }
      } else if (this._marker._map) {
        this._marker.remove();
      }
    }

    trigger(eventName) {
      const listeners = this._listeners[eventName] || [];
      listeners.forEach(fn => fn(this));
    }
  }

  class Circle {
    constructor(config) {
      this._circle = L.circle(toLeafletLatLng(config.center || config.position || [0, 0]), {
        radius: config.radius || 50,
        color: config.strokeColor || '#38bdf8',
        weight: config.strokeWeight || 1,
        opacity: config.strokeOpacity || 1,
        fillColor: config.fillColor || '#60a5fa',
        fillOpacity: config.fillOpacity || 0.2
      });
      this._map = config.map || null;
      if (this._map) {
        this.setMap(this._map);
      }
    }

    setMap(map) {
      this._map = map;
      if (map) {
        if (map.getLeafletMap) {
          this._circle.addTo(map.getLeafletMap());
        } else if (map._map) {
          this._circle.addTo(map._map);
        }
      } else if (this._circle._map) {
        this._circle.remove();
      }
    }
  }

  class Polyline {
    constructor(config) {
      this._polyline = L.polyline((config.path || []).map(point => toLeafletLatLng(point)), {
        color: config.strokeColor || '#3b82f6',
        opacity: config.strokeOpacity || 0.8,
        weight: config.strokeWeight || 5
      });
      this._map = config.map || null;
      if (this._map) {
        this.setMap(this._map);
      }
    }

    setMap(map) {
      this._map = map;
      if (map) {
        if (map.getLeafletMap) {
          this._polyline.addTo(map.getLeafletMap());
        } else if (map._map) {
          this._polyline.addTo(map._map);
        }
      } else if (this._polyline._map) {
        this._polyline.remove();
      }
    }
  }

  class InfoWindow {
    constructor() {
      this._popup = null;
      this._content = '';
    }
    open(map, marker) {
      const anchor = marker && marker._marker ? marker._marker : null;
      this._popup = L.popup().setContent(this._content);
      if (anchor) {
        this._popup.setLatLng(anchor.getLatLng());
        this._popup.openOn(map.getLeafletMap());
      }
    }
    close() {
      if (this._popup && this._popup._map) {
        this._popup.remove();
      }
    }
    setContent(content) {
      this._content = content;
    }
  }

  class Geocoder {
    async geocode(request, callback) {
      const location = request && request.location;
      const address = request && request.address;

      try {
        if (location) {
          const params = new URLSearchParams({
            lat: String(Number(location.lat)),
            lon: String(Number(location.lng))
          });
          const response = await fetch(`/reverse-geocode?${params.toString()}`);
          const json = await response.json();
          const results = (json.results || []).map(item => ({
            formatted_address: item.formatted_address || 'Location coordinates only'
          }));
          if (typeof callback === 'function') {
            callback(results, 'OK');
          }
          return { results };
        }

        if (address) {
          const params = new URLSearchParams({ address: String(address) });
          const response = await fetch(`/geocode?${params.toString()}`);
          const json = await response.json();
          const results = (json.results || []).map(item => ({
            formatted_address: item.formatted_address,
            geometry: {
              location: {
                lat: () => Number(item.geometry?.location?.lat?.()),
                lng: () => Number(item.geometry?.location?.lng?.())
              }
            }
          }));
          if (typeof callback === 'function') {
            callback(results, 'OK');
          }
          return { results };
        }

        if (typeof callback === 'function') {
          callback([], 'ZERO_RESULTS');
        }
        return { results: [] };
      } catch (error) {
        console.error('Leaflet geocoder proxy failed:', error);
        if (typeof callback === 'function') {
          callback([], 'ERROR');
        }
        return { results: [] };
      }
    }
  }

  class DirectionsService {
    route(req, callback) {
      const origin = normalizeLatLng(req.origin);
      const destination = normalizeLatLng(req.destination);
      const profile = req.travelMode === 'BICYCLING' ? 'cycling' : req.travelMode === 'WALKING' || req.travelMode === 'TRANSIT' ? 'foot' : 'driving';
      const modeLabel = req.travelMode === 'WALKING' ? 'Walk' : req.travelMode === 'BICYCLING' ? 'Bike' : req.travelMode === 'TRANSIT' ? 'Transit' : 'Drive';
      const waypoints = Array.isArray(req.waypoints) ? req.waypoints : [];
      const waypointCoordinates = waypoints
        .map((wp) => normalizeLatLng(wp.location || wp))
        .map(point => `${point.lng},${point.lat}`);

      const coordinates = [
        `${origin.lng},${origin.lat}`,
        ...waypointCoordinates,
        `${destination.lng},${destination.lat}`
      ].join(';');

      const url = `https://router.project-osrm.org/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=true`;

      fetch(url)
        .then(response => response.json())
        .then(data => {
          const route = data.routes && data.routes[0];
          if (!route) {
            callback({ routes: [] }, 'NOT_FOUND');
            return;
          }

          const routeDistanceMeters = Number(route.distance) || 0;
          const routeDurationSeconds = Number(route.duration) || 0;
          const stepDistanceMeters = routeDistanceMeters;
          const leg = {
            duration: { value: Math.round(routeDurationSeconds), text: durationLabel(routeDurationSeconds) },
            distance: { value: routeDistanceMeters, text: `${metersToMiles(routeDistanceMeters)} mi` },
            start_location: origin,
            end_location: destination,
            steps: [{
              distance: { value: stepDistanceMeters, text: `${metersToMiles(stepDistanceMeters)} mi` },
              duration: { value: Math.round(routeDurationSeconds), text: durationLabel(routeDurationSeconds) },
              start_location: origin,
              end_location: destination,
              instructions: `${modeLabel} route`,
              travel_mode: req.travelMode || 'DRIVING'
            }]
          };

          const routeResponse = {
            routes: [{
              legs: [leg],
              summary: route.summary || `${modeLabel} route`,
              duration: routeDurationSeconds,
              distance: routeDistanceMeters,
              geometry: route.geometry || { type: 'LineString', coordinates: [] }
            }]
          };

          callback(routeResponse, 'OK');
        })
        .catch(() => callback({ routes: [] }, 'ERROR'));
    }
  }

  class DirectionsRenderer {
    constructor(config) {
      this._map = config.map;
      this._route = config.directions;
      this._routeIndex = config.routeIndex || 0;
      this._polylineOptions = config.polylineOptions || {};
      this._layer = null;
    }

    setMap(map) {
      this._map = map;
      if (!map) {
        if (this._layer) this._layer.remove();
        return;
      }
    }

    setDirections(response) {
      this._route = response;
      this.render();
    }

    render() {
      if (!this._route || !this._route.routes || !this._route.routes[this._routeIndex]) return;
      const route = this._route.routes[this._routeIndex];
      const coords = route.geometry && route.geometry.coordinates ? route.geometry.coordinates.map(([lng, lat]) => [lat, lng]) : [];
      if (!coords.length) return;
      if (this._layer) this._layer.remove();
      this._layer = L.polyline(coords, {
        color: this._polylineOptions.strokeColor || '#3b82f6',
        opacity: this._polylineOptions.strokeOpacity || 0.8,
        weight: this._polylineOptions.strokeWeight || 5
      });
      this._layer.addTo(this._map.getLeafletMap());
    }
  }

  const markerClusterer = {
    __fallback: true,
    gridAlgorithm: {
      GridAlgorithm: class {
        constructor(options = {}) {
          this.radius = options.radius || 80;
          this.maxZoom = options.maxZoom || 14;
        }
      }
    },
    MarkerClusterer: class {
      constructor({ map, markers = [], algorithm, renderer }) {
        this._map = map;
        this._markers = Array.isArray(markers) ? markers : [];
        this._algorithm = algorithm || { radius: 80, maxZoom: 14 };
        this._renderer = renderer;
        this._clusters = [];
        this._clusterLayer = L.layerGroup();
        this._clusterLayer.addTo(map.getLeafletMap());
        this._renderClusters();
      }

      clearMarkers() {
        this._clusters.forEach((clusterMarker) => {
          if (clusterMarker && typeof clusterMarker.setMap === 'function') {
            clusterMarker.setMap(null);
          }
        });
        this._clusters = [];
        this._clusterLayer.clearLayers();
      }

      _renderClusters() {
        this.clearMarkers();
        const radius = Number(this._algorithm?.radius || 80);
        const groups = new Map();

        this._markers.forEach((marker) => {
          if (!marker || typeof marker.setMap !== 'function') return;
          if (marker._marker && marker._marker.getLatLng) {
            const ll = marker._marker.getLatLng();
            const latBucket = Math.round(ll.lat / (radius / 1000));
            const lngBucket = Math.round(ll.lng / (radius / 1000));
            const key = `${latBucket}:${lngBucket}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(marker);
          }
        });

        groups.forEach((members) => {
          const clusterPosition = members.reduce((acc, marker) => {
            const ll = marker._marker.getLatLng();
            acc.lat += ll.lat;
            acc.lng += ll.lng;
            return acc;
          }, { lat: 0, lng: 0 });

          const position = {
            lat: clusterPosition.lat / members.length,
            lng: clusterPosition.lng / members.length
          };
          const clusterMarker = this._renderer?.render?.({ count: members.length, position }) || null;
          if (clusterMarker && typeof clusterMarker.setMap === 'function') {
            clusterMarker.setMap(this._map);
            this._clusters.push(clusterMarker);
          }
        });
      }
    }
  };

  google.maps.LatLng = LatLng;
  google.maps.LatLngBounds = LatLngBounds;
  google.maps.Map = Map;
  google.maps.marker = google.maps.marker || {};
  google.maps.marker.AdvancedMarkerElement = Marker;
  google.maps.Circle = Circle;
  google.maps.Polyline = Polyline;
  google.maps.InfoWindow = InfoWindow;
  google.maps.Geocoder = Geocoder;
  google.maps.DirectionsService = DirectionsService;
  google.maps.DirectionsRenderer = DirectionsRenderer;
  google.maps.ControlPosition = { RIGHT_BOTTOM: 'rightbottom', LEFT_BOTTOM: 'leftbottom' };
  google.maps.SymbolPath = {
    CIRCLE: 'circle',
    FORWARD_CLOSED_ARROW: 'forward_closed_arrow'
  };
  google.maps.places = google.maps.places || { Autocomplete: function() { return { bindTo() {}, addListener() {} }; } };
  google.maps.event = google.maps.event || { trigger: function(marker, name) { if (marker && typeof marker.trigger === 'function') marker.trigger(name); } };
  google.maps.TravelMode = { TRANSIT: 'TRANSIT', WALKING: 'WALKING', DRIVING: 'DRIVING', BICYCLING: 'BICYCLING' };
  google.maps.TransitLayer = function() { return { setMap() {} }; };
  google.maps.StreetViewPanorama = function() { return { setVisible() {} }; };

  window.markerClusterer = markerClusterer;
  window.google = google;
})();
