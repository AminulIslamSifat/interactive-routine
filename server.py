#!/usr/bin/env python3
"""Minimal HTTP server for Interactive Routine Planner. Pure stdlib."""

import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

DATA_FILE = Path(__file__).parent / "data.json"
import sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


def load_data() -> list[dict]:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return []


def save_data(items: list[dict]) -> None:
    DATA_FILE.write_text(json.dumps(items, indent=2))


class Handler(SimpleHTTPRequestHandler):
    """Serves static files + JSON API for routine items."""

    def do_GET(self) -> None:
        if self.path == "/api/items":
            self._json_response(load_data())
        else:
            super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/items":
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            items = load_data()
            body["id"] = max((i.get("id", 0) for i in items), default=0) + 1
            items.append(body)
            save_data(items)
            self._json_response(body, 201)
        else:
            self._send(404, {"error": "not found"})

    def do_PUT(self) -> None:
        if self.path.startswith("/api/items/"):
            item_id = int(self.path.split("/")[-1])
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            items = load_data()
            for i, item in enumerate(items):
                if item["id"] == item_id:
                    items[i] = {**item, **body, "id": item_id}
                    save_data(items)
                    self._json_response(items[i])
                    return
            self._send(404, {"error": "item not found"})
        else:
            self._send(404, {"error": "not found"})

    def do_DELETE(self) -> None:
        if self.path.startswith("/api/items/"):
            item_id = int(self.path.split("/")[-1])
            items = [i for i in load_data() if i["id"] != item_id]
            save_data(items)
            self._json_response({"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def _json_response(self, data: dict | list, status: int = 200) -> None:
        self._send(status, data)

    def _send(self, status: int, data: dict | list) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


if __name__ == "__main__":
    os.chdir(Path(__file__).parent / "static")
    server = HTTPServer(("", PORT), Handler)
    print(f"🚀 Serving on http://localhost:{PORT}")
    server.serve_forever()
