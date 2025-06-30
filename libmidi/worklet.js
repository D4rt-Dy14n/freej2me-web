console.log('🔧 WORKLET.JS: Модуль загружается...');

let glue = null;




function encodeUTF8(str) {
    return encodeURIComponent(s).replace(/%([\dA-Fa-f]{2})/g, m, code => {
        return String.fromCharCode(parseInt(code, 16));
    });
}

function decodeUTF8(str) {
    if (/[\u0100-\uffff]/.test(str)) {
        throw new Error("UTF8 decoding works on bytes only.");
    }

    let escaped = '';

    for(let t=0; t<str.length; t++) {
        escaped += '%'+('0'+str.charCodeAt(t).toString(16)).slice(-2);
    }

    return decodeURIComponent(escaped);
}


function readCString(heapOrArray, idx, maxBytesToRead) {
    var endIdx = idx + maxBytesToRead;
    var endPtr = idx;

    // node endIdx will be NaN if the argument is not supplied
    while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;

    var str = '';

    while (idx < endPtr) {
        str += String.fromCharCode(heapOrArray[idx++]);
    }

    return str;
}

function writeCString(str, heap, outIdx) {
    var startIdx = outIdx;

    for (var i = 0; i < str.length; ++i) {
        var u = str.charCodeAt(i);
        heap[outIdx++] = u & 0xff;
    }
    heap[outIdx] = 0;

    return outIdx - startIdx;
}



class Glue {
    constructor() {
        this.instance = null;
        this.memoryBuffer = null;
        this.heapu8 = null;
        this.importObject = {
            env: {
                emscripten_notify_memory_growth: () => {
                    console.log('growing memory');
                    this.loadHeap();
                },
                log_msg: (ptr, len) => {
                    // prob not available.. maybe use bootstrap broker
                    console.log('msg', this.readStringAt(ptr, len))
                }
            }
        };
    }

    async init(module) {
        const result = await WebAssembly.instantiate(module, this.importObject);
        this.instance = result;
        this.instance.exports._initialize();
        this.exports = this.instance.exports;

        this.loadHeap();
    }

    loadHeap() {
        this.memoryBuffer = this.exports.memory.buffer;
        this.heapu8 = new Uint8Array(this.memoryBuffer);
    }

    malloc(size) {
        return this.instance.exports.malloc(size);
    }

    free(ptr) {
        return this.instance.exports.free(ptr);
    }

    writeInto(ptr, src) {
        this.heapu8.set(new Uint8Array(src), ptr);
    }

    readStringAt(ptr, maxLen) {
        if (!ptr) return '';
        return readCString(this.heapu8, ptr, maxLen);
    }

    allocString(str) {
        // only ascii strings!
        const ptr = this.malloc(str.length+1);
        writeCString(str, this.heapu8, ptr);
        return ptr;
    }

    // for utf8 strings, encode before writing, decode after reading
}

// once we can send a message to the module directly, this bootstrap processor will be obsolete
class Bootstrap extends AudioWorkletProcessor {
    constructor(options) {
        super(options);

        this.init(options.processorOptions.module);
    }

    process() {}

    async init(module) {
        glue = new Glue();
        await glue.init(module);

        this.port.postMessage({ok: true});
    }
}

registerProcessor('bootstrap', Bootstrap);

function createMsgHandler(port, cmdHandler, otherHandler) {
    port.onmessage = async (event) => {
        const data = event.data;
        if (data && data.cmd && data.msgId) {
            const { cmd, msgId } = data;

            if (cmdHandler) {
                try {
                    const result = await cmdHandler(cmd, data);
                    port.postMessage({ replyFor: msgId, value: result });
                } catch (error) {
                    port.postMessage({ replyFor: msgId, error: error.toString() });
                }
            }
        } else if (otherHandler) {
            otherHandler(event);
        }
    }
}

class MidiPlayerProcessor extends AudioWorkletProcessor {
    // this player must be explicitly closed (via delete) to free resources
    // it can be used with multiple sequences

    constructor(...args) {
        super(...args);

        console.log('🎵 Worklet.constructor: Инициализация MidiPlayerProcessor');

        this.alive = true; // basically duplicates truthiness of this.ps
        this.hasPlayer = false;
        this.playingFrameOffset = -1;

        this.initBuffers(1024);

        createMsgHandler(this.port, (cmd, data) => {
            console.log('🎵 Worklet.message: Получена команда ' + cmd, data);
            if (cmd == 'setSequence') {
                return this.setSequence(data.buffer);
            } else if (cmd == 'stop') {
                this.stop();
            } else if (cmd == 'play') {
                this.play();
            } else if (cmd == 'loop') {
                this.loop(data.times);
            } else if (cmd == 'getPosition') {
                return this.getPosition();
            } else if (cmd == 'seek') {
                return this.seek(data.pos);
            } else if (cmd == 'shortEvent') {
                return this.shortEvent(data.status, data.data1, data.data2);
            } else if (cmd == 'delete') {
                this.delete();
            }
        }, e => {
            // other messages
        });

        if (glue && glue.exports) {
            this.ps = glue.exports.midiplayer_create(globalThis.sampleRate);
            this.hasPlayer = true;
            this.isPlaying = false; // to track end of media
            console.log('✅ Worklet.constructor: MIDI плеер создан, ps=' + this.ps);
        } else {
            console.error('❌ Worklet.constructor: Glue не инициализирован!');
        }
    }

