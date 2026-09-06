# Interactive Routine — Complete Project Workflow

> **For:** Anyone who needs to understand, submit answers about, or maintain this project.
> **Project Root:** `/home/sifat/hdd/projects/interactive-routine`

---

## 1. What This Project Is

A **zero-dependency web app** (pure Python stdlib + vanilla JS) that serves three purposes for RUET CSE students:

| Feature | What It Does |
|---------|-------------|
| **Class Routine** | Shows your weekly class timetable (scraped from ConnectCSE) |
| **Schedule** | Calendar view of upcoming classes/exams/events (live from phantom_bot API) |
| **Personal Routine** | Your own daily task checklist with day-specific frequency |

No database. No npm. No frameworks. Just `python server.py` and open a browser.

---

## 2. File Structure & What Each File Does

```
interactive-routine/
├── server.py          ← HTTP server + ALL API endpoints (backend)
├── scraper.py         ← Scrapes ConnectCSE HTML → JSON routine files
├── static/
│   ├── index.html     ← Single-page app shell (all views in one HTML)
│   ├── app.js         ← ALL frontend logic (~1100 lines, vanilla JS)
│   ├── style.css      ← All styling (dark/light theme)
│   └── lucide.min.js  ← Icon library (bundled locally)
├── data/
│   ├── config.json    ← User profile: {roll, year, semester, section}
│   ├── personal.json  ← Personal routine items + daily check states
│   ├── schedules.json ← Fallback schedule data (if live API fails)
│   ├── .cookie        ← ConnectCSE session cookie (for scraping)
│   └── routines/      ← Scraped routine JSONs (e.g., 2-1-A.json)
└── pyproject.toml     ← Minimal project metadata
```

---

