// LibMidiBridge
console.log('🎵 LibMidiBridge: Модуль загружается...');

let cachedMidiPlayer = null; // Кешированная ссылка на плеер для Java

function getMidiPlayer() {
    if (!window.libmidi) {
        console.error('❌ LibMidiBridge.getMidiPlayer: window.libmidi не инициализирован!');
        return null;
    }
    
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
    // Автоматический ресет после end-of-media, если Java повторно вызывает только play()
    if (player && player._hasEndedOnce) {
        // сброс последней последовательности, если сохранена
        if (player._lastSequence) {
            player.setSequence(player._lastSequence).then(() => {
                player.play();
            });
            return;
        }
        // если буфера нет, просто на начало
        player.seek(0).then(() => player.play());
        return;
    }

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

const midiBridgeExports = {
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
        
        console.warn('❌ MidiBridge.midiSetSequence: Пустая последовательность');
        return -1;
    },
    async Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiPlay(lib, playerFromJava) {
        // 1. Всегда вызываем getMidiPlayer, чтобы сохранить последовательность вызовов в логах
        const player = await midiBridgeExports.Java_pl_zb3_freej2me_bridge_media_MidiBridge_getMidiPlayer(lib);

        // 2. Сразу делаем hard-reset: stop → setSequence(last) → play
        try {
            await player.send({cmd: "stop"});

            if (player._lastSequence) {
                console.log('🎵 MidiBridge.midiPlay: Hard-reset – переустанавливаем _lastSequence');
                await midiBridgeExports.Java_pl_zb3_freej2me_bridge_media_MidiBridge_midiSetSequence(
                    lib,
                    player,
                    new Uint8Array(player._lastSequence)
                );
            } else {
                // fallback: просто seek на начало
                await player.send({cmd: "seek", pos: 0});
            }
        } catch (e) {
            console.warn('❌ MidiBridge.midiPlay: Ошибка в hard-reset', e);
        }

        // 3. Пуск
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
    getMidiPlayer,
    midiSetSequence,
    midiPlay,
    midiLoop,
    midiStop,
    midiShortEvent,
    clearMidiPlayerCache
};

self.libMidiBridge = midiBridgeExports;

export default midiBridgeExports;
