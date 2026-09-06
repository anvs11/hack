"""Deterministic discovery of regulatory-document dossier candidates.

The collector may discover a document reference, but it must not infer a legal
stage from a news item.  These helpers therefore require an explicit document
type and registration number, and only create a draft that a specialist can
verify against an official source.
"""

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class RegulatoryCaseCandidate:
    """A document reference found verbatim in a publication."""

    title: str
    registration_number: str
    identifier_key: str


@dataclass(frozen=True)
class _Pattern:
    kind: str
    title_prefix: str
    registration_prefix: str
    expression: re.Pattern[str]


_PATTERNS = (
    _Pattern(
        kind="federal_law",
        title_prefix="Федеральный закон",
        registration_prefix="ФЗ",
        expression=re.compile(
            r"(?:федеральн(?:ый|ого)\s+закон(?:а|ом)?|\bфз)"
            r"(?:\s+от\s+\d{1,2}[.]\d{1,2}[.]\d{4})?\s*№\s*"
            r"(?P<number>\d{1,5}-фз)\b",
            re.IGNORECASE,
        ),
    ),
    _Pattern(
        kind="bill",
        title_prefix="Законопроект",
        registration_prefix="Законопроект",
        expression=re.compile(
            r"законопроект(?:а|ом|у|е)?\s*№\s*(?P<number>\d{3,8}-\d)\b",
            re.IGNORECASE,
        ),
    ),
    _Pattern(
        kind="government_resolution",
        title_prefix="Постановление Правительства РФ",
        registration_prefix="ПП РФ",
        expression=re.compile(
            r"постановлен(?:ие|ия|ием)\s+правительств(?:а|ом)"
            r"(?:\s+(?:российской\s+федерации|рф))?"
            r"(?:\s+от\s+(?P<date>\d{1,2}[.]\d{1,2}[.]\d{4}))?\s*№\s*"
            r"(?P<number>\d{1,6})\b",
            re.IGNORECASE,
        ),
    ),
    _Pattern(
        kind="ministry_order",
        title_prefix="Приказ ведомства",
        registration_prefix="Приказ",
        expression=re.compile(
            r"приказ(?:а|ом|у|е)?\s+(?:минцифры|минпромторга|"
            r"минэкономразвития|минфина|роскомнадзора|фас)"
            r"(?:\s+россии)?(?:\s+от\s+(?P<date>\d{1,2}[.]\d{1,2}[.]\d{4}))?"
            r"\s*№\s*(?P<number>\d{1,6})\b",
            re.IGNORECASE,
        ),
    ),
)


def extract_regulatory_case_candidates(text: str) -> list[RegulatoryCaseCandidate]:
    """Return distinct explicit NPA references in first-seen order.

    A candidate is deliberately not based on LLM category or a broad keyword:
    the original publication must contain both a recognised document type and
    a number.  This keeps unrelated regulatory news out of the NPA register.
    """

    candidates: list[RegulatoryCaseCandidate] = []
    seen: set[str] = set()
    for pattern in _PATTERNS:
        for match in pattern.expression.finditer(text):
            number = _normalize_number(match.group("number"))
            date = match.groupdict().get("date")
            key_parts = [pattern.kind, number.casefold()]
            if date:
                key_parts.append(date)
            identifier_key = ":".join(key_parts)
            if identifier_key in seen:
                continue
            seen.add(identifier_key)
            suffix = f" от {date}" if date else ""
            candidates.append(
                RegulatoryCaseCandidate(
                    title=f"{pattern.title_prefix} № {number}{suffix}",
                    registration_number=(
                        f"{pattern.registration_prefix} № {number}{suffix}"
                    ),
                    identifier_key=identifier_key,
                )
            )
    return candidates


def _normalize_number(value: str) -> str:
    return re.sub(r"\s+", "", value).upper()
