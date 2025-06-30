import { transcode } from "./transcode/transcode.js"


export class LibMedia {
    constructor(context, destination=null) {
        this.context = context;
        this.destination = destination || context.destination;
    }

    async init() {

    }


    async close() {
        // close players?
    }

    createMediaPlayer() {
        console.log('🎵 LibMedia: Создаем новый MediaPlayer');
        const player = new MediaPlayer(this.context, this.destination);
        console.log('🎵 LibMedia: MediaPlayer создан, ID:', player.playerId);
        return player;
    }

}


function unlockMediaElement(mediaElement) {
    const b = document.body;
    const events = ['touchstart','touchend', 'mousedown','keydown'];
    events.forEach(e => b.addEventListener(e, unlock, false));
    function unlock() {
        console.log('muted: unmuting');
        mediaElement.muted = false;
        events.forEach(e => b.removeEventListener(e, unlock));
    }
}




function setMediaBlob(mediaElement, blob, tag) {
    // why the HELL isn't this possible with srcObject???
    // tests show that we can NEVER revoke the object url, not even after
    // receiving the "ended" event.
    // possible workaround would be to

    if (mediaElement.src && mediaElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(mediaElement.src);
    }

    const objectUrl = URL.createObjectURL(blob);
    console.log('objurl: creatin', tag, objectUrl);

    const cleanup = (e) => {
        console.log('objurl: removin', tag, objectUrl);
        URL.revokeObjectURL(objectUrl);
        mediaElement.removeEventListener('loadeddata', cleanup);
        mediaElement.removeEventListener('error', cleanup);
    };

    mediaElement.addEventListener('loadeddata', cleanup);
    mediaElement.addEventListener('error', cleanup);
    mediaElement.src = objectUrl;
}


const mp3Types = [
    'audio/mp3',
    'audio/mpeg3',
    'audio/x-mp3',
    'audio/x-mpeg-3',
    'audio/x-mpeg3'
];

export class MediaPlayer extends EventTarget {
    static playerCount = 0;

    constructor(audioContext, destination = null) {
        super();

        MediaPlayer.playerCount++;
        this.playerId = MediaPlayer.playerCount;

        this.audioContext = audioContext;
        this.destination = destination || audioContext.destination;

        this.mediaElement = null;
        this.objectUrl = null;
        this.gainNode = null;
        this.sourceNode = null;

        this.audioContext.resume();

        // Флаг для отслеживания завершений
        this.hasEndedOnce = false;

        this.addEventListener('playing', () => {
            this.state = 'STARTED';
        });

        this.addEventListener('waiting', () => {
            this.state = 'PREFETCHED';
        });

        this.addEventListener('pause', () => {
            this.state = 'PREFETCHED';
        });

        this.addEventListener('ended', () => {
            this.state = 'PREFETCHED';
            this.hasEndedOnce = true;
            console.log('[MediaPlayer] ended event, setting hasEndedOnce=true', this.playerId);
            this.dispatchEvent(new Event('end-of-media'));
        });

        this.addEventListener('loadeddata', () => {
            this.state = 'PREFETCHED';
        });

        this.addEventListener('error', (e) => {
            this.state = 'CLOSED';
        });

        this.state = 'UNREALIZED';
    }

