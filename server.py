"""Static file server for AndysNote.

Serves the site with no-cache headers so browsers always revalidate and fetch
the latest files. This prevents the stale-cache problems that occur with the
default http.server (which lets browsers hold on to old JS via heuristic
caching)."""

import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"Serving AndysNote on 0.0.0.0:{PORT} (no-cache)")
        httpd.serve_forever()
