import http.server
import json
import os

PORT = 8000
STATS_FILE = 'stats.json'

# Initialize stats file if not exists
if not os.path.exists(STATS_FILE):
    with open(STATS_FILE, 'w') as f:
        json.dump({'totalPlays': 0, 'highscores': []}, f)

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/stats':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            with open(STATS_FILE, 'r') as f:
                self.wfile.write(f.read().encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/stats':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            with open(STATS_FILE, 'r+') as f:
                stats = json.load(f)
                
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
                
                f.seek(0)
                json.dump(stats, f, indent=4)
                f.truncate()
                
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
    print(f"Serving on port {PORT} with Custom API Handler...")
    server.serve_forever()