    async load(contentType, buffer) {
        this.contentType = contentType;
        console.log('🎵 MediaPlayer[' + this.playerId + ']: load() вызван, contentType:', contentType, 'bufferSize:', buffer?.byteLength);
        if (!buffer || buffer.byteLength === 0) {
            console.log('🎵 MediaPlayer[' + this.playerId + ']: load() - пустой буфер');
            return false;
        }

        if (contentType.includes("mp3") || contentType.includes("audio/mpeg")) {
            // Обработка MP3 файлов
            try {
                if (window.libmedia.transcode) {
                    const transcoded = await window.libmedia.transcode(buffer);
                    buffer = transcoded;
                }
            } catch (e) {
                return false;
            }
        }

        // Создаём blob и настраиваем медиа элемент
        this.blob = new Blob([buffer], { type: contentType });
        
        return new Promise((resolve) => {
            const handleEvent = (e) => {
                if (e.type === 'loadeddata' || e.type === 'canplaythrough') {
                    this.mediaElement.removeEventListener('loadeddata', handleEvent);
                    this.mediaElement.removeEventListener('canplaythrough', handleEvent);
                    this.mediaElement.removeEventListener('error', handleEvent);
                    resolve(true);
                } else if (e.type === 'error') {
                    this.mediaElement.removeEventListener('loadeddata', handleEvent);
                    this.mediaElement.removeEventListener('canplaythrough', handleEvent);
                    this.mediaElement.removeEventListener('error', handleEvent);
                    resolve(false);
                }
            };

            this.mediaElement = document.createElement(contentType.startsWith('video/') ? 'video' : 'audio');
            this.mediaElement.addEventListener('loadeddata', handleEvent);
            this.mediaElement.addEventListener('canplaythrough', handleEvent);
            this.mediaElement.addEventListener('error', handleEvent);

            // Копируем все события на себя для совместимости
            ['playing', 'waiting', 'pause', 'ended', 'loadeddata', 'error'].forEach(eventType => {
                this.mediaElement.addEventListener(eventType, (e) => {
                    this.dispatchEvent(new Event(e.type));
                });
            });

            // Добавляем логирование для отладки
            this._ensureEventLogs();

            this.objectUrl = URL.createObjectURL(this.blob);
            this.mediaElement.src = this.objectUrl;
            this.mediaElement.load();
        }).then(result => {
            console.log('🎵 MediaPlayer[' + this.playerId + ']: load() результат:', result);
            if (!result) {
                return false;
            }

            // Настраиваем audio context если нужно
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.gainNode = this.audioContext.createGain();
                this.gainNode.gain.value = 1.0;
                this.gainNode.connect(this.destination);

                this.sourceNode = this.audioContext.createMediaElementSource(this.mediaElement);
                this.sourceNode.connect(this.gainNode);
                console.log('🎵 MediaPlayer[' + this.playerId + ']: Audio context настроен');
            }

            this.state = 'REALIZED';
            console.log('🎵 MediaPlayer[' + this.playerId + ']: Состояние установлено в REALIZED');
            return result;
        });
    }

    maybeSetupFrameDisplay() {
        const isPlaying = !this.mediaElement.paused && this.mediaElement.readyState > 2;
        if (isPlaying && this.videoCtx) {
            this._drawVideoFrame();
        }
    }

    stopFrameDisplay() {
        if (this.videoAnimationFrame) {
            cancelAnimationFrame(this.videoAnimationFrame);
            this.videoAnimationFrame = null;
        }
    }

    _drawVideoFrame() {
        if (!this.videoCtx) return;
        try {
            const videoWidth = this.mediaElement.videoWidth;
            const videoHeight = this.mediaElement.videoHeight;

            if (this.videoFullscreen) {
                const canvasWidth = this.videoCtx.canvas.width;
                const canvasHeight = this.videoCtx.canvas.height;

                const canvasAspectRatio = canvasWidth / canvasHeight;
                const videoAspectRatio = videoWidth / videoHeight;

                let drawWidth, drawHeight, drawX, drawY;

                if (videoAspectRatio > canvasAspectRatio) {
                  drawWidth = canvasWidth;
                  drawHeight = canvasWidth / videoAspectRatio;
                  drawX = 0;
                  drawY = (canvasHeight - drawHeight) / 2;
                } else {
                  drawHeight = canvasHeight;
                  drawWidth = canvasHeight * videoAspectRatio;
                  drawX = (canvasWidth - drawWidth) / 2;
                  drawY = 0;
                }

                this.videoCtx.drawImage(this.mediaElement, drawX, drawY, drawWidth, drawHeight);
            } else {
                this.videoCtx.drawImage(this.mediaElement, this.videoX, this.videoY, this.videoW || videoWidth, this.videoH || videoHeight);
            }

            this.onVideoFramePainter();
        } catch (e) {
            console.error("Error drawing video frame", e);
        }
        this.videoAnimationFrame = requestAnimationFrame(() => this._drawVideoFrame());
    }

    async play() {
        if (!this.mediaElement) {
            return;
        }

        const elementInfo = this.mediaElement.src?.substring(0, 50) + '...';

        console.log('[MediaPlayer.play] begin', {
            id: this.playerId,
            elementInfo,
            paused: this.mediaElement.paused,
            readyState: this.mediaElement.readyState,
            currentTime: this.mediaElement.currentTime.toFixed(3),
            duration: this.mediaElement.duration,
            ended: this.mediaElement.ended
        });

        // Если элемент уже проигрывается ‑ перезапускаем.
        // Если закончился и стоит на конце — тоже сбрасываем.
        try {
            const atEnd = this.mediaElement.currentTime >= (this.mediaElement.duration || 0) - 0.01;

            if (!this.mediaElement.paused || atEnd || this.mediaElement.ended) {
                // Останавливаем без генерации событий, затем ставим на начало
                this.mediaElement.pause();
                this.mediaElement.currentTime = 0;
                // Полностью перезагружаем поток, чтобы браузер гарантированно заново декодировал звук
                // (на некоторых мобильных браузерах без load() второй play игнорируется)
                this.mediaElement.load();
                console.log('[MediaPlayer.play] reset & load complete', {
                    readyState: this.mediaElement.readyState
                });
            }
        } catch (_) {
            // duration может быть NaN до полной загрузки; игнорируем
            this.mediaElement.currentTime = 0;
        }

        // Убеждаемся, что AudioContext активен (после блокировки браузером мог уйти в suspended)
        console.log('[MediaPlayer.play] AC state before', this.audioContext.state);
        try { if (this.audioContext.state === 'suspended') await this.audioContext.resume(); } catch(e) {}
        console.log('[MediaPlayer.play] AC state after', this.audioContext.state);

        try {
            await this.mediaElement.play();
            console.log('[MediaPlayer.play] play() success');
        } catch (e) {
            console.warn('[MediaPlayer.play] play() failed', e.name, e.message);
            if (e.name === 'NotAllowedError') {
                // Пробуем проиграть без звука
                const originalVolume = this.mediaElement.volume;
                this.mediaElement.volume = 0;
                this.mediaElement.muted = true;

                try {
                    await this.mediaElement.play();
                } catch (e) {
                    // Даже без звука не получилось
                }

                this.mediaElement.volume = originalVolume;
                this.mediaElement.muted = false;
            }
        }
    }

    pause() {
        console.log('🎵 MediaPlayer[' + this.playerId + ']: pause() вызван');
        if (this.mediaElement) {
            this.mediaElement.pause();
        }
    }

    stop() {
        if (this.mediaElement) {
            this.mediaElement.pause();
            this.mediaElement.currentTime = 0;
            // Принудительно перезагружаем медиа для подготовки к повторному воспроизведению
            // Это критично для некоторых браузеров, особенно мобильных
            this.mediaElement.load();
        }
    }

    get volume() {
        return this.mediaElement.volume;
    }

    set volume(v) {
        this.mediaElement.volume = v;
    }

    get duration() {
        return this.mediaElement.duration;
    }

    get position() {
        return this.mediaElement.currentTime;
    }

    get videoWidth() {
        return this.mediaElement.videoWidth;
    }

    get videoHeight() {
        return this.mediaElement.videoHeight;
    }

    seek(time) {
        this.mediaElement.currentTime = time;
    }


    configureVideo(ctx, cb, x=0, y=0, w=0, h=0, fullscreen=false) {
        if (ctx) {
            this.videoCtx = ctx;
            this.videoX = x;
            this.videoY = y;
            this.videoFullscreen = fullscreen;
            this.videoW = w; this.videoH = h;
            this.onVideoFramePainter = cb;
            this.maybeSetupFrameDisplay();
        } else {
            // Disable video drawing.
            this.videoCtx = null;
            this.stopFrameDisplay();
        }
    }

    setLooping(loop) {
        this.mediaElement.loop = !!loop;
    }

    close() {
        if (this.mediaElement) {
            this.mediaElement.pause();
            this.mediaElement.src = '';
            this.mediaElement.load();
            this.mediaElement = null;
        }

        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }

        this.blob = null;
        this.state = 'CLOSED';
        MediaPlayer.playerCount--;
    }

    async getSnapshot(type) {
        if (!this.mediaElement.videoWidth || !this.mediaElement.videoHeight) {
            return null;
        }

        if (!this.constructor.snapshotCtx) {
            const canvas = document.createElement('canvas');
            canvas.width = this.mediaElement.videoWidth;
            canvas.height = this.mediaElement.videoHeight;
            this.constructor.snapshotCtx = canvas.getContext('2d');
        }

        const canvas = this.constructor.snapshotCtx.canvas;
        this.constructor.snapshotCtx.drawImage(this.mediaElement, 0, 0, canvas.width, canvas.height);

        return await new Promise(resolve => {
            canvas.toBlob(
                async (blob) => {
                    resolve(blob ? (await blob.arrayBuffer()) : null);
                },
                type,
                0.9
            );
        });
    }

    // Сбрасывает mediaElement в рабочее состояние, создав новый ObjectURL
    reset() {
        if (!this.mediaElement) return Promise.resolve();

        this.hasEndedOnce = false;

        if (!this.blob) {
            try { this.mediaElement.pause(); } catch(_){}
            this.state = 'UNREALIZED';
            return Promise.resolve();
        }

        try { this.mediaElement.pause(); } catch(_){}
        if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null; }
        if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
        if (this._pendingRecreateHandler && this.mediaElement) {
            this.mediaElement.removeEventListener('loadeddata', this._pendingRecreateHandler);
            this.mediaElement.removeEventListener('error', this._pendingRecreateHandler);
        }

        const isVideo = (this.contentType || '').startsWith('video/');
        this.mediaElement = document.createElement(isVideo ? 'video' : 'audio');
        ['playing','waiting','pause','ended','loadeddata','error'].forEach(evt => {
            this.mediaElement.addEventListener(evt, e => this.dispatchEvent(new Event(e.type)));
        });
        this._eventsLogged = false;

        this.objectUrl = URL.createObjectURL(this.blob);
        this.mediaElement.src = this.objectUrl;

        if (!this.gainNode && this.audioContext && this.audioContext.state !== 'closed') {
            try {
                this.gainNode = this.audioContext.createGain();
                this.gainNode.gain.value = 1.0;
                this.gainNode.connect(this.destination ?? this.audioContext.destination);
            } catch (e) { console.warn('[MediaPlayer.reset] gain create fail', e); }
        }
        try {
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.sourceNode = this.audioContext.createMediaElementSource(this.mediaElement);
                this.sourceNode.connect(this.gainNode ?? this.destination ?? this.audioContext.destination);
            }
        } catch(e){console.warn('[MediaPlayer.reset] sourceNode fail', e)}

        return new Promise(resolve=>{
            const cleanup=()=>{
                this.mediaElement.removeEventListener('loadeddata', cleanup);
                this.mediaElement.removeEventListener('error', cleanup);
                this._pendingRecreateHandler=null;
                resolve();
            };
            this._pendingRecreateHandler=cleanup;
            this.mediaElement.addEventListener('loadeddata', cleanup,{once:true});
            this.mediaElement.addEventListener('error', cleanup,{once:true});
            setTimeout(()=>{console.warn('[MediaPlayer.reset] timeout');cleanup();},5000);
            this.mediaElement.load();
            this.state='PREFETCHED';
        });
    }

    // Добавляем базовые логи на события ended/error (один раз)
    _ensureEventLogs() {
        if (this._eventsLogged) return;
        this._eventsLogged = true;
        if (!this.mediaElement) return;
        this.mediaElement.addEventListener('ended', () => console.log('[MediaPlayer] ended', this.playerId));
        this.mediaElement.addEventListener('error', (e) => console.error('[MediaPlayer] error', e));
    }
}





