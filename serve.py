#!/usr/bin/env python3
"""BlockNet serve.py — HTTP local. Uso: python3 serve.py [porta] (padrão 8080). Rode DENTRO de Projects/BlockNet."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class H(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ttf': 'font/ttf',
        '.html': 'text/html; charset=utf-8',
    }
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
srv = ThreadingHTTPServer(('127.0.0.1', port), H)
print('BlockNet em http://127.0.0.1:%d/  (Ctrl+C para parar)' % port)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
