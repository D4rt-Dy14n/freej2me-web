// helpers
console.log('🔧 LIBMIDI.JS: Модуль загружается...');

export function unlockAudioContext(audioCtx) {
    if (audioCtx.state !== 'suspended') return;
    const b = document.body;
    const events = ['touchstart','touchend', 'mousedown','keydown'];
    events.forEach(e => b.addEventListener(e, unlock, false));
    function unlock() { audioCtx.resume().then(clean); }
    function clean() { events.forEach(e => b.removeEventListener(e, unlock)); }
}

export function createUnlockingAudioContext(...params) {
    const ac = new AudioContext(...params); // params?
    unlockAudioContext(ac);
    return ac;
}

export function closeContext(ctx) {
    return ctx.close();
}

export class LibMidi {
    constructor(context, destination=null) {
        console.log('🎵 LibMidi.constructor: Создание экземпляра');
        this.context = context;
        this.destination = destination || context.destination;
        this.initialized = false;
        this._midiPlayer = null;
        console.log('🎵 LibMidi.constructor: Экземпляр создан', this);
    }

    async init() {
        console.log('🎵 LibMidi.init: Начинаем инициализацию');
        if (this.initialized) {
            console.warn('⚠️ LibMidi.init: Уже инициализирован');
            throw new Error("LibMidi already initialized");
        }

        if (!this.context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
            console.error('❌ LibMidi.init: AudioWorklet не поддерживается');
            throw new Error("AudioWorklet not supported");
        }

        console.log('🎵 LibMidi.init: Загружаем worklet модуль');
        const modulePath = new URL('./worklet.js', import.meta.url);
        await this.context.audioWorklet.addModule(modulePath);
        console.log('✅ LibMidi.init: Worklet модуль загружен');

        console.log('🎵 LibMidi.init: Загружаем WASM модуль');
        const wasmPath = new URL('./libmidi.wasm', import.meta.url);
        const wasmResponse = await fetch(wasmPath);
        const wasmModule = await WebAssembly.compile(await wasmResponse.arrayBuffer());
        console.log('✅ LibMidi.init: WASM модуль скомпилирован');

        console.log('🎵 LibMidi.init: Создаем bootstrap узел');
        const bootstrapNode = new AudioWorkletNode(this.context, 'bootstrap', {
            outputChannelCount: [2],
            processorOptions: {
                module: wasmModule
            }
        });

        console.log('🎵 LibMidi.init: Ожидаем инициализацию WASM');
        await new Promise((resolve, reject) => {
            bootstrapNode.port.onmessage = e => {
                if (e.data.ok) {
                    console.log('✅ LibMidi.init: WASM инициализирован');
                    resolve();
                } else {
                    console.error('❌ LibMidi.init: Ошибка WASM', e.data.error);
                    reject(e.data.error);
                }
            };
        });

        this.initialized = true;
        console.log('✅ LibMidi.init: LibMidi полностью инициализирован');
    }

    async close() {
        if (this._midiPlayer) {
            this._midiPlayer.close();
            this._midiPlayer = null;
        }

        this.initialized = false;
    }

    get midiPlayer() {
        console.log('🎵 LibMidi.get midiPlayer: Запрос плеера, initialized=' + this.initialized);
        if (this.initialized && !this._midiPlayer) {
            console.log('🎵 LibMidi.get midiPlayer: Создаем новый MIDIPlayer');
            this._midiPlayer = new MIDIPlayer(this.context, this.destination);
            console.log('✅ LibMidi.get midiPlayer: MIDIPlayer создан', this._midiPlayer);
        } else if (!this.initialized) {
            console.warn('⚠️ LibMidi.get midiPlayer: LibMidi не инициализирован');
        } else {
            console.log('🎵 LibMidi.get midiPlayer: Возвращаем существующий плеер');
        }

        return this._midiPlayer;
    }
}

