// helpers

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
        this.context = context;
        this.destination = destination || context.destination;
        this.initialized = false;
        this._midiPlayer = null;
    }

    async init() {
        if (this.initialized) {
            throw new Error("LibMidi already initialized");
        }

        if (!this.context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
            throw new Error("AudioWorklet not supported");
        }

        const modulePath = new URL('./worklet.js', import.meta.url);
        await this.context.audioWorklet.addModule(modulePath);

        const wasmPath = new URL('./libmidi.wasm', import.meta.url);
        const wasmResponse = await fetch(wasmPath);
        const wasmModule = await WebAssembly.compile(await wasmResponse.arrayBuffer());

        const bootstrapNode = new AudioWorkletNode(this.context, 'bootstrap', {
            outputChannelCount: [2],
            processorOptions: {
                module: wasmModule
            }
        });

        await new Promise((resolve, reject) => {
            bootstrapNode.port.onmessage = e => {
                if (e.data.ok) {
                    resolve();
                } else {
                    reject(e.data.error);
                }
            };
        });

        this.initialized = true;
    }

    async close() {
        if (this._midiPlayer) {
            this._midiPlayer.close();
            this._midiPlayer = null;
        }

        this.initialized = false;
    }

    get midiPlayer() {
        if (this.initialized && !this._midiPlayer) {
            this._midiPlayer = new MIDIPlayer(this.context, this.destination);
        } else if (!this.initialized) {
            // не инициализирован
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

        MIDIPlayer.playerCount++;
        this.playerId = MIDIPlayer.playerCount;

        if (!audioContext.audioWorklet || typeof AudioWorkletNode === 'undefined') {
            return;
        }

        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1;

        this.gainNode.connect(destination);

        this.node = new AudioWorkletNode(audioContext, 'midi-player', {
            outputChannelCount: [2]
        });
        this.node.connect(this.gainNode);
        this.client = new CmdClient(this.node.port);

        const weakThis = new WeakRef(this); // it got crazy pretty fast..

        this.node.port.onmessage = e => {
            if (e.data?.replyFor) return; // these are for client.. should we use cancel?

            if (e.data === 'end-of-media') {
                weakThis.deref()?.dispatchEvent(new Event('end-of-media'));
            }
        };

        this.duration = 0;

        MIDIPlayer._finalizer.register(this, [this.client, this.node, this.gainNode], this);
    }

    // this is just relays the promise
    send(what, transfer=[]) {
        return this.client && this.client.send(what, transfer);
    }

    async setSequence(buffer) {
        // ФИКС: Полностью останавливаем предыдущее воспроизведение и сбрасываем цикл
        this.send({cmd: "stop"});
        // Сбрасываем любые активные циклы
        this.send({cmd: "loop", times: 0});
        
        const { duration } = await this.send({cmd: "setSequence", buffer}); //hmm, no transfer.. we're not sure
        this.duration = duration;
    }

    play() {
        this.send({cmd: "play"});
    }

    loop(times) {
        this.send({cmd: "loop", times});
    }

    stop() {
        this.send({cmd: "stop"});
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
