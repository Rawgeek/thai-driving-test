# Thai Driving Trainer

Bilingual (English / Thai) flashcard-style trainer for the Thailand driving
licence theory test.

**Live demo:** deployed to GitHub Pages from the [`web/`](web/) directory on every push to `main`.

## Features

- Two question banks: 150-question primary set + 327-question safedrivedlt.com set (11 categories)
- Adaptive selection: weights weak / unseen questions higher; mastered ones drop out
- Configurable mastery streak, weak-pool streak, run length, and per-question timer
- LLM-generated explanations grounded in citations from the official Thai handbook
- Light & dark theme · WCAG 2.2 AA · keyboard-first · mobile-friendly with safe-area insets
- 100% client-side: progress + settings live in `localStorage`, no server round-trips

## How it runs

This is a pure static site — `web/index.html`, `web/styles.css`, `web/app.js`,
plus pre-rendered JSON datasets and images. No build step, no backend.

GitHub Actions ([`.github/workflows/pages.yml`](.github/workflows/pages.yml))
publishes `web/` to GitHub Pages.

To preview locally:

```sh
cd web && python3 -m http.server 8000
# open http://127.0.0.1:8000
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1`–`4` | Select answer |
| `Enter` / `Space` | Next question · start new run |
| `T` | Toggle Thai original |
| `S` | Open settings |

## Data attribution

Question content is sourced from publicly available test banks
(thaidrivingtest.com, safedrivedlt.com). Explanations are LLM-generated with
citations to the official handbook. This is an unaffiliated study aid.

## Privacy

Nothing leaves your browser. Progress is stored under `localStorage` keys
`cfg`, `attempts_primary`, and `attempts_safedrive`.