    initBuffers(size) {
        if (this.leftBuf) {
            glue.free(this.leftBuf);
            glue.free(this.rightBuf);
        }
        this.bufSize = size;
        this.leftBuf = glue.malloc(size);
        this.rightBuf = glue.malloc(size);
    }

    play() {
        console.log('🎵 Worklet.play: Запуск воспроизведения, ps=' + this.ps + ', hasPlayer=' + this.hasPlayer);
        // ФИКС: Сбрасываем смещение кадров перед началом воспроизведения
        this.playingFrameOffset = -1;
        
        // Запускаем воспроизведение в MIDI движке
        if (this.ps) {
            glue.exports.midiplayer_play(this.ps);
            console.log('🎵 Worklet.play: midiplayer_play вызван');
        } else {
            console.error('❌ Worklet.play: ps не инициализирован!');
        }
        
        // Устанавливаем флаг воспроизведения
        this.isPlaying = true;
        console.log('✅ Worklet.play: isPlaying=' + this.isPlaying);
    }

    loop(times) {
        console.log('🎵 Worklet.loop: times=' + times);
        if (this.ps) {
            glue.exports.midiplayer_loop(this.ps, times);
        }
    }

    stop() {
        console.log('🎵 Worklet.stop: Остановка воспроизведения, isPlaying=' + this.isPlaying);
        // ФИКС: Полная остановка с сбросом состояния
        if (this.ps) {
            glue.exports.midiplayer_stop(this.ps);
        }
        
        // Сбрасываем флаги состояния
        this.isPlaying = false;
        this.playingFrameOffset = -1;
        console.log('✅ Worklet.stop: isPlaying=' + this.isPlaying);
    }

    getPosition() {
        return glue.exports.midiplayer_get_position(this.ps);
    }

    seek(pos) {
        glue.exports.midiplayer_seek(pos);
    }

    setSequence(bytes) {
        console.log('🎵 Worklet.setSequence: Получено ' + bytes.length + ' байт');
        // ФИКС: Полностью сбрасываем состояние перед новой последовательностью
        // Сначала останавливаем воспроизведение
        if (this.isPlaying) {
            console.log('🎵 Worklet.setSequence: Останавливаем воспроизведение');
            if (this.ps) {
                glue.exports.midiplayer_stop(this.ps);
            }
            this.isPlaying = false;
        }
        
        // Сбрасываем смещение кадров
        this.playingFrameOffset = -1;
        
        const len = bytes.length || bytes.byteLength;
        const ptr = glue.malloc(len);
        glue.writeInto(ptr, bytes);
        
        if (this.ps) {
            console.log('🎵 Worklet.setSequence: Вызываем midiplayer_set_sequence');
            const ticks = glue.exports.midiplayer_set_sequence(this.ps, ptr, len);
            console.log('🎵 Worklet.setSequence: Получено ticks=' + ticks);
            glue.free(ptr);

            // После сброса последовательности плеер точно не играет
            this.isPlaying = false;
            this.playingFrameOffset = -1;

            console.log('✅ Worklet.setSequence: Последовательность установлена, ticks=' + ticks);
            return { duration: ticks };
        } else {
            console.error('❌ Worklet.setSequence: ps не инициализирован!');
            glue.free(ptr);
            return { duration: 0 };
        }
    }

    shortEvent(status, data1, data2) {
        return glue.exports.midiplayer_short_event(this.ps, status, data1, data2);
    }

    // always called, even if the node not connected
    // returning false causes the node to become permanently defunct
    process(inputs, outputs) {
        if (this.hasPlayer && this.ps) {
            const missedFrames = this.playingFrameOffset === -1 ? 0 : ((currentFrame - this.playingFrameOffset) | 0);

            const samples = outputs[0][0].length;
            if (samples > this.bufSize/4) {
                this.initBuffers(samples*4);
            }

            const playing = glue.exports.midiplayer_write_data(this.ps, this.leftBuf, this.rightBuf, samples, missedFrames);

            outputs[0][0].set(new Float32Array(glue.memoryBuffer, this.leftBuf, samples));
            outputs[0][1].set(new Float32Array(glue.memoryBuffer, this.rightBuf, samples));

            // ФИКС: Улучшенная логика обработки end-of-media
            // Отправляем событие только когда плеер должен играть, но не производит аудио
            if (this.isPlaying && !playing) {
                console.log('🎵 Worklet.process: End of media detected, isPlaying=' + this.isPlaying + ', playing=' + playing);
                this.port.postMessage("end-of-media");
                this.isPlaying = false;
                this.playingFrameOffset = -1; // Сбрасываем для следующего воспроизведения
                console.log('✅ Worklet.process: End-of-media отправлено');
            }
            
            const DEBUG = false; // выключить спам в консоли
            if (DEBUG) console.log('🎵 Worklet.process: isPlaying=' + this.isPlaying + ', playing=' + playing + ', samples=' + samples);
        } else {
            if (!this.hasPlayer) console.error('❌ Worklet.process: hasPlayer=false');
            if (!this.ps) console.error('❌ Worklet.process: ps не инициализирован');
        }

        this.playingFrameOffset = (currentFrame + outputs[0][0].length) | 0;

        return this.alive;
    }

