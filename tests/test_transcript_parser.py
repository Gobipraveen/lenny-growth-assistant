import pytest
from backend.app.services.transcript_parser import (
    parse_transcript_markdown,
    compute_content_hash,
)

SAMPLE_MARKDOWN = """---
guest: Test Guest
title: Mastering Product Growth
youtube_url: https://www.youtube.com/watch?v=12345
video_id: 12345
publish_date: 2024-01-15
description: A deep dive into modern growth loops and metrics.
duration_seconds: 3600.0
duration: '1:00:00'
view_count: 50000
channel: Lenny's Podcast
keywords:
- growth
- plg
---

# Mastering Product Growth

## Transcript

Test Guest (00:00:00):
Welcome everyone. Today we are discussing product growth frameworks.

Lenny (00:00:30):
Thanks for joining. Can you explain your primary growth loop?

(00:00:45):
Specifically, how viral expansion works in B2B SaaS.

Test Guest (00:01:10):
Viral loops in B2B rely on collaborative workflows where invitees derive value.
"""


def test_parse_frontmatter_metadata():
    parsed = parse_transcript_markdown(SAMPLE_MARKDOWN, episode_slug="test-guest")
    assert parsed.episode_slug == "test-guest"
    assert parsed.metadata["guest"] == "Test Guest"
    assert parsed.metadata["title"] == "Mastering Product Growth"
    assert parsed.metadata["youtube_url"] == "https://www.youtube.com/watch?v=12345"
    assert parsed.metadata["video_id"] == "12345"
    assert parsed.metadata["publish_date"] == "2024-01-15"
    assert parsed.metadata["duration_seconds"] == 3600.0
    assert parsed.metadata["view_count"] == 50000
    assert parsed.metadata["keywords"] == ["growth", "plg"]


def test_parse_speaker_turns_and_inheritance():
    parsed = parse_transcript_markdown(SAMPLE_MARKDOWN, episode_slug="test-guest")
    assert len(parsed.turns) == 4

    # Turn 1
    assert parsed.turns[0].speaker == "Test Guest"
    assert parsed.turns[0].timestamp == "00:00:00"
    assert "discussing product growth" in parsed.turns[0].text

    # Turn 2
    assert parsed.turns[1].speaker == "Lenny"
    assert parsed.turns[1].timestamp == "00:00:30"
    assert "explain your primary growth loop" in parsed.turns[1].text

    # Turn 3 inherits speaker from Turn 2 (Lenny) because timestamp only was provided: (00:00:45)
    assert parsed.turns[2].speaker == "Lenny"
    assert parsed.turns[2].timestamp == "00:00:45"
    assert "viral expansion works" in parsed.turns[2].text

    # Turn 4
    assert parsed.turns[3].speaker == "Test Guest"
    assert parsed.turns[3].timestamp == "00:01:10"
    assert "Viral loops in B2B" in parsed.turns[3].text


def test_content_hash_stability():
    hash1 = compute_content_hash(SAMPLE_MARKDOWN)
    hash2 = compute_content_hash(SAMPLE_MARKDOWN)
    assert hash1 == hash2
    assert len(hash1) == 64

    modified = SAMPLE_MARKDOWN + "\nExtra comment"
    assert compute_content_hash(modified) != hash1


def test_fallback_when_frontmatter_missing():
    raw_text = "Lenny (00:00:01): Hello world without frontmatter."
    parsed = parse_transcript_markdown(raw_text, episode_slug="no-frontmatter")
    assert parsed.episode_slug == "no-frontmatter"
    assert parsed.metadata["title"] == "No Frontmatter"
    assert len(parsed.turns) == 1
    assert parsed.turns[0].speaker == "Lenny"
    assert parsed.turns[0].timestamp == "00:00:01"