export class FFPlayer extends EventTarget {
    // this MUST be explicitly closed as it holds the audio buffer
    // this is equivalent to a "Clip" class, so only valid for one audio

    static _unregister = ([client, node, gainNode]) => {
        client.send({ cmd: "close" });
        node.disconnect();
        gainNode.disconnect();
    };

    static _finalizer = new FinalizationRegistry(args => {
        console.warn('closing ffplayer via finalizer');

        this._unregister(args);
    });

    constructor(audioContext, destination) {
        super();

        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1;

        this.gainNode.connect(destination);

        this.node = new AudioWorkletNode(audioContext, 'ff-player', {
            outputChannelCount: [2]
        });
        this.node.connect(this.gainNode);
        this.client = new CmdClient(this.node.port);

        const weakThis = new WeakRef(this); // it got crazy pretty fast..

        this.node.port.onmessage = e => {
            if (e.data?.replyFor) return; // these are for client.. should we use cancel?

            if (e.data === 'end-of-media') {
                console.log('dispatchin eom');

                weakThis.deref()?.dispatchEvent(new Event('end-of-media'));
            }
        };

        this.duration = 0;

        this.loaded = false;

        FFPlayer._finalizer.register(this, [this.client, this.node, this.gainNode], this);
    }

    // this is just relays the promise
    send(what, transfer = []) {
        return this.client.send(what, transfer);
    }

    async load(buffer, contentType = null) {
        const duration = await this.send({ cmd: "load", buffer, contentType }); //hmm, no transfer.. we're not sure
        this.duration = duration;

    }


    play() {
        this.send({ cmd: "play" });
    }

    loop(times) {
        this.send({ cmd: "loop", times });
    }

    stop() {
        this.send({ cmd: "stop" });
    }


    // async
    getPosition() {
        return this.send({ cmd: "getPosition" });
    }

    seek(pos) {
        return this.send({ cmd: "seek", pos });
    }

    close() {
        FFPlayer._unregister([this.client, this.node, this.gainNode]);
        FFPlayer._finalizer.unregister(this);
    }

    get volume() {
        return this.gainNode.gain.value;
    }

    set volume(v) {
        this.gainNode.gain.value = v;
    }
}
