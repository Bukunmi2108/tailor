import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .config import Settings, get_settings


class LoginRequest(BaseModel):
    passphrase: str = Field(min_length=1, max_length=512)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class LoginLimiter:
    def __init__(self, limit: int = 6, window_seconds: int = 300) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.attempts: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        attempts = self.attempts[key]
        while attempts and now - attempts[0] > self.window_seconds:
            attempts.popleft()
        if len(attempts) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many login attempts. Try again shortly.")
        attempts.append(now)

    def clear(self, key: str) -> None:
        self.attempts.pop(key, None)


limiter = LoginLimiter()
bearer = HTTPBearer(auto_error=False)
ph = PasswordHasher()


def authenticate(request: Request, payload: LoginRequest, settings: Settings) -> LoginResponse:
    key = request.client.host if request.client else "unknown"
    limiter.check(key)
    if not settings.configured:
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    try:
        ph.verify(settings.tailor_password_hash, payload.passphrase)
    except (VerifyMismatchError, InvalidHashError):
        raise HTTPException(status_code=401, detail="Invalid passphrase") from None
    limiter.clear(key)
    now = datetime.now(UTC)
    expires = now + timedelta(hours=settings.auth_token_ttl_hours)
    token = jwt.encode(
        {"sub": "tailor-owner", "iat": now, "exp": expires, "aud": "tailor-api"},
        settings.auth_signing_secret,
        algorithm="HS256",
    )
    return LoginResponse(access_token=token, expires_at=expires)


def verify_token(token: str, settings: Settings) -> str:
    try:
        claims = jwt.decode(
            token,
            settings.auth_signing_secret,
            algorithms=["HS256"],
            audience="tailor-api",
        )
    except jwt.PyJWTError as exc:
        raise InvalidToken("Invalid or expired token") from exc
    return str(claims["sub"])


class InvalidToken(ValueError):
    pass


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        return verify_token(credentials.credentials, settings)
    except InvalidToken as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
