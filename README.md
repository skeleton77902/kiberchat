# kiberchat


## Server-backed architecture (updated)

The messenger now uses the server as the source of truth for authentication, contacts, direct messages and Socket.IO/WebRTC signaling. Browser localStorage is only a presentation cache and is never used to store passwords, password hashes, salts, sessions or TOTP secrets.

### Production / Render
- Set DB_PATH to a path on a Render Persistent Disk if SQLite data must survive redeploys/restarts.
- The app serves on PORT supplied by Render.
- Run with npm start.
- For multi-instance production, replace SQLite/sql.js with PostgreSQL and move sessions/rate limiting to shared infrastructure.


## Visual identity

KiberChat uses an original Obsidian / Aurora visual system: dark editorial surfaces, restrained violet/sky accents, soft glass panels and minimal motion. The interface does not intentionally reproduce any third-party entertainment franchise branding, characters, artwork, or signature visual motifs.
