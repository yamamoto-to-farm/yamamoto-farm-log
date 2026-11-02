"""Rule-based classification for JA invoice line items."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable

from statement_parser import LineItem, normalize_text


@dataclass(frozen=True)
class ClassificationRule:
    keyword: str
    category: str
    subcategory: str = ""
    department: str = ""
    priority: int = 100
    needs_review: bool = False
    review_reason: str = ""


DEFAULT_RULES = (
    ClassificationRule("プレバソン", "農薬費", "殺虫剤"),
    ClassificationRule("マッチ", "農薬費", "殺虫剤"),
    ClassificationRule("ロブラール", "農薬費", "殺菌剤"),
    ClassificationRule("バリダシン", "農薬費", "殺菌剤"),
    ClassificationRule("セイビア", "農薬費", "殺菌剤"),
    ClassificationRule("ザクサ", "農薬費", "除草剤"),
    ClassificationRule("ラウンドアップ", "農薬費", "除草剤"),
    ClassificationRule(
        "フィールドスター",
        "農薬費",
        "要確認",
        needs_review=True,
        review_reason="用途未確定",
    ),
    ClassificationRule("スイカル", "肥料費", "葉面散布"),
    ClassificationRule("トラクタ", "機械部品・装備"),
    ClassificationRule("その他部品", "機械部品・装備"),
    ClassificationRule("整備工賃", "機械整備工賃"),
    ClassificationRule("消耗部品", "機械部品・装備", "消耗品"),
    ClassificationRule("資材費", "資材・消耗品", "整備付帯"),
    ClassificationRule(
        "",
        "未分類",
        "機械系",
        department="農機課",
        priority=10,
        needs_review=True,
        review_reason="取扱部署からの推定のみ",
    ),
    ClassificationRule(
        "",
        "未分類",
        "農薬・肥料・資材系",
        department="第4事業所",
        priority=10,
        needs_review=True,
        review_reason="取扱部署からの推定のみ",
    ),
)

HIGH_AMOUNT_REVIEW_THRESHOLD = 100_000
HIGH_AMOUNT_REVIEW_REASON = "高額：資産計上/修繕費の判断が必要（税理士確認）"


def _matching_rule(
    item: LineItem, rules: Iterable[ClassificationRule]
) -> ClassificationRule | None:
    searchable = normalize_text(f"{item.item_name} {item.spec}")
    matching = [
        rule
        for rule in rules
        if (not rule.department or rule.department == item.department)
        and (not rule.keyword or normalize_text(rule.keyword) in searchable)
    ]
    return max(matching, key=lambda rule: rule.priority, default=None)


def classify(
    items: Iterable[LineItem],
    rules: Iterable[ClassificationRule] = DEFAULT_RULES,
) -> list[LineItem]:
    """Return classified copies, preserving source items and applying higher-priority rules first."""
    rules = tuple(rules)
    classified = []
    for item in items:
        rule = _matching_rule(item, rules)
        reasons = []
        if rule is None:
            category, subcategory, classified_by = "未分類", "", "unclassified"
            reasons.append("分類辞書に一致しません")
        else:
            category = rule.category
            subcategory = rule.subcategory
            classified_by = "rule(dept)" if rule.department else "rule"
            if rule.needs_review and rule.review_reason:
                reasons.append(rule.review_reason)

        if item.amount >= HIGH_AMOUNT_REVIEW_THRESHOLD:
            reasons.append(HIGH_AMOUNT_REVIEW_REASON)

        classified.append(
            replace(
                item,
                category=category,
                subcategory=subcategory,
                classified_by=classified_by,
                needs_review=bool(reasons),
                review_reason="；".join(reasons),
            )
        )
    return classified
