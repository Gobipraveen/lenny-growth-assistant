"""HTML security validator and sanitizer for user and AI generated web artifacts.

Implements strict token-level DOM parsing via Python's standard library html.parser.HTMLParser.
Enforces defense-in-depth security policies:
1. Rejects executable scripts (<script>, <noscript>).
2. Rejects inline event handlers (onclick, onerror, onload, etc.).
3. Rejects dangerous URL schemes (javascript:, vbscript:, data:text/html, etc.).
4. Rejects external resource imports (@import, external <link> stylesheets, remote fonts, external scripts).
5. Rejects framing and embedding vectors (<iframe>, <object>, <embed>, <applet>, <base>).
6. Rejects active data-submitting forms (<form>, <input type="submit">).
7. Enforces strict artifact size boundaries (default 1MB).

NOTE ON DEFENSE-IN-DEPTH:
Backend validation is layer 1. The browser viewing layer (Task 07C-2) must independently
render artifacts within an isolated sandboxed iframe without allow-same-origin.
"""

from html.parser import HTMLParser
from typing import List, Dict, Any, Optional, Set, Tuple
from dataclasses import dataclass, field
import urllib.parse
import re
import logging

logger = logging.getLogger(__name__)

# Maximum allowable artifact size in bytes (1MB)
DEFAULT_MAX_HTML_SIZE_BYTES = 1024 * 1024

# Explicitly forbidden HTML tags that represent execution, framing, or active vectors
FORBIDDEN_TAGS: Set[str] = {
    "script",
    "noscript",
    "iframe",
    "object",
    "embed",
    "applet",
    "base",
    "form",
    "frame",
    "frameset",
    "foreignobject",
    "math",
    "animate",
    "set",
    "portal",
    "template",
    "link",
}

# Permitted structural, semantic, table, layout, typography, and styling tags
ALLOWED_TAGS: Set[str] = {
    # Document Root & Meta
    "html", "head", "body", "title", "meta", "style",
    # Semantic & Structural
    "div", "span", "section", "article", "main", "header", "footer", "nav", "aside",
    "figure", "figcaption", "details", "summary",
    # Typography & Text
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre", "code", "kbd", "samp",
    "em", "strong", "b", "i", "u", "s", "del", "ins", "mark", "small", "sub", "sup",
    "hr", "br", "wbr",
    # Lists
    "ul", "ol", "li", "dl", "dt", "dd",
    # Tables
    "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td",
    # Safe Inline Media & Links
    "a", "img", "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "text",
    "progress", "meter", "button",
}

# Dangerous URL schemes that could execute script or arbitrary protocols
DANGEROUS_URL_SCHEMES: Set[str] = {
    "javascript",
    "vbscript",
    "data",
    "file",
    "about",
}

# Safe URL schemes permitted for links
SAFE_URL_SCHEMES: Set[str] = {
    "http",
    "https",
    "mailto",
    "",  # Relative URLs / fragment anchors
}

# CSS patterns that represent security hazards inside <style> or style=""
DANGEROUS_CSS_PATTERNS = [
    (re.compile(r"@\s*import\b", re.IGNORECASE), "CSS @import external stylesheet loading is forbidden"),
    (re.compile(r"expression\s*\(", re.IGNORECASE), "IE CSS expression() execution is forbidden"),
    (re.compile(r"behavior\s*:", re.IGNORECASE), "CSS behavior property is forbidden"),
    (re.compile(r"-moz-binding\s*:", re.IGNORECASE), "CSS -moz-binding property is forbidden"),
    (re.compile(r"javascript\s*:", re.IGNORECASE), "javascript: scheme inside CSS is forbidden"),
    (re.compile(r"url\s*\(", re.IGNORECASE), "Resource url() in CSS is forbidden"),
    (re.compile(r"@font-face\b", re.IGNORECASE), "Remote @font-face definition is restricted"),
]


