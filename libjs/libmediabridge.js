// this needs to be run on the main thread
// assuming window.libmedia has the instance and contexte
export default {
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_createPlayer(lib) {
        console.log('🎵 MediaBridge: createPlayer() вызван');
        const player = window.libmedia.createMediaPlayer();
        console.log('🎵 MediaBridge: MediaPlayer создан:', player);
        if (!player.__eomHook) {
            player.addEventListener('end-of-media', () => {
                console.log('🎵 MediaBridge: end-of-media событие от player:', player);
                window.emulator.call('pl/zb3/freej2me/bridge/media/MediaBridge', 'playerEndOfMedia', [player]);
            });
            player.__eomHook = true;
        }
        return player;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerLoad(lib, player, contentType, data) {
        console.log('🎵 MediaBridge: playerLoad() вызван, contentType:', contentType, 'dataSize:', data?.buffer?.byteLength);
        const res = await player.load(contentType, data.buffer);
        console.log('🎵 MediaBridge: playerLoad() результат:', res);
        return res;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerPlay(lib, player) {
        console.log('🎵 MediaBridge: playerPlay() вызван для player:', player, {
            hasEndedOnce: player?.hasEndedOnce,
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
            console.log('🎵 MediaBridge: MediaPlayer завершался ранее или в состоянии ended, делаем reset и ждем завершения');
            await player.reset(); // ФИКС: ждем завершения reset перед play
        }
        
        await player.play();
        console.log('🎵 MediaBridge: playerPlay() завершен');
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerPause(lib, player) {
        console.log('🎵 MediaBridge: playerPause() вызван');
        player.pause();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerStop(lib, player) {
        console.log('🎵 MediaBridge: playerStop() вызван');
        player.stop();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerReset(lib, player) {
        console.log('🎵 MediaBridge: playerReset() вызван');
        await player.reset();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetPosition(lib, player) {
        const pos = player.getPosition();
        console.log('🎵 MediaBridge: playerGetPosition() =', pos);
        return pos;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetPosition(lib, player, pos) {
        console.log('🎵 MediaBridge: playerSetPosition() pos=', pos);
        return player.setPosition(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSeek(lib, player, pos) {
        console.log('🎵 MediaBridge: playerSeek() pos=', pos);
        player.seek(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerClose(lib, player) {
        console.log('🎵 MediaBridge: playerClose() вызван');
        player.close();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetVolume(lib, player) {
        const vol = player.volume;
        console.log('🎵 MediaBridge: playerGetVolume() =', vol);
        return vol;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetVolume(lib, player, vol) {
        console.log('🎵 MediaBridge: playerSetVolume() vol=', vol);
        player.volume = vol;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerSetupVideo(lib, player, ctxObj, javaPlayerObj, x, y, w, h, fullscreen) {
        console.log('🎵 MediaBridge: playerSetupVideo() вызван');
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
        const width = player.videoWidth;
        console.log('🎵 MediaBridge: playerGetWidth() =', width);
        return width;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetHeight(lib, player) {
        const height = player.videoHeight;
        console.log('🎵 MediaBridge: playerGetHeight() =', height);
        return height;
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerGetSnapshot(lib, player, type) {
        console.log('🎵 MediaBridge: playerGetSnapshot() type=', type);
        const buffer = await player.getSnapshot(type);
        return buffer ? new Int8Array(buffer) : null;
    },
}
