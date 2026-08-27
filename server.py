import http.server
import json
import os
import urllib.parse
import urllib.request

PORT = 8000
STATS_FILE = 'stats.json'
APP_KEY = "4a6axv5v"
DB_KEY = "cyberleek_stats"

# Initialize stats file if not exists (starting with a baseline of 80 plays)
if not os.path.exists(STATS_FILE):
    with open(STATS_FILE, 'w') as f:
        json.dump({'totalPlays': 80, 'highscores': []}, f)

def load_stats_from_cloud():
    try:
        url = f"https://keyvalue.immanuel.co/api/KeyVal/GetValue/{APP_KEY}/{DB_KEY}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=4) as response:
            data = response.read().decode('utf-8')
            if data and data != "null" and data != '""':
                # Immanuel returns JSON serialized string wrapped in quotes
                hex_str = json.loads(data)
                # Decode from hex
                stats_str = bytes.fromhex(hex_str).decode('utf-8')
                parsed = json.loads(stats_str)
                # Keep baseline of at least 80 plays
                if parsed.get('totalPlays', 0) < 80:
                    parsed['totalPlays'] = 80
                return parsed
    except Exception as e:
        print("Error loading cloud stats:", e)
    
    # Fallback to local file
    try:
        with open(STATS_FILE, 'r') as f:
            parsed = json.load(f)
            if parsed.get('totalPlays', 0) < 80:
                parsed['totalPlays'] = 80
            return parsed
    except Exception:
        return {'totalPlays': 80, 'highscores': []}

def save_stats_to_cloud(stats):
    # Save locally first
    try:
        with open(STATS_FILE, 'w') as f:
            json.dump(stats, f, indent=4)
    except Exception as e:
        print("Error saving local stats:", e)
        
    # Save to cloud database using hex encoding (to bypass ASP.NET colon block)
    try:
        stats_str = json.dumps(stats)
        hex_str = stats_str.encode('utf-8').hex()
        url = f"https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/{APP_KEY}/{DB_KEY}/{hex_str}"
        req = urllib.request.Request(url, data=b"") # Empty data for POST
        with urllib.request.urlopen(req, timeout=4) as response:
            res = response.read().decode('utf-8')
            print("Saved to cloud KV database:", res)
    except Exception as e:
        print("Error saving cloud stats:", e)

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/stats':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            stats = load_stats_from_cloud()
            self.wfile.write(json.dumps(stats).encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/stats':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            stats = load_stats_from_cloud()
            
            # Update totalPlays if requested
            if 'incrementPlay' in data and data['incrementPlay']:
                stats['totalPlays'] += 1
            
            # Add new highscore if present
            if 'name' in data and 'score' in data:
                stats['highscores'].append({
                    'name': data['name'],
                    'score': int(data['score'])
                })
                # Sort highscores descending and keep top 10
                stats['highscores'].sort(key=lambda x: x['score'], reverse=True)
                stats['highscores'] = stats['highscores'][:10]
            
            # Save updated stats back to cloud database & local file
            save_stats_to_cloud(stats)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(stats).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    # Make sure we serve from the script's directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('0.0.0.0', PORT), CustomHandler)
    print(f"Serving on port {PORT} with Custom Cloud-backed API Handler...")
    server.serve_forever()
