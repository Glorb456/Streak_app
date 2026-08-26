import pytest

from app.store import snippet_of


@pytest.mark.parametrize(
    "text, expected",
    [
        ("", ""),
        ("plain line", "plain line"),
        ("# Heading\n\nbody text", "Heading body text"),
        ("- [ ] milk\n- [x] eggs", "milk eggs"),
        ("- one\n- two", "one two"),
        ("**bold** and _thin_", "bold and thin"),
        ("see [the docs](https://example.com/x)", "see the docs"),
        ("> quoted", "quoted"),
        ("Title\n=====\nbody", "Title body"),
        ("intro\n\n```\ncode = 1\n```\n\nafter", "intro after"),
    ],
)
def test_snippet_is_flat_prose(text, expected):
    assert snippet_of(text) == expected


def test_snippet_is_capped():
    assert len(snippet_of("word " * 200)) <= 90
