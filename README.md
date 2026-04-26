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

## Credits & attribution

This trainer would not exist without the work of others. Please give them stars and traffic:

- **Primary 150-question bank** — compiled and translated by **[lostintime101/driving_theory_test](https://github.com/lostintime101/driving_theory_test/)**. The English translations and the question/answer JSON for the primary set originate from that repository. Huge thanks to lostintime101.
- **Extended 327-question bank (11 categories)** — scraped from **[safedrivedlt.com](https://safedrivedlt.com/courses/ข้อสอบใบขับขี่-ฝึกทํา/quizzes/แบบทดสอบ-quizmaker-แทรกรูป-html/)**, a free public Thai-language driving quiz site. All Thai source text and illustrations belong to safedrivedlt.com.
- **Rule citations** — extracted from the official Department of Land Transport handbook; English translations live at [rawgeek.github.io/thai-driving-rules-translations](https://rawgeek.github.io/thai-driving-rules-translations).
- **Explanations** — LLM-generated and grounded in the rule citations above.

This project is an unaffiliated study aid. If any rights-holder wants content removed, open an issue.

## License & content

Code in this repository is MIT-licensed. Question text, Thai source content,
and illustrations remain the property of their original publishers (see
attribution above). Re-use of the *content* should respect the upstream
sources' terms.

## Privacy

Nothing leaves your browser. Progress is stored under `localStorage` keys
`cfg`, `attempts_primary`, and `attempts_safedrive`.
