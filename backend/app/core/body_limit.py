"""Refuse oversized request bodies before they are read into memory (finding S-08).

Uploads arrive as base64 text inside JSON. The size check on those endpoints ran only AFTER the whole body had
been read and decoded, so one request carrying hundreds of MB (or a few hundred in parallel) could exhaust the
server's memory and take the app down for everyone. This guard rejects a body that is too big by its declared
Content-Length straight away, and also counts the bytes of chunked bodies that declare no length.
"""
import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings


async def _send_413(send: Send) -> None:
    body = json.dumps({"detail": "Request is too large."}).encode()
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int | None = None):
        self.app = app
        self.max_bytes = max_bytes or get_settings().MAX_REQUEST_BODY_BYTES

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    return await _send_413(send)
            except ValueError:
                return await _send_413(send)

        seen = 0
        too_big = False
        started = False

        async def limited_receive() -> Message:
            nonlocal seen, too_big
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    too_big = True
                    # Stop feeding the app; it will see a disconnect and abandon the request.
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if too_big and not started:
                started = True
                return await _send_413(send)
            if too_big:
                return
            started = True
            await send(message)

        await self.app(scope, limited_receive, guarded_send)
        if too_big and not started:
            await _send_413(send)
