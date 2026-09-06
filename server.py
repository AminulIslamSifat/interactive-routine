#!/usr/bin/env python3
"""Interactive Routine — Class Routine, Schedule, Personal Routine.
Pure stdlib. No deps. Single entry point."""

import json
import sys
import time
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# Live schedule source (phantom_bot on Render). MongoDB creds stay server-side there.
SCHEDULE_API = "https://phantom-bot-1-yn9t.onrender.com/panel/api/public/schedule"
_schedule_cache = {"data": None, "expires_at": 0.0}
SCHEDULE_TTL = 300  # seconds
CONNECTCSE_BASE = "https://connectcse.ruet.ac.bd"


def fetch_live_schedules() -> list:
    """Fetch schedule docs from phantom_bot and map to app shape {date,time,title,content}."""
    now = time.time()
    if _schedule_cache["data"] is not None and _schedule_cache["expires_at"] > now:
        return _schedule_cache["data"]

    mapped: list = []
    try:
        with urllib.request.urlopen(SCHEDULE_API, timeout=10) as resp:
            docs = json.loads(resp.read())
        for d in docs:
            parts = [d.get("teacher") or "", d.get("topic") or "", d.get("syllabus") or ""]
            mapped.append({
                "date": d.get("date") or "",
                "time": d.get("time") or "",
                "title": f"{d.get('type') or ''}: {d.get('subject') or ''}".strip(": "),
                "content": " • ".join(p for p in parts if p),
            })
        _schedule_cache["data"] = mapped
        _schedule_cache["expires_at"] = now + SCHEDULE_TTL
    except Exception as e:
        print(f"[schedule] live fetch failed: {e}")
    return mapped


# ─── Helpers ───────────────────────────────────────────────

def read_json(path: Path, default=None):
    if path.exists():
        return json.loads(path.read_text())
    return default if default is not None else {}


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


