"""A minimal RFC 6455 websocket server on the standard library.

`websockets` would be one line, but `pyproject.toml` belongs to the whole repo
and adding a dependency for one demo panel is not mine to do (AGENTS.md: work
only inside your own directory). What the human seat needs is small enough to
write out: an HTTP upgrade, text frames both ways, ping/pong and a clean close.

Loopback only. There is no authentication here on purpose; nothing in this file
should ever be reachable off the machine running the demo.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
from collections.abc import Awaitable, Callable
from typing import Any

# RFC 6455 section 1.3. Verified against the RFC's own test vector in
# tests/agent7-ui/test_wsproto.py -- a wrong constant here fails in exactly one
# way, "Incorrect Sec-WebSocket-Accept header value", and only from a real
# browser, so it is worth a test rather than a careful read.
GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONT = 0x0
OP_TEXT = 0x1
OP_BINARY = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA


class WebSocketClosed(Exception):
    """The peer went away. Expected; not an error worth a traceback."""


class WebSocket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader = reader
        self.writer = writer
        self.closed = False
        self._send_lock = asyncio.Lock()

    # --- receiving -----------------------------------------------------------

    async def _read_exactly(self, n: int) -> bytes:
        try:
            return await self.reader.readexactly(n)
        except (asyncio.IncompleteReadError, ConnectionResetError) as exc:
            raise WebSocketClosed from exc

    async def recv(self) -> str | None:
        """Next text message, or None once the peer closes."""
        buffer = bytearray()
        opcode: int | None = None
        while True:
            head = await self._read_exactly(2)
            fin = bool(head[0] & 0x80)
            frame_op = head[0] & 0x0F
            masked = bool(head[1] & 0x80)
            length = head[1] & 0x7F
            if length == 126:
                (length,) = struct.unpack("!H", await self._read_exactly(2))
            elif length == 127:
                (length,) = struct.unpack("!Q", await self._read_exactly(8))
            mask = await self._read_exactly(4) if masked else b""
            payload = bytearray(await self._read_exactly(length)) if length else bytearray()
            if masked:
                for i in range(len(payload)):
                    payload[i] ^= mask[i % 4]

            if frame_op == OP_CLOSE:
                await self.close()
                return None
            if frame_op == OP_PING:
                await self._frame(OP_PONG, bytes(payload))
                continue
            if frame_op == OP_PONG:
                continue

            if frame_op in (OP_TEXT, OP_BINARY):
                opcode = frame_op
            buffer += payload
            if fin:
                if opcode == OP_TEXT:
                    return buffer.decode("utf-8", "replace")
                buffer = bytearray()
                opcode = None

    # --- sending -------------------------------------------------------------

    async def _frame(self, opcode: int, data: bytes) -> None:
        if self.closed:
            return
        header = bytearray([0x80 | opcode])
        n = len(data)
        if n < 126:
            header.append(n)
        elif n < (1 << 16):
            header.append(126)
            header += struct.pack("!H", n)
        else:
            header.append(127)
            header += struct.pack("!Q", n)
        async with self._send_lock:
            try:
                self.writer.write(bytes(header) + data)
                await self.writer.drain()
            except (ConnectionResetError, BrokenPipeError) as exc:
                self.closed = True
                raise WebSocketClosed from exc

    async def send_json(self, obj: Any) -> None:
        await self._frame(OP_TEXT, json.dumps(obj, separators=(",", ":")).encode("utf-8"))

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            await self._frame(OP_CLOSE, b"")
        except WebSocketClosed:
            pass
        finally:
            self.writer.close()


Handler = Callable[[WebSocket], Awaitable[None]]


async def _handshake(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bool:
    try:
        request = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    except (TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        writer.close()
        return False

    headers: dict[str, str] = {}
    for raw in request.decode("latin-1").split("\r\n")[1:]:
        if ": " in raw:
            k, v = raw.split(": ", 1)
            headers[k.lower()] = v

    key = headers.get("sec-websocket-key")
    if not key or "websocket" not in headers.get("upgrade", "").lower():
        writer.write(
            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 26\r\n\r\nexpected a websocket\r\n"
        )
        await writer.drain()
        writer.close()
        return False

    accept = base64.b64encode(hashlib.sha1(key.encode() + GUID).digest()).decode()
    writer.write(
        b"HTTP/1.1 101 Switching Protocols\r\n"
        b"Upgrade: websocket\r\n"
        b"Connection: Upgrade\r\n"
        b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n"
    )
    await writer.drain()
    return True


async def serve(handler: Handler, host: str = "127.0.0.1", port: int = 8778) -> asyncio.Server:
    async def on_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if not await _handshake(reader, writer):
            return
        ws = WebSocket(reader, writer)
        try:
            await handler(ws)
        except WebSocketClosed:
            pass
        finally:
            await ws.close()

    return await asyncio.start_server(on_client, host, port)
