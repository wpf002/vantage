"""
Canonical alt-data feature ordering.

The TS bridge sends features as `dict[str, float]`. We map to a fixed
order at serve time so the XGBoost model always sees the same column
layout it was trained on. Missing keys default to 0.
"""

from __future__ import annotations


def canonical_feature_order() -> list[str]:
    return [
        # Web traffic / search demand
        "web_traffic_yoy_pct",
        "google_trends_90d_change",
        "tranco_rank_log",
        # Engineering velocity (GitHub)
        "gh_commits_90d_log",
        "gh_active_contributors_90d_log",
        # IP filings (USPTO)
        "patents_filed_12m_log",
        "patents_granted_12m_log",
        # App activity
        "app_dau_90d_change",
        "app_installs_90d_log",
        # Tech stack changes (BuiltWith)
        "tech_stack_change_score",
        # Funding leakage (SEC Form D)
        "form_d_offerings_12m",
        "form_d_amount_log",
        # Financial primitives carried alongside alt-data for context
        "revenue_growth_ltm",
        "gross_margin_ltm",
        "burn_multiple_ltm",
    ]
