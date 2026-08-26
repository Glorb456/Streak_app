import hashlib
import io

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 40
GIF = b"GIF89a" + b"\x00" * 20
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20
HEIC = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 20


def upload(client, data, name="x.png"):
    return client.post("/api/notes/assets", files={"file": (name, io.BytesIO(data), "image/png")})


def test_upload_returns_a_content_addressed_id(client):
    r = upload(client, PNG)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == f"{hashlib.sha256(PNG).hexdigest()[:32]}.png"
    assert body["type"] == "image/png"


def test_the_same_image_is_stored_once(client, notebook):
    a = upload(client, PNG).json()["id"]
    b = upload(client, PNG).json()["id"]
    assert a == b
    assert len(list((notebook / ".assets").iterdir())) == 1


def test_every_supported_format_is_recognised_by_its_bytes(client):
    for data, ext in ((PNG, "png"), (JPEG, "jpg"), (GIF, "gif"), (WEBP, "webp"), (HEIC, "heic")):
        assert upload(client, data).json()["id"].endswith(f".{ext}")


def test_the_declared_name_and_type_are_ignored(client):
    """A lying filename must not decide how the file is stored or served."""
    r = client.post(
        "/api/notes/assets",
        files={"file": ("evil.svg", io.BytesIO(PNG), "image/svg+xml")},
    )
    assert r.json()["id"].endswith(".png")
    assert r.json()["type"] == "image/png"


def test_a_non_image_is_refused(client):
    # Otherwise the upload endpoint is a way to park arbitrary bytes in the
    # notebook and fetch them back under a content type of the caller's choice.
    assert upload(client, b"<svg onload=alert(1)>").status_code == 400
    assert upload(client, b"#!/bin/sh\nrm -rf /").status_code == 400
    assert upload(client, b"").status_code == 400


def test_an_oversize_image_is_refused(client):
    assert upload(client, PNG + b"\x00" * (12 * 1024 * 1024)).status_code == 413


def test_an_asset_can_be_fetched_back(client):
    asset_id = upload(client, PNG).json()["id"]
    r = client.get(f"/api/notes/assets/{asset_id}")
    assert r.status_code == 200
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert "immutable" in r.headers["cache-control"]


def test_asset_ids_are_matched_not_resolved(client, notebook, tmp_path):
    """The asset id is the one identifier a client names directly."""
    secret = tmp_path / "secret"
    secret.write_text("password")
    for bad in (
        "../../secret", "..%2f..%2fsecret", "x.png", "abc.png",
        "0123456789abcdef0123456789abcdef.exe", "", "....png",
    ):
        assert client.get(f"/api/notes/assets/{bad}").status_code in (404, 405)
    assert secret.read_text() == "password"


def test_the_asset_store_is_not_a_section(client, notebook):
    upload(client, PNG)
    assert client.get("/api/notes/tree").json() == []