// todo: we could make this bidirectional with methods and events, but at this point no need to do so
class CmdClient {
    constructor(port) {
        this.port = port;
        this.messageCounter = 0;
        this.pendingMessages = {};
        this._messageHandler = this._handleMessage.bind(this);
        this.port.addEventListener('message', this._messageHandler);
    }

    send(what, transfer=[]) {
        const msgId = ++this.messageCounter;
        return new Promise((resolve, reject) => {
            this.pendingMessages[msgId] = { resolve, reject };
            this.port.postMessage({ ...what, msgId }, transfer);
        });
    }

    _handleMessage(event) {
        const data = event.data;
        if (data && data.replyFor) {
            const { replyFor, value, error } = data;
            const handlers = this.pendingMessages[replyFor];

            if (handlers) {
                if (error !== undefined) {
                    handlers.reject(error);
                } else {
                    handlers.resolve(value);
                }
                delete this.pendingMessages[replyFor];
            }
        }
    }

    close() {
        // Очищаем все ожидающие промисы
        for (const handlers of Object.values(this.pendingMessages)) {
            handlers.reject(new Error('Client closed'));
        }
        this.pendingMessages = {};
        
        // Удаляем слушатель событий
        if (this.port && this._messageHandler) {
            this.port.removeEventListener('message', this._messageHandler);
        }
    }
}

export class MIDIPlayer extends EventTarget {
    // this MUST be explicitly closed
    // but only one instance is needed to emulate a MIDI device

    static _unregister = ([client, node, gainNode]) => {
        client.send({cmd: "delete"});
        node.disconnect();
        gainNode.disconnect();
    };

    static _finalizer = new FinalizationRegistry(args => {
        console.warn('closing midiplayer via finalizer');

        this._unregister(args);
    });

    static playerCount = 0;

    constructor(audioContext, destination) {
        super();

        console.log('🎵 MIDIPlayer.constructor: Создание плеера');

        MIDIPlayer.playerCount++;
        this.playerId = MIDIPlayer.playerCount;
        console.log('🎵 MIDIPlayer.constructor: playerId=' + this.playerId);

        if (!audioContext.audioWorklet || typeof AudioWorkletNode === 'undefined') {
            console.error('❌ MIDIPlayer.constructor: AudioWorklet не поддерживается');
            return;
        }

        console.log('🎵 MIDIPlayer.constructor: Создаем gain узел');
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1;
        this.gainNode.connect(destination);

        console.log('🎵 MIDIPlayer.constructor: Создаем worklet узел');
        this.node = new AudioWorkletNode(audioContext, 'midi-player', {
            outputChannelCount: [2]
        });
        this.node.connect(this.gainNode);
        this.client = new CmdClient(this.node.port);

        const weakThis = new WeakRef(this); // it got crazy pretty fast..

        this.node.port.onmessage = e => {
            if (e.data?.replyFor) return; // these are for client.. should we use cancel?

            if (e.data === 'end-of-media') {
                console.log('🎵 MIDIPlayer: End-of-media событие получено из worklet');
                console.log('🎵 MIDIPlayer: Stack trace:', new Error().stack);
                console.log('🎵 MIDIPlayer: Автоматически сбрасываем состояние для повторного воспроизведения');
                
                const player = weakThis.deref();
                if (player) {
                    // Отмечаем, что последовательность дошла до конца
                    player._hasEndedOnce = true;

                    // Пробрасываем событие дальше (может использоваться Java-кодом)
                    player.dispatchEvent(new Event('end-of-media'));
                }
            }
        };

        this.duration = 0;

        MIDIPlayer._finalizer.register(this, [this.client, this.node, this.gainNode], this);
        console.log('✅ MIDIPlayer.constructor: Плеер создан успешно');

        // Флаг, указывающий что плеер уже дошёл до конца последовательности хотя бы один раз
        this._hasEndedOnce = false;
    }

    // this is just relays the promise
    send(what, transfer=[]) {
        return this.client && this.client.send(what, transfer);
    }

