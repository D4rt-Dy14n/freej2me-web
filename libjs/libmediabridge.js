// this needs to be run on the main thread
// assuming window.libmedia has the instance and contexte
export default {
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_createMediaPlayer(lib) {
        const player = window.libmedia.createMediaPlayer();
        if (!player.__eomHook) {
            player.addEventListener('end-of-media', () => {
                window.emulator.call('pl/zb3/freej2me/bridge/media/MediaBridge', 'playerEndOfMedia', [player]);
            });
            player.__eomHook = true;
        }
        return player;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_createPlayer(lib) {
        return this.Java_pl_zb3_freej2me_bridge_media_MediaBridge_createMediaPlayer(lib);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerLoad(lib, player, contentType, data) {
        const res = await player.load(contentType, data.buffer);
        return res;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerPlay(lib, player) {
        console.log('[MB] playerPlay', {
            id: player?.playerId, 
            ts: Date.now(),
            mediaElementState: player?.mediaElement ? {
                paused: player.mediaElement.paused,
                ended: player.mediaElement.ended,
                currentTime: player.mediaElement.currentTime,
                duration: player.mediaElement.duration
            } : null
        });
        
        // ФИКС: Автоматический сброс если MediaPlayer уже завершался
        // Это компенсирует проблему с жизненным циклом в Java коде
        if (player?.hasEndedOnce || player?.mediaElement?.ended) {
            console.log('[MB] playerPlay: MediaPlayer завершался ранее или в состоянии ended, делаем reset и ждем завершения');
            await player.reset(); // ФИКС: ждем завершения reset перед play
        }
        
        await player.play();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerPause(lib, player) {
        console.log('[MB] playerPause', {id: player?.playerId, ts: Date.now()});
        player.pause();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerStop(lib, player) {
        console.log('[MB] playerStop', {id: player?.playerId, ts: Date.now()});
        player.stop();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerReset(lib, player) {
        console.log('[MB] playerReset', {id: player?.playerId, ts: Date.now()});
        await player.reset();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetPosition(lib, player) {
        return player.getPosition();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetPosition(lib, player, pos) {
        return player.setPosition(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSeek(lib, player, pos) {
        player.seek(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerClose(lib, player) {
        player.close();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetVolume(lib, player) {
        return player.volume;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetVolume(lib, player, vol) {
        player.volume = vol;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetupVideo(lib, player, ctxObj, javaPlayerObj, x, y, w, h, fullscreen) {
        player.configureVideo(ctxObj, () => {
            //debugger;
            window.evtQueue.queueEvent(
                {kind: 'player-video-frame', player: javaPlayerObj},
                // skip if we already queued this event
                evt => evt.kind === 'player-video-frame' && evt.player === javaPlayerObj
            );
        }, x, y, w, h, fullscreen)
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetWidth(lib, player) {
        return player.videoWidth;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetHeight(lib, player) {
        return player.videoHeight;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetSnapshot(lib, player, type) {
        const buffer = await player.getSnapshot(type);
        return buffer ? new Int8Array(buffer) : null;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetLooping(lib, player, loop) {
        player.setLooping(loop);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetDuration(lib, player) {
        return player.duration ?? -1;
    },
}
