# DEDSEC Messenger — server architecture update

## What changed

- Server-authoritative authentication with bcrypt password hashing.
- HttpOnly, Secure, SameSite session cookie instead of client-side auth state.
- `/api/me` session validation on page load.
- Protected contacts, user lookup and direct-message endpoints.
- Direct messages are stored on the server and delivered through Socket.IO.
- Socket.IO identity comes from the authenticated session cookie; client `userId` is not trusted.
- WebRTC signaling is authorized against the authenticated user and their contacts.
- Basic login/registration rate limiting.
- Same-origin protection for API requests.
- Strong password validation is enforced server-side.
- `localStorage` is retained only as a non-sensitive UI cache.
- Online/offline state is maintained by authenticated Socket.IO connections.
- Existing visual design and playtest/feedback areas are preserved.

## Important deployment note

The current database engine is still SQLite/sql.js. On Render, configure `DB_PATH` to a file located on a Persistent Disk if you need data to survive restarts/redeploys. For multiple app instances, migrate the database and session/rate-limit state to PostgreSQL/shared storage.