# ─── API Handlers ──────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]  # strip query for matching

        # Config
        if path == "/api/config":
            return self._json(read_json(DATA / "config.json"))

        # Available semesters/sections (before /api/routine to avoid prefix collision)
        if path == "/api/routines/index":
            return self._json(self._routines_index())

        # Check for newer schedule IDs on ConnectCSE
        if path == "/api/routines/check-update":
            return self._json(self._check_schedule_update())

        # Routine: /api/routine?year=2&sem=1&section=A
        if path == "/api/routine":
            params = dict(p.split("=", 1) for p in self.path.split("?")[1].split("&")) if "?" in self.path else {}
            fname = f"{params.get('year','?')}-{params.get('sem','?')}-{params.get('section','?')}.json"
            routine = read_json(DATA / "routines" / fname, None)
            if routine is None:
                return self._json({"error": "not found"}, 404)
            return self._json(routine)

        # Schedule: /api/schedule?month=2026-09  (live from phantom_bot, local fallback)
        if path == "/api/schedule":
            params = dict(p.split("=", 1) for p in self.path.split("?")[1].split("&")) if "?" in self.path else {}
            month = params.get("month", "")
            schedules = fetch_live_schedules()
            if not schedules:
                schedules = read_json(DATA / "schedules.json", [])
            if month:
                schedules = [s for s in schedules if s.get("date", "").startswith(month)]
            return self._json(schedules)

        # Personal routine
        if path == "/api/personal":
            return self._json(read_json(DATA / "personal.json", {"items": []}))

        super().do_GET()

    def do_POST(self):
        body = self._body()

        # Save config (first login)
        if self.path == "/api/config":
            write_json(DATA / "config.json", body)
            return self._json(body, 201)

        # Add personal item
        if self.path == "/api/personal/items":
            data = read_json(DATA / "personal.json", {"items": []})
            body["id"] = max((i.get("id", 0) for i in data["items"]), default=0) + 1
            data["items"].append(body)
            write_json(DATA / "personal.json", data)
            return self._json(body, 201)

        # Save cookie
        if self.path == "/api/settings/cookie":
            cookie = body.get("cookie", "")
            if cookie:
                (DATA / ".cookie").write_text(cookie.strip())
            return self._json({"ok": True})

        # Re-scrape routines
        if self.path == "/api/settings/refresh":
            import subprocess
            schedule_id = str(body.get("scheduleId", 4))
            try:
                result = subprocess.run(
                    [sys.executable, str(ROOT / "scraper.py"), "--schedule-id", schedule_id],
                    capture_output=True, text=True, timeout=30
                )
                if result.returncode == 0:
                    # Save the schedule ID used
                    cfg = read_json(DATA / "config.json", {})
                    cfg["lastScheduleId"] = int(schedule_id)
                    write_json(DATA / "config.json", cfg)
                    return self._json({"message": "Routines updated!"})
                return self._json({"message": f"Error: {result.stderr[:100]}"}, 500)
            except Exception as e:
                return self._json({"message": str(e)}, 500)

        self._json({"error": "not found"}, 404)

    def do_PUT(self):
        body = self._body()

        # Update config
        if self.path == "/api/config":
            cfg = read_json(DATA / "config.json", {})
            cfg.update(body)
            write_json(DATA / "config.json", cfg)
            return self._json(cfg)

        # Update personal item: /api/personal/items/3
        if self.path.startswith("/api/personal/items/"):
            item_id = int(self.path.split("/")[-1])
            data = read_json(DATA / "personal.json", {"items": []})
            for i, item in enumerate(data["items"]):
                if item["id"] == item_id:
                    data["items"][i] = {**item, **body, "id": item_id}
                    write_json(DATA / "personal.json", data)
                    return self._json(data["items"][i])
            return self._json({"error": "not found"}, 404)

        self._json({"error": "not found"}, 404)

    def do_DELETE(self):
        # Delete personal item
        if self.path.startswith("/api/personal/items/"):
            item_id = int(self.path.split("/")[-1])
            data = read_json(DATA / "personal.json", {"items": []})
            data["items"] = [i for i in data["items"] if i["id"] != item_id]
            write_json(DATA / "personal.json", data)
            return self._json({"ok": True})

        self._json({"error": "not found"}, 404)

    # ─── Internal ──────────────────────────────────────────

    def _check_schedule_update(self) -> dict:
        """Probe ConnectCSE to find the latest schedule ID."""
        cfg = read_json(DATA / "config.json", {})
        current_id = cfg.get("lastScheduleId", 4)
        latest_id = current_id
        try:
            cookie = ""
            cookie_file = DATA / ".cookie"
            if cookie_file.exists():
                cookie = cookie_file.read_text().strip()
            req = urllib.request.Request(
                f"{CONNECTCSE_BASE}/class-schedule/published",
                headers={"User-Agent": "Mozilla/5.0", "Cookie": cookie},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode()
            import re
            ids = re.findall(r'/class-schedule/(\d+)', html)
            if ids:
                latest_id = max(int(i) for i in ids)
        except Exception as e:
            print(f"[check-update] probe failed: {e}")
            # Fallback: sequential probe with redirect detection
            import re as _re
            for test_id in range(current_id + 1, current_id + 4):
                try:
                    req = urllib.request.Request(
                        f"{CONNECTCSE_BASE}/class-schedule/{test_id}",
                        headers={"User-Agent": "Mozilla/5.0", "Cookie": cookie},
                    )
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        body = resp.read().decode()
                        # Only count as valid if page has schedule content, not login redirect
                        if 'slot-cell' in body or 'day-header' in body:
                            latest_id = test_id
                        else:
                            break
                except Exception:
                    break
        return {"latest": latest_id, "current": current_id, "hasUpdate": latest_id > current_id}

    def _routines_index(self) -> dict:
        """Scan routines/ folder, return {year-sem: [sections]}."""
        routines_dir = DATA / "routines"
        if not routines_dir.exists():
            return {}
        index: dict[str, list[str]] = {}
        for f in sorted(routines_dir.glob("*.json")):
            parts = f.stem.split("-")
            if len(parts) == 3:
                key = f"{parts[0]}-{parts[1]}"
                index.setdefault(key, []).append(parts[2])
        return index

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


if __name__ == "__main__":
    import os
    os.chdir(ROOT / "static")
    server = HTTPServer(("", PORT), Handler)
    print(f"🚀 http://localhost:{PORT}")
    server.serve_forever()
