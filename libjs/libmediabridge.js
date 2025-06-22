// this needs to be run on the main thread
// assuming window.libmedia has the instance and contexte
export default {
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_createMediaPlayer(lib) {
        const player = window.libmedia.createMediaPlayer();
        player.addEventListener('end-of-media', () => {
            window.emulator.call('pl/zb3/freej2me/bridge/media/MediaBridge', 'playerEndOfMedia', [player]);
        });
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
        await player.play();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerPause(lib, player) {
        player.pause();
    },
    async Java_pl_zb3_freej2me_bridge_media_MediaBridge_playerStop(lib, player) {
        player.stop();
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
}
