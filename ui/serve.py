"""Static file server for the console.

The console is plain HTML and ES modules with no build step, but it reads
`contracts/`, `engine/samples/`, `validation/` and `ui/data/` by path, so it has
to be served from the repository root rather than opened as a file:// URL
(modules are blocked from file:// by CORS in every browser).

    python ui/serve.py            # http://localhost:8777/ui/
    python ui/serve.py --port 9000

Playback is entirely offline. This serves files and nothing else; the live human
seat is a separate process, `python ui/server/bridge.py`.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import webbrowser
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    """No-cache, and the couple of MIME types the default table gets wrong."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".jsonl": "application/x-ndjson",
        ".md": "text/markdown; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
    }

    def end_headers(self) -> None:
        # A demo where the browser serves yesterday's log from cache is a demo
        # that wastes ten minutes finding out why.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--no-open", action="store_true", help="do not open a browser")
    args = ap.parse_args()

    handler = functools.partial(Handler, directory=str(REPO))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://localhost:{args.port}/ui/"
        print(f"serving {REPO} at {url}")
        print("Ctrl-C to stop")
        if not args.no_open:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()


if __name__ == "__main__":
    main()
