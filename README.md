# Musico Bot

Musico is a Discord music bot that plays Spotify tracks by resolving them through YouTube. It features a guild-based queue system and supports the following slash-style commands (prefixed with `/`):

- `/play <url | search terms>` — Add a Spotify track URL or search terms to the queue and start playback.  
- `/skip` — Skip the current track.  
- `/pause` — Pause playback.  
- `/resume` — Resume paused playback.  
- `/stop` — Stop playback, clear the queue, and leave the voice channel.  
- `/queue` — List the current queue and now playing track.  
- `/nowplaying` or `/np` — Show the track currently playing.

---

## Features

- **Spotify Integration**: Fetches metadata via the Spotify Web API.  
- **YouTube Streaming**: Searches and streams audio from YouTube for DRM-protected Spotify content.  
- **Queue System**: Maintains per-guild queues with automatic track advancement.  
- **Voice Channel Management**: Joins and leaves voice channels as needed.