    async setSequence(buffer) {
        console.log('🎵 MIDIPlayer.setSequence: Получен buffer', buffer.byteLength + ' байт');
        // Кешируем буфер, чтобы можно было воспроизвести его повторно без явного вызова из Java
        this._lastSequence = buffer.slice ? buffer.slice(0) : buffer; // ArrayBuffer имеет slice
        // ФИКС: Правильно останавливаем и сбрасываем плеер перед новой последовательностью
        // Важно: все команды должны выполняться последовательно с ожиданием
        console.log('🎵 MIDIPlayer.setSequence: Останавливаем предыдущее воспроизведение');
        await this.send({cmd: "stop"});
        console.log('🎵 MIDIPlayer.setSequence: Сбрасываем циклы');
        await this.send({cmd: "loop", times: 0});
        
        // Небольшая задержка для завершения остановки на низком уровне
        await new Promise(resolve => setTimeout(resolve, 10));
        
        console.log('🎵 MIDIPlayer.setSequence: Отправляем новую последовательность в worklet');
        const { duration } = await this.send({cmd: "setSequence", buffer});
        this.duration = duration;
        console.log('✅ MIDIPlayer.setSequence: Последовательность установлена, duration=' + duration);
    }

    play() {
        console.log('🎵 MIDIPlayer.play: Запуск воспроизведения');
        console.log('🎵 MIDIPlayer.play: Stack trace:', new Error().stack);

        if (this._hasEndedOnce) {
            console.log('🎵 MIDIPlayer.play: _hasEndedOnce=true – переустанавливаем последовательность');
            this._hasEndedOnce = false;

            // Безопасный ресет: stop → setSequence(последний_буфер) → play
            // Если по каким-то причинам буфера нет (не вызывали setSequence), просто seek на 0
            (async () => {
                try {
                    await this.send({cmd: "stop"});
                    if (this._lastSequence) {
                        console.log('🎵 MIDIPlayer.play: Отправляем setSequence повторно');
                        await this.send({cmd: "setSequence", buffer: this._lastSequence});
                    } else {
                        await this.send({cmd: "seek", pos: 0});
                    }
                    await this.send({cmd: "play"});
                } catch (err) {
                    console.warn('🎵 MIDIPlayer.play: Ошибка при auto-reset:', err);
                }
            })();
        } else {
            this.send({cmd: "play"});
        }

        console.log('✅ MIDIPlayer.play: Команда отправлена в worklet');
    }

    loop(times) {
        console.log('🎵 MIDIPlayer.loop: times=' + times);
        this.send({cmd: "loop", times});
    }

    stop() {
        console.log('🎵 MIDIPlayer.stop: Остановка воспроизведения');
        this.send({cmd: "stop"});
        console.log('✅ MIDIPlayer.stop: Команда отправлена в worklet');
    }

    shortEvent(status, data1, data2) {
        this.send({cmd: "shortEvent", status, data1, data2});
    }

    // async
    getPosition() {
        return this.send({cmd: "getPosition"});
    }

    seek(pos) {
        return this.send({cmd: "seek", pos});
    }

    close() {
        // Очищаем слушатели событий
        this.removeAllListeners();
        
        // Закрываем client с очисткой слушателей
        if (this.client) {
            this.client.close();
        }
        
        // Отключаем аудио ноды
        if (this.node) {
            this.node.disconnect();
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
        }
        
        // Удаляем из финализатора
        MIDIPlayer._finalizer.unregister(this);
        
        // Обнуляем ссылки
        this.client = null;
        this.node = null;
        this.gainNode = null;
    }

    get volume() {
        return this.gainNode.gain.value;
    }

    set volume(v) {
        this.gainNode.gain.value = v;
    }

    removeAllListeners() {
        // Удаляем все слушатели событий
        const events = ['end-of-media'];
        events.forEach(eventType => {
            // Клонируем слушатели чтобы безопасно их удалить
            const listeners = this.getEventListeners ? this.getEventListeners(eventType) : [];
            listeners.forEach(listener => {
                this.removeEventListener(eventType, listener);
            });
        });
    }
}
