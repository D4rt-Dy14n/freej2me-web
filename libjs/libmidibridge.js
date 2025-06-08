// LibMidiBridge
let cachedMidiPlayer = null; // Кешированная ссылка на плеер для Java

function getMidiPlayer() {
    const player = window.libmidi.midiPlayer;
    return player;
}

function midiSetSequence(sequence) {
    const player = getMidiPlayer();
    if (sequence && player) {
        player.setSequence(sequence);
    }
}

function midiPlay() {
    const player = getMidiPlayer();
    player.play();
}

function midiLoop(times) {
    const player = getMidiPlayer();
    player.loop(times);
}

function midiStop() {
    const player = getMidiPlayer();
    player.stop();
}

function midiShortEvent(status, data1, data2) {
    const player = getMidiPlayer();
    player.shortEvent(status, data1, data2);
}

function clearMidiPlayerCache() {
    cachedMidiPlayer = null;
}

// Экспорт для внешнего использования
self.libMidiBridge = {
    getMidiPlayer,
    midiSetSequence,
    midiPlay,
    midiLoop,
    midiStop,
    midiShortEvent,
    clearMidiPlayerCache
};

export default {
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_getMidiPlayer(lib) {
        // Используем кешированную ссылку чтобы избежать множественных Java объектов
        if (!cachedMidiPlayer || cachedMidiPlayer !== window.libmidi.midiPlayer) {
            // Если плеер изменился, очищаем старый кеш
            if (cachedMidiPlayer && cachedMidiPlayer.removeAllListeners) {
                cachedMidiPlayer.removeAllListeners();
            }
            cachedMidiPlayer = window.libmidi.midiPlayer;
        }
        return cachedMidiPlayer;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSetSequence(lib, player, sequence) {
        if (sequence) {
            // Обновляем кеш если плеер изменился
            if (cachedMidiPlayer !== player) {
                cachedMidiPlayer = player;
            }
            
            await player.setSequence(sequence.buffer);
            return player.duration;
        }
        
        return -1;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiPlay(lib, player) {
        player.play();
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiLoop(lib, player, times) {
        player.loop(times);
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiStop(lib, player) {
        player.stop();
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiShortEvent(lib, player, status, data1, data2) {
        player.shortEvent(status, data1, data2);
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiGetPosition(lib, player) {
        return await player.getPosition();
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSeek(lib, player, pos) {
        player.seek(pos);
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiGetVolume(lib, player) {
        return player.volume;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSetVolume(lib, player, vol) {
        player.volume = vol;
    },
};