    delete() {
        glue.midiplayer_delete(this.ps);
        this.ps = null;
        this.alive = false;
    }
}

registerProcessor('midi-player', MidiPlayerProcessor);



class FFAudioPlayerProcessor extends AudioWorkletProcessor {
    // this player must be explicitly closed (via delete) to free resources
    // it can only be used with one sequence

    constructor(...args) {
        super(...args);

        this.alive = true; // until closed
        this.ps = null;

        this.playing = false;

        this.initBuffers(1024);

        createMsgHandler(this.port, (cmd, data) => {
            if (cmd == 'load') {
                return this.load(data.buffer, data.contentType);
            } else if (cmd == 'stop') {
                this.stop();
            } else if (cmd == 'play') {
                this.play();
            } else if (cmd == 'loop') {
                this.loop(data.times);
            } else if (cmd == 'seek') {
                this.seek(data.pos);
            } else if (cmd == 'getPosition') {
                return this.getPosition();
            } else if (cmd == 'close') {
                this.close();
            }
        }, e => {
            // other messages
        });

        this.loops = 0;
        this.loopsLeft = 0;

        this.playingFrameOffset = -1;
        this.inputPtr = 0;
    }

    load(bytes, contentType) {
        if (this.ps) {
            throw new Error("player was already loaded");
        }

        const len = bytes.length || bytes.byteLength;
        const ptr = glue.malloc(len); // player is responsible for freeing

        glue.writeInto(ptr, bytes);

        let contentTypePtr = contentType ? glue.allocString(contentType) : 0;

        this.ps = glue.exports.ffplayer_open(ptr, len, globalThis.sampleRate, contentTypePtr);

        if (contentTypePtr) {
            glue.free(contentTypePtr);
        }

        if (!this.ps) {
            glue.free(ptr);
            throw new Error("failed to initialize player");
        }

        this.inputPtr = ptr;

        return glue.exports.ffplayer_get_duration_ms(this.ps);

    }



    initBuffers(size) {
        if (this.leftBuf) {
            glue.free(this.leftBuf);
            glue.free(this.rightBuf);
        }
        this.bufSize = size;
        this.leftBuf = glue.malloc(size);
        this.rightBuf = glue.malloc(size);
    }

    play() {
        this.playingFrameOffset = -1;
        this.isPlaying = true;
        this.loopsLeft = this.loops;
    }

    loop(times) {
        this.loops = times;
        this.loopsLeft = times;
    }

    stop() {
        this.isPlaying = false;

    }

    getPosition() {
        return glue.exports.ffplayer_get_current_time_ms(this.ps);
    }


    seek(pos) {
        glue.exports.ffplayer_seek(this.ps, pos);
    }

    process(inputs, outputs) {
        if (this.ps && this.isPlaying) {
            let missedFrames = this.playingFrameOffset === -1 ? 0 : ((currentFrame - this.playingFrameOffset) | 0);

            const samples = outputs[0][0].length;
            if (samples > this.bufSize/4) {
                this.initBuffers(samples*4); // 4 is for 32bit
            }

            let samplesWritten = 0;

            while(samplesWritten < samples) {
                const samplesLeft = samples - samplesWritten;
                const framesToWrite = (missedFrames > 0) ? Math.min(missedFrames, samples) : samplesLeft;
                const off = (missedFrames > 0) ? 0 : samplesWritten;

                const nowWritten = glue.exports.ffplayer_read(this.ps, this.leftBuf + off*4, this.rightBuf + off*4, framesToWrite);

                if (missedFrames > 0) {
                    missedFrames -= nowWritten;
                } else {
                    samplesWritten += nowWritten;
                }

                if (nowWritten < framesToWrite) {
                    this.seek(0);

                    // loop-or-eom
                    if (this.loopsLeft == -1 || this.loopsLeft > 0) {
                        this.loopsLeft = this.loopsLeft == -1 ? -1 : this.loopsLeft - 1;
                    } else {
                        this.port.postMessage("end-of-media");
                        this.isPlaying = false;
                        break;
                    }
                }

            }

            outputs[0][0].set(new Float32Array(glue.memoryBuffer, this.leftBuf, samplesWritten));
            outputs[0][1].set(new Float32Array(glue.memoryBuffer, this.rightBuf, samplesWritten));

            this.playingFrameOffset = (currentFrame + samples) | 0;
        }

        return this.alive;
    }

    close() {
        if (this.ps) {
            glue.exports.ffplayer_close(this.ps);
            this.ps = null;
        }

        if (this.inputPtr) {
            glue.free(this.inputPtr);
            this.inputPtr = 0;
        }

        this.alive = false;
    }
}

registerProcessor('ff-player', FFAudioPlayerProcessor);

