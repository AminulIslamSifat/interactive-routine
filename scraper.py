#!/usr/bin/env python3
"""Scrape ConnectCSE RUET class schedules into local JSON.
Usage: python scraper.py [--schedule-id 4] [--cookie "..."]
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
ROUTINES = DATA / "routines"
ROUTINES.mkdir(parents=True, exist_ok=True)

BASE = "https://connectcse.ruet.ac.bd"
COOKIE = ""

YEAR_MAP = {"1st": "1", "2nd": "2", "3rd": "3", "4th": "4"}
SEM_MAP = {"Odd": "1", "Even": "2"}
DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0",
        "Accept": "text/html,application/xhtml+xml",
        "Cookie": COOKIE,
        "Referer": f"{BASE}/class-schedule/published",
    })
    with urllib.request.urlopen(req) as resp:
        return resp.read().decode()


def parse_periods(html: str) -> list[str]:
    """Extract period times from the first table header."""
    # Match: 8:00am–8:50am style
    matches = re.findall(r'(\d{1,2}:\d{2}[ap]m\s*[–-]\s*\d{1,2}:\d{2}[ap]m)', html)
    # Deduplicate preserving order
    seen = set()
    periods = []
    for m in matches:
        clean = re.sub(r'\s+', '', m)
        if clean not in seen:
            seen.add(clean)
            periods.append(clean)
    return periods


def parse_day_table(table_html: str) -> list[dict]:
    """Parse one day's table into rows of slots."""
    rows = []
    # Split by <tr> in tbody
    tbody_match = re.search(r'<tbody>(.*?)</tbody>', table_html, re.DOTALL)
    if not tbody_match:
        return rows

    tbody = tbody_match.group(1)
    tr_blocks = re.split(r'<tr>', tbody)[1:]  # skip first empty

    for tr in tr_blocks:
        # Extract year, sem, section from row-header cells
        headers = re.findall(r'<td class="row-header">([^<]+)</td>', tr)
        if len(headers) < 3:
            continue
        year_str, sem_str, section = headers[0], headers[1], headers[2]
        year = YEAR_MAP.get(year_str.split()[0], "?")
        sem = SEM_MAP.get(sem_str, "?")

        # Extract slots
        slots = []
        # Find all td.slot-cell with optional colspan
        slot_pattern = re.compile(
            r'<td class="slot-cell"\s*(?:colspan="(\d+)")?\s*>(.*?)</td>',
            re.DOTALL
        )
        for match in slot_pattern.finditer(tr):
            colspan = int(match.group(1)) if match.group(1) else 1
            cell = match.group(2)

            if 'empty-slot' in cell:
                slots.append({"empty": True, "span": colspan})
            else:
                code_m = re.search(r'class="slot-code">([^<]+)</div>', cell)
                teacher_m = re.search(r'class="slot-teacher">([^<]+)</div>', cell)
                room_m = re.search(r'class="slot-room">([^<]+)</div>', cell)
                slots.append({
                    "course": code_m.group(1).strip() if code_m else "",
                    "teacher": teacher_m.group(1).strip() if teacher_m else "",
                    "room": room_m.group(1).strip() if room_m else "",
                    "span": colspan,
                })

        rows.append({
            "year": year,
            "sem": sem,
            "section": section,
            "slots": slots,
        })

    return rows


def scrape_schedule(schedule_id: int) -> dict[str, dict]:
    """Scrape a schedule page, return {key: routine_data}."""
    url = f"{BASE}/class-schedule/{schedule_id}"
    print(f"Fetching {url}...")
    html = fetch(url)

    periods = parse_periods(html)
    print(f"  Periods: {len(periods)}")

    # Split by day headers — use split approach for reliability
    routines: dict[str, dict] = {}

    # Split HTML into day sections
    day_splits = re.split(r'<div class="day-header">(\w+)</div>', html)
    # day_splits = [before, 'Saturday', content, 'Sunday', content, ...]

    for i in range(1, len(day_splits) - 1, 2):
        day = day_splits[i]
        if day not in DAYS:
            continue
        table_html = day_splits[i + 1]
        rows = parse_day_table(table_html)
        print(f"  {day}: {len(rows)} rows")

        for row in rows:
            key = f"{row['year']}-{row['sem']}-{row['section']}"
            if key not in routines:
                routines[key] = {
                    "year": row["year"],
                    "semester": row["sem"],
                    "section": row["section"],
                    "periods": periods,
                    "days": [],
                    "slots": [],
                    "teachers": [],
                }

            routines[key]["days"].append(day)

            # Convert slots to our format
            period_idx = 0
            for slot in row["slots"]:
                if period_idx >= len(periods):
                    break
                if not slot.get("empty"):
                    routines[key]["slots"].append({
                        "day": day,
                        "period": period_idx,
                        "span": slot.get("span", 1),
                        "course": slot["course"],
                        "teacher": slot["teacher"],
                        "room": slot["room"],
                    })
                    # Track unique teachers
                    if slot["teacher"] and slot["teacher"] not in [
                        t["name"] for t in routines[key]["teachers"]
                    ]:
                        routines[key]["teachers"].append({
                            "name": slot["teacher"],
                            "course": slot["course"],
                        })
                period_idx += slot.get("span", 1)

    return routines


def main():
    global COOKIE

    # Parse args
    schedule_id = 4
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--cookie" and i < len(sys.argv) - 1:
            COOKIE = sys.argv[i + 1]
        elif arg == "--schedule-id" and i < len(sys.argv) - 1:
            schedule_id = int(sys.argv[i + 1])

    if not COOKIE:
        # Try loading from file
        cookie_file = DATA / ".cookie"
        if cookie_file.exists():
            COOKIE = cookie_file.read_text().strip()
        else:
            print("No cookie provided. Pass --cookie or save to data/.cookie")
            sys.exit(1)

    routines = scrape_schedule(schedule_id)
    print(f"\nParsed {len(routines)} sections")

    for key, data in sorted(routines.items()):
        outfile = ROUTINES / f"{key}.json"
        outfile.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"  ✓ {key}: {len(data['slots'])} slots, {len(data['days'])} days")

    print("\nDone!")


if __name__ == "__main__":
    main()
