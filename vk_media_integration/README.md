
# VK Media Integration

This folder contains a small script that bridges VK's in-page audio player to the
Browser Media Session API so desktop environments (including Plasma) and other
media widgets can show correct track titles, artwork and playback state.

Usage
- Inject `media_session_bridge.js` into pages on `vk.com` (for example via the
  existing `loader.js` mechanism or a userscript). The script polls VK's
  localStorage audio info and updates `navigator.mediaSession` accordingly.

Notes
- The script does not implement MPRIS directly; modern browsers expose Media
  Session data to the desktop so this is sufficient for Plasma Integration.