## 3. The Big Picture — How Everything Connects

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER (app.js)                        │
│                                                             │
│  init() → GET /api/config                                   │
│       ↓                                                     │
│  Has config? ──NO──→ showFirstLoginModal()                   │
│       │                    ↓                                │
│      YES            POST /api/config {roll,year,sem,sec}    │
│       │                    ↓                                │
│       ├→ loadRoutine()  → GET /api/routine?year=&sem=&sec= │
│       ├→ loadSchedules()→ GET /api/schedule?month=         │
│       └→ loadPersonal() → GET /api/personal                 │
│                                                             │
│  User clicks rail buttons → switchView() → renderSidebar()  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP requests
┌────────────────────────▼────────────────────────────────────┐
│                   SERVER (server.py)                         │
│                                                              │
│  Handler.do_GET()                                            │
│    /api/config          → reads data/config.json             │
│    /api/routines/index  → scans data/routines/*.json         │
│    /api/routine         → reads specific routine JSON        │
│    /api/schedule        → fetch_live_schedules() or fallback │
│    /api/personal        → reads data/personal.json           │
│    /api/routines/check-update → probes ConnectCSE            │
│                                                              │
│  Handler.do_POST()                                           │
│    /api/config          → writes data/config.json            │
│    /api/personal/items  → appends to data/personal.json      │
│    /api/settings/cookie → writes data/.cookie                │
│    /api/settings/refresh→ runs scraper.py as subprocess     │
│                                                              │
│  Handler.do_PUT()                                            │
│    /api/config          → merges into data/config.json       │
│    /api/personal/items/:id → updates item in personal.json   │
│                                                              │
│  Handler.do_DELETE()                                         │
│    /api/personal/items/:id → removes from personal.json      │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   data/*.json    phantom_bot API   ConnectCSE
   (local files)  (live schedule)   (scrape target)
```

---

## 4. Detailed Workflow by Feature

### 4.1 First-Time Setup (First Login)

**Trigger:** User opens app, no `data/config.json` exists (or it has no `roll`).

1. `init()` calls `GET /api/config` → returns `{}` or null
2. `showFirstLoginModal()` renders a modal with fields: Roll, Year, Semester, Section
3. User fills form, clicks "Save & Continue"
4. Frontend sends `POST /api/config` with `{roll, year, semester, section}`
5. Server writes to `data/config.json`
6. Frontend proceeds to load all three views

**Data flow:**
```
Browser Modal → POST /api/config → server.py writes data/config.json
                                  ← 201 response
Browser receives config → loads routine + schedule + personal
```

### 4.2 Class Routine View

**What user sees:** A table with days as rows, periods as columns, course/teacher/room in cells.

**Load sequence:**
1. `loadRoutine()` reads `config.year`, `config.semester`, `config.section`
2. Calls `GET /api/routine?year=2&sem=1&section=A`
3. Server constructs filename `2-1-A.json`, reads from `data/routines/`
4. Returns `{periods: [...], days: [...], slots: [...], teachers: [...]}`
5. `renderRoutineTable()` builds an HTML `<table>`:
   - Header row = period times (e.g., "8:00am–8:50am")
   - Each day row iterates through periods, finds matching slot by `day + period`
   - Slots with `span > 1` get `colspan` (for double-period classes)

**Sidebar:** Lists unique teachers from current routine's slots, mapping teacher codes (e.g., "SUZ") to full names via the `TEACHER_NAMES` dictionary in `app.js`.

**Change Section Flow (sidebar-driven, multi-step):**
1. Click "Change Section" → `startChangeFlow()`
2. Step 1: `GET /api/routines/index` → shows available year-sem combinations
3. Step 2: User picks a sem → shows sections for that sem
4. Step 3: User picks section → `previewSection()` fetches that routine, renders it in main area WITHOUT saving
5. User clicks "Set as Default" → `applySectionChange()` sends `PUT /api/config` → reloads routine

**Update Check:**
1. After loading routine, `checkRoutineUpdate()` calls `GET /api/routines/check-update`
2. Server probes ConnectCSE `/class-schedule/published` page, extracts schedule IDs via regex
3. If `latest > current`, shows "Update Routine" button
4. Clicking it sends `POST /api/settings/refresh {scheduleId: latest}`
5. Server spawns `scraper.py --schedule-id <id>` as subprocess
6. Scraper re-scrapes ConnectCSE, overwrites routine JSONs in `data/routines/`
7. Frontend reloads routine

### 4.3 Schedule View (Calendar)

**What user sees:** Monthly calendar grid. Days with events show dots + first event title. Click a day → modal with event details.

**Load sequence:**
1. `loadSchedules()` calculates current month string (e.g., "2026-09")
2. Calls `GET /api/schedule?month=2026-09`
3. Server tries `fetch_live_schedules()` first:
   - Hits `https://phantom-bot-1-yn9t.onrender.com/panel/api/public/schedule`
   - Maps MongoDB docs to `{date, time, title, content}` shape
   - Caches result for 300 seconds (`SCHEDULE_TTL`)
4. If live fetch fails → falls back to `data/schedules.json`
5. Filters by requested month prefix
6. If today > 20th, also fetches next month (for end-of-month visibility)

**Calendar rendering (`renderCalendar()`):**
- Calculates first day offset (Saturday = 0, since RUET week starts Saturday)
- Creates grid cells, marks today, marks days with events
- Click handler → `showDaySchedule()` opens modal with event cards

**Sidebar:** Lists all schedule items for current month, sorted by date. Click to expand details inline.

### 4.4 Personal Routine View

**What user sees:** Checklist of personal tasks, filterable by day. Items can be checked/unchecked per day.

**Data model (`data/personal.json`):**
```json
{
  "items": [
    {
      "id": 1,
      "title": "Read textbook",
      "duration": "1h",
      "frequency": ["daily"],
      "checks": {"2026-09-06": true},
      "overrides": {}
    }
  ]
}
```

- `frequency`: `["daily"]` OR `["sat", "sun", "mon", ...]` (day abbreviations)
- `checks`: keyed by date string, boolean
- `overrides`: per-day edits (title/duration/frequency changes for one specific day)

**Load sequence:**
1. `loadPersonal()` → `GET /api/personal` → returns `{items: [...]}`
2. `renderPersonalView()` builds:
   - Day tabs across top (Daily + Sat-Sun-Mon-Tue-Wed-Thu-Fri)
   - Filtered item list based on active tab
   - Each item has a check circle (toggle via `PUT /api/personal/items/:id`)

**Adding items:**
1. Click "+ Add" → `showAddPersonalModal()`
2. Form: Title, Duration, Frequency (Daily checkbox OR individual day checkboxes)
3. Submit → `POST /api/personal/items` → server assigns auto-increment ID, appends to array

**Editing items:**
1. Click "Edit" mode → items show Edit/Delete buttons
2. Edit → `showEditPersonalModal()` pre-filled form
3. If editing a daily item from a specific day tab → `showScopeModal()` asks: "This Day Only" vs "Universal"
   - "This Day Only" → saves change under `overrides[day]`
   - "Universal" → updates the base item

**Deleting items:**
1. Similar scope question for daily items
2. "This Day Only" → removes that day from frequency array
3. "Delete Everywhere" → `DELETE /api/personal/items/:id`

**Checking items:**
1. Click circle → `toggleCheck(id)` flips `checks[todayStr]`
2. Sends `PUT /api/personal/items/:id {checks: {...}}`
3. Re-renders view

### 4.5 Settings View

Tabbed settings panel (General, Appearance, Routine, Schedule, Personal).

- **General:** Edit profile (roll/year/sem/section) → `PUT /api/config`
- **Appearance:** Toggle dark/light → saves to `localStorage` only
- **Routine/Schedule/Personal:** Placeholder "Coming soon" panels

---

## 5. Scraper Deep Dive (`scraper.py`)

**Purpose:** Convert ConnectCSE's HTML class schedule pages into structured JSON.

**Invocation:**
```bash
python scraper.py --schedule-id 4 --cookie "session=abc123..."
# Or cookie is read from data/.cookie if not passed
```

**Scraping pipeline:**

```
ConnectCSE HTML page
        ↓
fetch(url) → raw HTML string
        ↓
parse_periods(html) → ["8:00am–8:50am", "8:50am–9:40am", ...]
        ↓
Split HTML by <div class="day-header">DAYNAME</div>
        ↓
For each day:
  parse_day_table(table_html)
    → Split by <tr>
    → Extract year/sem/section from <td class="row-header">
    → Extract slots from <td class="slot-cell">
      → Parse course code, teacher, room via regex
      → Handle colspan for multi-period classes
    → Return [{year, sem, section, slots}]
        ↓
Aggregate into routines dict keyed by "year-sem-section"
        ↓
Write each to data/routines/{key}.json
```

**Output format (e.g., `data/routines/2-1-A.json`):**
```json
{
  "year": "2",
  "semester": "1",
  "section": "A",
  "periods": ["8:00am–8:50am", "8:50am–9:40am", ...],
  "days": ["Saturday", "Sunday", ...],
  "slots": [
    {"day": "Saturday", "period": 0, "span": 1, "course": "CSE 2101", "teacher": "SUZ", "room": "R-301"}
  ],
  "teachers": [{"name": "SUZ", "course": "CSE 2101"}]
}
```

**Key regex patterns:**
- Period times: `(\d{1,2}:\d{2}[ap]m\s*[–-]\s*\d{1,2}:\d{2}[ap]m)`
- Slot cells: `<td class="slot-cell"\s*(?:colspan="(\d+)")?\s*>(.*?)</td>`
- Course/teacher/room: `class="slot-code">([^<]+)</div>` (and similar)

---

## 6. Server API Reference (`server.py`)

| Method | Endpoint | Purpose | Reads/Writes |
|--------|----------|---------|-------------|
| GET | `/api/config` | Get user profile | `data/config.json` |
| POST | `/api/config` | Create user profile | `data/config.json` |
| PUT | `/api/config` | Update user profile | `data/config.json` |
| GET | `/api/routines/index` | List available routines | Scans `data/routines/*.json` |
| GET | `/api/routine?year=&sem=&section=` | Get specific routine | `data/routines/{y}-{s}-{sec}.json` |
| GET | `/api/routines/check-update` | Check for newer schedule | Probes ConnectCSE website |
| GET | `/api/schedule?month=` | Get schedule events | Live API → fallback `data/schedules.json` |
| GET | `/api/personal` | Get personal items | `data/personal.json` |
| POST | `/api/personal/items` | Add personal item | `data/personal.json` |
| PUT | `/api/personal/items/:id` | Update personal item | `data/personal.json` |
| DELETE | `/api/personal/items/:id` | Delete personal item | `data/personal.json` |
| POST | `/api/settings/cookie` | Save ConnectCSE cookie | `data/.cookie` |
| POST | `/api/settings/refresh` | Re-scrape routines | Spawns `scraper.py` subprocess |
| GET | `/*` | Static files | Serves from `static/` directory |

**Server internals:**
- Uses `http.server.HTTPServer` + `SimpleHTTPRequestHandler` (stdlib only)
- Static files served from `static/` (via `os.chdir(ROOT / "static")` before starting)
- JSON helpers: `read_json(path, default)` and `write_json(path, data)`
- Schedule cache: in-memory dict `_schedule_cache` with 300s TTL
- Cookie stored in `data/.cookie` (plaintext file, used by scraper)

---

## 7. Frontend Architecture (`app.js`)

**State variables:**
| Variable | Type | Purpose |
|----------|------|---------|
| `config` | Object | User profile (roll, year, semester, section) |
| `currentView` | String | Active view: 'routine'/'schedule'/'personal'/'settings' |
| `routineData` | Object | Current routine JSON |
| `schedules` | Array | Schedule events for current+next month |
| `personalItems` | Array | Personal routine items |
| `calendarDate` | Date | Currently displayed month |
| `personalActiveDay` | String | Selected day tab ('Daily' or 'Sat'-'Fri') |
| `changeFlowStep` | Number | Multi-step section change wizard state |
| `viewingPreview` | Boolean | Whether showing preview vs actual routine |
| `scheduleUpdateInfo` | Object | Latest/current schedule ID comparison |

**Key function call chains:**

```
Boot:
  init() → api('/api/config')
    → has config? → setupViews() + loadRoutine() + loadSchedules() + loadPersonal()
    → no config?  → showFirstLoginModal()

View Switching:
  rail-btn click → switchView(view) → renderSidebar()
    → routine:  renderRoutineSidebar()
    → schedule: renderScheduleSidebar()
    → personal: renderPersonalSidebar()
    → settings: renderSettingsView()

Routine Load:
  loadRoutine() → api('/api/routine?...') → renderRoutineTable() + checkRoutineUpdate()

Schedule Load:
  loadSchedules() → api('/api/schedule?month=...') → renderCalendar() + renderScheduleSidebar()

Personal CRUD:
  Add:    showAddPersonalModal() → apiPost('/api/personal/items', ...) → loadPersonal()
  Edit:   showEditPersonalModal() → apiPut('/api/personal/items/:id', ...) → loadPersonal()
  Delete: deletePersonalItem() → apiDel('/api/personal/items/:id') → loadPersonal()
  Check:  toggleCheck(id) → apiPut('/api/personal/items/:id', {checks}) → renderPersonalView()
```

**Utility functions:**
- `api(url, opts)` — fetch wrapper, returns parsed JSON or null on error
- `apiPost/apiPut/apiDel` — convenience wrappers
- `esc(str)` — XSS-safe HTML escaping via textContent
- `fmtDate(d)` — Date → "YYYY-MM-DD" string
- `showModal(html)` / `closeModal()` — modal overlay management
- `showToast(msg)` — temporary notification popup
- `refreshIcons()` — re-initializes Lucide icons after DOM changes

---

## 8. External Dependencies & Services

| Service | URL | Purpose | Failure Behavior |
|---------|-----|---------|-----------------|
| phantom_bot API | `https://phantom-bot-1-yn9t.onrender.com/panel/api/public/schedule` | Live schedule data (MongoDB-backed) | Falls back to `data/schedules.json` |
| ConnectCSE | `https://connectcse.ruet.ac.bd` | Class schedule HTML pages (scraping target) | Update check fails silently; scrape requires valid cookie |

**No other external dependencies.** No npm packages, no pip packages, no CDN links. Lucide icons are bundled as `lucide.min.js`.

---

## 9. Data Flow Summary Diagram

```
                    ┌──────────────────┐
                    │   USER BROWSER   │
                    │   (app.js SPA)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         GET/POST/PUT   GET/POST       GET
         /api/config    /api/personal  /api/schedule
         /api/routine   /items         │
              │              │              │
              ▼              ▼              ▼
    ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐
    │ config.json │  │personal.json│  │ phantom_bot API  │
    │ routines/   │  │             │  │ (live, cached    │
    │  *.json     │  │             │  │  300s TTL)       │
    └─────────────┘  └─────────────┘  └──────────────────┘
              ▲                            │
              │ POST /settings/refresh     │ fallback
              │ (spawns scraper.py)        ▼
              │                     schedules.json
    ┌─────────┴──────────┐
    │   scraper.py       │
    │   ConnectCSE HTML  │
    │   → routines/*.json│
    └────────────────────┘
              ▲
              │ data/.cookie
              │ (ConnectCSE auth)
```

---

## 10. Common Questions Answered

**Q: Where does the class routine data come from?**
A: Scraped from ConnectCSE RUET by `scraper.py`. The scraper parses HTML tables into JSON files stored in `data/routines/`. Users trigger re-scraping via the "Update Routine" button when a new schedule is published.

**Q: Where do schedule events come from?**
A: Primarily from the phantom_bot Render API (live MongoDB data). If that API is down, falls back to `data/schedules.json`.

**Q: How is user identity stored?**
A: `data/config.json` stores roll number, year, semester, and section. No authentication — it's a local/personal tool.

**Q: How does the "Change Section" feature work without reloading?**
A: It's a sidebar-driven wizard. Step 1 fetches `/api/routines/index` (available routines), Step 2 shows sections, Step 3 previews the selected routine in the main area. Only clicking "Set as Default" actually saves via `PUT /api/config`.

**Q: What happens if I delete a daily personal item from a specific day tab?**
A: A scope modal asks whether to delete everywhere or just remove that day from the frequency array. "This Day Only" modifies the frequency; "Delete Everywhere" removes the entire item.

**Q: How does the server serve both API and static files?**
A: `server.py` subclasses `SimpleHTTPRequestHandler`. API routes are handled in `do_GET/do_POST/do_PUT/do_DELETE`. Non-API paths fall through to `super().do_GET()` which serves files from `static/` (the working directory is changed to `static/` at startup).

**Q: Why is there a `.cookie` file?**
A: ConnectCSE requires authentication to access schedule pages. The cookie is saved via Settings or manually placed in `data/.cookie`. The scraper reads it to authenticate requests.
