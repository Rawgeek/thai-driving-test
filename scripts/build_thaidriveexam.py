#!/usr/bin/env python3
"""Build the Thai Drive Exam dataset from raw Thai and browser-translated pages."""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
TRANSLATED_PATH = Path("/tmp/thaidrive-translated.json")
OUTPUT_PATH = ROOT / "web/data/thaidriveexam.json"
IMAGE_DIR = ROOT / "web/images/thaidriveexam"
USER_AGENT = "Mozilla/5.0 (compatible; ThaiDrivingTrainer/1.0)"

CATEGORIES = {
    "1000000000015": "Traffic signs",
    "1000000000016": "Traffic laws",
    "1000000000022": "Safe driving",
    "1000000000017": "Vehicle maintenance",
    "1000000000023": "Accident anticipation",
}


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.div_depth = 0
        self.detail_depth: int | None = None
        self.ul_depth = 0
        self.question: dict | None = None
        self.option: dict | None = None
        self.capture_label = False
        self.questions: list[dict] = []

    @staticmethod
    def attrs_dict(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key: value or "" for key, value in attrs}

    @property
    def in_detail(self) -> bool:
        return self.detail_depth is not None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = self.attrs_dict(attrs)
        if tag == "div":
            self.div_depth += 1
            if self.detail_depth is None and "article-view-detail" in values.get("class", "").split():
                self.detail_depth = self.div_depth

        if not self.in_detail:
            return

        if tag == "ul":
            self.ul_depth += 1
        elif tag == "li" and self.ul_depth == 1:
            self.question = {"question": "", "image": None, "options": []}
        elif tag == "li" and self.ul_depth == 2 and self.question is not None:
            self.option = {
                "text": "",
                "correct": "#0f08f5" in values.get("style", "").lower(),
            }
        elif tag == "label" and self.question is not None and self.ul_depth == 1:
            self.capture_label = True
        elif tag == "img" and self.question is not None and self.ul_depth == 1:
            self.question["image"] = values.get("src") or None

    def handle_data(self, data: str) -> None:
        if self.option is not None:
            self.option["text"] += data
        elif self.capture_label and self.question is not None:
            self.question["question"] += data

    def handle_endtag(self, tag: str) -> None:
        if self.in_detail:
            if tag == "label":
                self.capture_label = False
            elif tag == "li" and self.option is not None:
                self.option["text"] = clean(self.option["text"])
                self.question["options"].append(self.option)
                self.option = None
            elif tag == "li" and self.question is not None and self.ul_depth == 1:
                self.question["question"] = clean(self.question["question"])
                self.questions.append(self.question)
                self.question = None
            elif tag == "ul":
                self.ul_depth -= 1

        if tag == "div":
            if self.detail_depth == self.div_depth:
                self.detail_depth = None
            self.div_depth -= 1


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def strip_number(value: str) -> str:
    return re.sub(r"^\s*\d+\.\)\s*", "", clean(value))


def fetch(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read()


def parse_raw_article(url: str) -> list[dict]:
    parser = ArticleParser()
    parser.feed(fetch(url).decode("utf-8"))
    return parser.questions


def image_filename(url: str) -> str:
    return Path(urlparse(url).path).name


def main() -> None:
    if not TRANSLATED_PATH.exists():
        sys.exit(f"Missing browser extraction: {TRANSLATED_PATH}")

    translated_articles = json.loads(TRANSLATED_PATH.read_text())
    questions = []
    images: dict[str, str] = {}

    for article in translated_articles:
        url = article["url"]
        article_id = url.rstrip("/").rsplit("-", 1)[-1]
        category = CATEGORIES[article_id]
        raw_questions = parse_raw_article(url)
        translated_questions = article["questions"]

        if len(raw_questions) != len(translated_questions):
            raise RuntimeError(
                f"{article_id}: raw/translated question counts differ "
                f"({len(raw_questions)} != {len(translated_questions)})"
            )

        for source_number, (raw, translated) in enumerate(
            zip(raw_questions, translated_questions), start=1
        ):
            if len(raw["options"]) != len(translated["options"]):
                raise RuntimeError(
                    f"{article_id} question {source_number}: option counts differ"
                )

            correct = [
                idx
                for idx, option in enumerate(raw["options"])
                if option["correct"]
            ]
            if len(correct) != 1:
                raise RuntimeError(
                    f"{article_id} question {source_number}: "
                    f"expected one answer, found {len(correct)}"
                )

            remote_image = raw["image"]
            picture = image_filename(remote_image) if remote_image else None
            if remote_image:
                images[picture] = urljoin(url, remote_image)

            question_id = len(questions) + 1
            tags = [category, "quest-picture" if picture else "non-picture"]
            options = []
            for idx, (raw_option, translated_option) in enumerate(
                zip(raw["options"], translated["options"])
            ):
                options.append(
                    {
                        "idx": idx,
                        "txt": clean(translated_option["text"]),
                        "txt_th": clean(raw_option["text"]),
                        "pic": None,
                    }
                )

            questions.append(
                {
                    "q_id": question_id,
                    "q_txt": strip_number(translated["question"]),
                    "q_txt_th": strip_number(raw["question"]),
                    "q_pic": picture,
                    "ans_num": correct[0],
                    "tags": tags,
                    "options": options,
                    "explanation": "",
                    "rule_ids": [],
                    "source_article": article_id,
                    "source_question": source_number,
                }
            )

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in sorted(images.items()):
        destination = IMAGE_DIR / filename
        if not destination.exists():
            destination.write_bytes(fetch(url))

    dataset = {
        "name": "thaidriveexam",
        "label": "thaidriveexam.com",
        "image_prefix": "images/thaidriveexam/",
        "questions": questions,
        "rules": {},
    }
    OUTPUT_PATH.write_text(
        json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    print(
        f"Wrote {len(questions)} questions and {len(images)} unique images "
        f"to {OUTPUT_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