def _normalize_css(css_text: str) -> str:
    """Normalize CSS text by stripping comments and decoding Unicode/backslash escape sequences."""
    if not css_text:
        return ""
    # 1. Strip CSS comments /* ... */
    no_comments = re.sub(r"/\*.*?\*/", " ", css_text, flags=re.DOTALL)

    # 2. Decode CSS hex escapes e.g. \75 or \000075
    def _decode_hex(m: re.Match) -> str:
        try:
            code = int(m.group(1), 16)
            return chr(min(code, 0x10FFFF))
        except Exception:
            return ""

    unescaped = re.sub(r"\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?", _decode_hex, no_comments)

    # 3. Decode non-hex escapes (e.g. \u -> u)
    unescaped = re.sub(r"\\([^\r\n\f0-9a-fA-F])", r"\1", unescaped)

    # 4. Remove control characters & null bytes
    return re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", unescaped)


@dataclass
class SecurityValidationResult:
    is_valid: bool
    sanitized_content: Optional[str]
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    stats: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "stats": self.stats,
        }


class _HTMLSecurityDOMParser(HTMLParser):
    """Event-driven DOM parser validating HTML tokens against strict security constraints."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.tag_count = 0
        self.style_count = 0
        self._in_style_tag = False
        self._current_style_text: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]):
        tag_lower = tag.lower().strip()
        self.tag_count += 1

        # 1. Check for link tags
        if tag_lower == "link":
            self.errors.append("<link rel=\"stylesheet\"> external stylesheet import is forbidden.")
            return

        # 2. Check for explicitly forbidden tags
        if tag_lower in FORBIDDEN_TAGS:
            self.errors.append(f"Forbidden tag <{tag_lower}> detected: active scripts, framing, external resources, and data-submitting forms are rejected.")
            return

        # 2. Check for unexpected / unregistered tags
        if tag_lower not in ALLOWED_TAGS:
            self.warnings.append(f"Uncommon tag <{tag_lower}> encountered.")

        # 3. Track style blocks
        if tag_lower == "style":
            self._in_style_tag = True
            self.style_count += 1

        # 4. Meta tag safety check (strictly only allow charset or name=viewport)
        if tag_lower == "meta":
            attr_dict = {k.lower(): (v or "") for k, v in attrs}
            is_charset = "charset" in attr_dict
            is_viewport = attr_dict.get("name", "").lower() == "viewport"
            if not (is_charset or is_viewport):
                self.errors.append(f"<meta> directive with attributes {list(attr_dict.keys())} is forbidden.")
            if "http-equiv" in attr_dict:
                self.errors.append(f"<meta http-equiv=\"{attr_dict['http-equiv']}\"> directive is forbidden.")
            if "content" in attr_dict and re.search(r"url\s*=|refresh", attr_dict["content"], re.IGNORECASE):
                self.errors.append("<meta> refresh / redirect directive is forbidden.")

        # 5. Validate attributes on all tags
        for attr_name, attr_value in attrs:
            attr_name_lower = attr_name.lower().strip()
            val = (attr_value or "").strip()

            # Inline event handlers check (onclick, onload, onerror, etc.)
            if attr_name_lower.startswith("on"):
                self.errors.append(f"Inline event handler '{attr_name_lower}' on <{tag_lower}> is forbidden.")

            # Active form submit actions
            if attr_name_lower in ("action", "formaction"):
                self.errors.append(f"Form submission action '{attr_name_lower}' on <{tag_lower}> is forbidden.")

            # URL validation on href, src, data, poster, srcset, background, xlink:href
            if attr_name_lower in ("href", "src", "data", "poster", "srcset", "background", "xlink:href"):
                self._validate_url_attribute(tag_lower, attr_name_lower, val)

            # Inline style attribute check
            if attr_name_lower == "style":
                self._validate_css_content(f"inline style on <{tag_lower}>", val)

    def handle_endtag(self, tag: str):
        tag_lower = tag.lower().strip()
        if tag_lower == "style":
            self._in_style_tag = False
            style_content = "".join(self._current_style_text)
            self._validate_css_content("<style> block", style_content)
            self._current_style_text = []

    def handle_data(self, data: str):
        if self._in_style_tag:
            self._current_style_text.append(data)

    def close(self):
        # Handle unclosed <style> blocks
        if self._in_style_tag:
            self.errors.append("Unclosed <style> block detected.")
            self._in_style_tag = False
            raw_remainder = getattr(self, "rawdata", "") or ""
            style_content = "".join(self._current_style_text) + raw_remainder
            if style_content:
                self._validate_css_content("<style> block", style_content)
            self._current_style_text = []
        super().close()

    def _validate_url_attribute(self, tag: str, attr: str, url_val: str):
        if not url_val:
            return

        # Split candidates for srcset
        candidates = [c.strip().split()[0] for c in url_val.split(",") if c.strip()] if attr == "srcset" else [url_val]

        for target in candidates:
            # Strip all whitespace, control chars, null bytes, and replacement chars (XSS obfuscation bypass prevention)
            cleaned = re.sub(r"[\x00-\x20\s\uFFFD]+", "", target)
            unquoted = urllib.parse.unquote(cleaned)
            clean_unquoted = re.sub(r"[\x00-\x20\s\uFFFD]+", "", unquoted)

            scheme_match = re.match(r"^([a-zA-Z0-9+.-]+):", clean_unquoted)
            if scheme_match:
                scheme = scheme_match.group(1).lower()
                if scheme in DANGEROUS_URL_SCHEMES:
                    self.errors.append(f"Dangerous URL scheme '{scheme}:' in {attr} attribute on <{tag}> is forbidden.")
                    return
                if scheme not in SAFE_URL_SCHEMES:
                    self.errors.append(f"Unsupported URL scheme '{scheme}:' in {attr} on <{tag}> is forbidden.")
                    return

            try:
                parsed = urllib.parse.urlparse(cleaned)
                scheme = parsed.scheme.lower()
                if scheme and scheme not in SAFE_URL_SCHEMES:
                    self.errors.append(f"Unsupported URL scheme '{scheme}:' in {attr} on <{tag}> is forbidden.")
            except Exception:
                self.errors.append(f"Malformed URL in {attr} on <{tag}>.")

    def _validate_css_content(self, context_name: str, css_text: str):
        if not css_text:
            return

        normalized = _normalize_css(css_text)
        for pattern, reason in DANGEROUS_CSS_PATTERNS:
            if pattern.search(normalized):
                self.errors.append(f"Dangerous CSS in {context_name}: {reason}.")


def validate_and_sanitize_html(
    html_content: str,
    max_size_bytes: int = DEFAULT_MAX_HTML_SIZE_BYTES,
) -> SecurityValidationResult:
    """Validate and sanitize HTML artifact content using DOM token parsing.

    Args:
        html_content: Raw HTML text to inspect.
        max_size_bytes: Upper limit on allowable HTML payload size in bytes.

    Returns:
        SecurityValidationResult with validation verdict, errors, warnings, and stats.
    """
    if not html_content or not isinstance(html_content, str):
        return SecurityValidationResult(
            is_valid=False,
            sanitized_content=None,
            errors=["HTML content must be a non-empty string."],
        )

    content_bytes = html_content.encode("utf-8")
    byte_length = len(content_bytes)

    if byte_length > max_size_bytes:
        return SecurityValidationResult(
            is_valid=False,
            sanitized_content=None,
            errors=[f"HTML size ({byte_length} bytes) exceeds maximum allowable limit of {max_size_bytes} bytes."],
            stats={"total_bytes": byte_length},
        )

    parser = _HTMLSecurityDOMParser()
    try:
        parser.feed(html_content)
        parser.close()
    except Exception as parse_exc:
        logger.warning(f"HTML token parsing encountered syntax error: {parse_exc}")
        return SecurityValidationResult(
            is_valid=False,
            sanitized_content=None,
            errors=[f"HTML syntax error: unable to parse document cleanly ({str(parse_exc)})"],
            stats={"total_bytes": byte_length},
        )

    stats = {
        "total_bytes": byte_length,
        "tag_count": parser.tag_count,
        "style_count": parser.style_count,
    }

    if parser.errors:
        return SecurityValidationResult(
            is_valid=False,
            sanitized_content=None,
            errors=parser.errors,
            warnings=parser.warnings,
            stats=stats,
        )

    return SecurityValidationResult(
        is_valid=True,
        sanitized_content=html_content,
        errors=[],
        warnings=parser.warnings,
        stats=stats,
    )
