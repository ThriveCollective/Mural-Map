"""
Simple HTTP server for running the Thrive Mural Map locally.
This is needed because browsers block fetch requests when opening HTML files directly (file:// protocol).

Usage:
    python server.py
    OR
    python3 server.py
    OR (on Windows) double-click server.bat

Then open http://localhost:8000 in your browser.
"""

import http.server
import socketserver
import webbrowser
import os
import urllib.parse
import urllib.request
import json

PORT = 8001

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to allow cross-origin requests
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == '/geocode':
            self.handle_geocode(parsed.query)
            return

        if parsed.path == '/reverse-geocode':
            self.handle_reverse_geocode(parsed.query)
            return

        super().do_GET()

    def handle_geocode(self, query_string):
        params = urllib.parse.parse_qs(query_string)
        address = params.get('address', [''])[0].strip()
        if not address:
            self.send_json_response({'error': 'Missing address'}, status=400)
            return

        url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(address)}&limit=5"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mural-Map-Local/1.0'})
            with urllib.request.urlopen(req, timeout=20) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception as exc:
            self.send_json_response({'error': str(exc)}, status=502)
            return

        features = payload.get('features', [])
        results = []
        for feature in features:
            properties = feature.get('properties', {})
            geometry = feature.get('geometry', {})
            coords = geometry.get('coordinates', [0, 0]) if geometry else [0, 0]
            if len(coords) < 2:
                continue
            results.append({
                'formatted_address': properties.get('name') or properties.get('street') or properties.get('city') or 'Unknown location',
                'geometry': {
                    'location': {
                        'lat': lambda lat=coords[1]: float(lat),
                        'lng': lambda lng=coords[0]: float(lng)
                    }
                }
            })

        self.send_json_response({'results': results})

    def handle_reverse_geocode(self, query_string):
        params = urllib.parse.parse_qs(query_string)
        lat = params.get('lat', [''])[0].strip()
        lng = params.get('lon', [''])[0].strip()
        if not lat or not lng:
            self.send_json_response({'error': 'Missing latitude/longitude'}, status=400)
            return

        url = f"https://photon.komoot.io/reverse?lat={urllib.parse.quote(lat)}&lon={urllib.parse.quote(lng)}&limit=1"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mural-Map-Local/1.0'})
            with urllib.request.urlopen(req, timeout=20) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception as exc:
            self.send_json_response({'error': str(exc)}, status=502)
            return

        features = payload.get('features', [])
        results = []
        for feature in features:
            properties = feature.get('properties', {})
            geometry = feature.get('geometry', {})
            coords = geometry.get('coordinates', [0, 0]) if geometry else [0, 0]
            if len(coords) < 2:
                continue
            results.append({
                'formatted_address': properties.get('label') or properties.get('name') or 'Location coordinates only'
            })

        self.send_json_response({'results': results})

    def send_json_response(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress default logging, or customize as needed
        pass

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"Starting server at {url}")
        print(f"Open {url} in your browser to view the map.")
        print("Press Ctrl+C to stop the server.")
        
        # Optionally open browser automatically
        try:
            webbrowser.open(url)
        except:
            pass
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()
