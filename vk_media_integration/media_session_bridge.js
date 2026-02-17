// ==UserScript==
// @name         VK Media Integration
// @namespace    http://tampermonkey.net/
// @version      2026-02-11
// @description  Bridges VK's player with Media Session API.
// @author       exec4tble
// @match        https://vk.com/*
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
            const t = JSON.parse(raw);
            return {
                title: decodeHtmlEntities(t[3] || ''),
                artist: decodeHtmlEntities(t[4] || ''),
                duration: Number(t[5]) || 0,
                thumbnail: t[14] || null,
                trackId: (t[26] ? t[26].split(',')[0] : null) || `${t[3]}|${t[4]}`
            };
        } catch (e) {
            return null;
        }
    }

    function updateMediaSession(track) {
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
            console.error('MediaMetadata error', e);
        }
    }
    setInterval(() => {
        try {
            const track = getTrackFromLocalStorage();
            if (!track) {
                return;
            }
            window.title = `${track.title} • ${track.artist}`;
            document.title = `${track.title} • ${track.artist}`;
            updateMediaSession(track);
        } catch (e) { }
    }, 200);

})();