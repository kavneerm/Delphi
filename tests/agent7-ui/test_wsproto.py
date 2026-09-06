"""The websocket handshake, pinned to RFC 6455's own test vector.

This exists because of a real failure: the magic GUID had its last two groups
mis-split, and nothing caught it. The bytes on the wire looked correct, a naive
raw-socket client accepted them, and the only symptom was a real browser
refusing to connect with "Incorrect 'Sec-WebSocket-Accept' header value" -- which
is invisible unless you happen to be driving a browser at the time.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import socket
import threading

from ui.server.wsproto import GUID, WebSocket, serve

# RFC 6455 section 1.3.
RFC_KEY = b"dGhlIHNhbXBsZSBub25jZQ=="
RFC_ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="


def _accept(key: bytes) -> str:
    return base64.b64encode(hashlib.sha1(key + GUID).digest()).decode()


def test_guid_reproduces_the_rfc_test_vector() -> None:
    assert _accept(RFC_KEY) == RFC_ACCEPT


def test_guid_is_the_rfc_constant() -> None:
    assert GUID == b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    assert len(GUID) == 36


def _handshake_over_a_real_socket(port: int) -> tuple[bytes, str]:
    """Speak the client half by hand and check the accept the server computes."""
    key = base64.b64encode(os.urandom(16))
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(
            b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
            b"Connection: Upgrade\r\nSec-WebSocket-Key: " + key + b"\r\n"
            b"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.settimeout(5)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        head, _, rest = buf.partition(b"\r\n\r\n")
        # Read the server's first frame too, so frame encoding is covered.
        while len(rest) < 2:
            rest += sock.recv(4096)
        assert rest[0] == 0x81, "first frame should be a final text frame"
        length = rest[1] & 0x7F
        assert not rest[1] & 0x80, "server frames must never be masked"
        while len(rest) < 2 + length:
            rest += sock.recv(4096)
        payload = rest[2 : 2 + length].decode()
    return key, _header(head.decode("latin-1"), "sec-websocket-accept"), payload


def _header(head: str, name: str) -> str:
    for line in head.split("\r\n")[1:]:
        k, _, v = line.partition(": ")
        if k.lower() == name:
            return v
    return ""


def test_server_completes_a_handshake_and_sends_a_valid_frame() -> None:
    ready = threading.Event()
    box: dict[str, object] = {}

    async def handler(ws: WebSocket) -> None:
        await ws.send_json({"ev": "hello"})
        await asyncio.sleep(0.2)

    async def run() -> None:
        server = await serve(handler, "127.0.0.1", 0)
        box["port"] = server.sockets[0].getsockname()[1]
        ready.set()
        async with server:
            await asyncio.sleep(3)

    thread = threading.Thread(target=lambda: asyncio.run(run()), daemon=True)
    thread.start()
    assert ready.wait(5), "server did not start"

    key, accept, payload = _handshake_over_a_real_socket(int(box["port"]))
    assert accept == _accept(key), "the accept a browser checks does not match"
    assert json.loads(payload) == {"ev": "hello"}
