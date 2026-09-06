# Interactive Routine

Interactive class routine viewer for RUET CSE. Scrapes schedules from ConnectCSE, fetches live exam/event schedules from phantom_bot, and lets you manage a personal routine — all in a single stdlib-only Python server.

## Features

- **Class Routine** — Browse scraped routines by year/semester/section
- **Live Schedule** — Auto-fetches exam/event schedules (cached 5 min, local fallback)
- **Personal Routine** — CRUD for your own daily tasks
- **Auto-update Detection** — Probes ConnectCSE for newer schedule IDs
- **Zero Dependencies** — Pure Python stdlib (no pip installs needed)

## Stack

| Layer    | Tech                              |
|----------|-----------------------------------|
| Backend  | Python `http.server` (stdlib)     |
| Frontend | Vanilla HTML/CSS/JS + Lucide icons|
| Scraper  | `urllib` + regex                  |
| Live API | phantom_bot on Render (MongoDB)   |

## Setup

```bash
# Clone and run — no install step needed
git clone <repo-url>
cd interactive-routine
python server.py          # defaults to port 8080
python server.py 3000     # custom port
```

### First Run

1. Open `http://localhost:8080`
2. Set your year/semester/section in the config screen
3. Paste your ConnectCSE session cookie when prompted (saved to `data/.cookie`)
4. Routines are scraped automatically; refresh via Settings if a new schedule is published

## Project Structure

```
interactive-routine/
├── server.py        # HTTP server + REST API
├── scraper.py       # ConnectCSE routine scraper
├── static/          # Frontend (index.html, app.js, style.css)
├── data/            # Runtime data (gitignored)
│   ├── routines/    # Scraped JSON per section
│   ├── .cookie      # ConnectCSE session cookie
│   ├── config.json  # User preferences
│   └── personal.json
└── pyproject.toml
```

## API

| Method | Endpoint                    | Description                  |
|--------|-----------------------------|------------------------------|
| GET    | `/api/config`               | Get user config              |
| POST   | `/api/config`               | Save initial config          |
| PUT    | `/api/config`               | Update config                |
| GET    | `/api/routines/index`       | List available sections      |
| GET    | `/api/routine?y=&s=&sec=`   | Get specific routine         |
| GET    | `/api/routines/check-update`| Check for newer schedule ID  |
| GET    | `/api/schedule?month=`      | Live + local schedules       |
| GET    | `/api/personal`             | Get personal routine items   |
| POST   | `/api/personal/items`       | Add personal item            |
| PUT    | `/api/personal/items/:id`   | Update personal item         |
| DELETE | `/api/personal/items/:id`   | Delete personal item         |
| POST   | `/api/settings/cookie`      | Save ConnectCSE cookie       |
| POST   | `/api/settings/refresh`     | Re-scrape routines           |
