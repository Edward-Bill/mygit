// ==UserScript==
// @name         VK Media Integration
// @namespace    http://tampermonkey.net/
// @version      2026-02-11
// @description  AI Generated. Bridges VK's player with Media Session API.
// @author       exec4tble
// @match        https://vk.com/audios303447921
// @icon         https://www.google.com/s2/favicons?sz=64&domain=vk.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.VK_MEDIA_SESSION_BRIDGE) return;
    window.VK_MEDIA_SESSION_BRIDGE = true;

    function decodeHtmlEntities(str) {
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    function getTrackFromLocalStorage() {
        const userId = localStorage.getItem('userId');
        if (!userId) return null;

        const raw = localStorage.getItem(`audio_v20_track_${userId}`);
        if (!raw) return null;

        try {
            const track = JSON.parse(raw);
            return {
                title: decodeHtmlEntities(track[3]),
                artist: decodeHtmlEntities(track[4]),
                duration: Number(track[5]) || 0,
                thumbnail: track[14] || null,
                trackUrl: track[26] ? track[26].split(',')[0] : null
            };
        } catch (e) {
            return null;
        }
    }

    function findPlayButton() {
        return document.querySelector('[data-testid="audio-player-play-button"]')
            || document.querySelector('.audio_page_player_play')
            || document.querySelector('.audio_play')
            || document.querySelector('[aria-label] button[aria-pressed]')
            || null;
    }

    function tryTogglePlay() {
        const btn = findPlayButton();
        if (btn) {
            try { btn.click(); return true; } catch (e) {}
        }
        return false;
    }

    let lastMeta = {};
    let lastState = null;

    function updateMediaSession(track, isPlaying, positionSec) {
        if (!('mediaSession' in navigator)) return;

        const artwork = [];
        if (track.thumbnail) {
            artwork.push({ src: track.thumbnail, sizes: '512x512', type: 'image/png' });
        }

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || '',
                artist: track.artist || '',
                album: '',
                artwork
            });
        } catch (e) {
            try { navigator.mediaSession.setMetadata && navigator.mediaSession.setMetadata({
                title: track.title || '', artist: track.artist || '', album: '', artwork
            }); } catch (e2) {}
        }

        lastMeta = { title: track.title, artist: track.artist, artwork: track.thumbnail };

        const desiredState = isPlaying ? 'playing' : 'paused';
        if (lastState !== desiredState) {
            try { navigator.mediaSession.playbackState = desiredState; } catch (e) {}
            lastState = desiredState;
        }

        if (typeof navigator.mediaSession.setPositionState === 'function') {
            try {
                navigator.mediaSession.setPositionState({
                    duration: track.duration || 0,
                    position: positionSec || 0,
                    playbackRate: 1.0
                });
            } catch (e) {}
        }
    }

    try {
        navigator.mediaSession.setActionHandler('play', () => { tryTogglePlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { tryTogglePlay(); });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            const slider = document.querySelector('[data-testid="audio-player-block-progress-bar"]');
            if (slider && typeof details === 'object' && details.seekTime != null) {
                const s = slider.querySelectorAll('[role="slider"]:not([aria-readonly="true"])')[1];
                if (s) {
                    const dur = Number(rawDurationFromLocal()) || 0;
                    if (dur > 0) {
                        const pct = Math.max(0, Math.min(100, Math.round(details.seekTime / dur * 100)));
                        try { s.setAttribute('aria-valuenow', String(pct)); s.dispatchEvent(new Event('change')); } catch (e) {}
                    }
                }
            }
        });
    } catch (e) {}

    function rawDurationFromLocal() {
        try {
            const u = localStorage.getItem('userId');
            if (!u) return 0;
            const r = localStorage.getItem(`audio_v20_track_${u}`);
            if (!r) return 0;
            const t = JSON.parse(r);
            return Number(t[5]) || 0;
        } catch (e) { return 0; }
    }

    setInterval(() => {
        try {
            const rawTrack = getTrackFromLocalStorage();
            if (!rawTrack) return;

            const playingRaw = localStorage.getItem('audio_playing');
            const isPlaying = (playingRaw === 'true' || playingRaw === '1');

            let position = 0;
            try {
                const sliderRoot = document.querySelector('[data-testid="audio-player-block-progress-bar"]');
                if (sliderRoot) {
                    const sliderValue = sliderRoot.querySelectorAll('[role="slider"]:not([aria-readonly="true"])')[1].getAttribute('aria-valuenow');
                    const dur = Number(rawTrack.duration) || 0;
                    const s = Number(sliderValue);
                    if (!isNaN(s) && s > 0 && dur > 0) position = Math.floor(dur * s / 100);
                }
            } catch (e) {}

            updateMediaSession(rawTrack, isPlaying, position);
        } catch (e) {}
    }, 500);

})();
