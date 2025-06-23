import { LibMedia } from "../libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "../libmidi/libmidi.js";
import { EventQueue } from "./eventqueue.js";
import { initKbdListeners, setKbdHandler, kbdWidth, kbdHeight } from "./screenKbd.js";
// JSZip: will be loaded lazily only when we actually need it (fallbackExtractIcon).
let JSZip = null;
async function ensureJSZip() {
    if (JSZip && JSZip.loadAsync) return JSZip;
    // attempt to use global first (if run.html/index.html included script)
    if (window.JSZip && window.JSZip.loadAsync) {
        JSZip = window.JSZip;
        return JSZip;
    }
    // dynamic import as fallback
    const mod = await import("../lib/jszip.min.js");
    JSZip = mod.default || mod.JSZip || window.JSZip || mod;
    return JSZip;
}

// we need to import natives here, don't use System.loadLibrary
// since CheerpJ fails to load them in firefox and we can't set breakpoints
import canvasFontNatives from "../libjs/libcanvasfont.js";
import canvasGraphicsNatives from "../libjs/libcanvasgraphics.js";
import gles2Natives from "../libjs/libgles2.js";
import jsReferenceNatives from "../libjs/libjsreference.js";
import mediaBridgeNatives from "../libjs/libmediabridge.js";
import midiBridgeNatives from "../libjs/libmidibridge.js";

const evtQueue = new EventQueue();
const sp = new URLSearchParams(location.search);

const cheerpjWebRoot = '/app'+location.pathname.replace(/\/[^/]*$/,'');

let isMobile = sp.get('mobile');

let display = null;
let screenCtx = null;

let fractionScale = localStorage && localStorage.getItem("pl.zb3.freej2me.fractionScale") === "true";
let scaleSet = false;
let midiEOMHandler; // Глобальная переменная для хранения слушателя

// Простое мапирование клавиш в стиле Dendy - без сложных менеджеров
const KEY_MAP = {
    // Цифры как есть
    'Digit0': 48, 'Digit1': 49, 'Digit2': 50, 'Digit3': 51, 'Digit4': 52,
    'Digit5': 53, 'Digit6': 54, 'Digit7': 55, 'Digit8': 56, 'Digit9': 57,
    // Стрелки -> цифры (J2ME навигация)
    'ArrowUp': 50,    // -> 2
    'ArrowDown': 56,  // -> 8  
    'ArrowLeft': 52,  // -> 4
    'ArrowRight': 54, // -> 6
    // WASD -> цифры (альтернативная навигация)
    'KeyW': 50,       // W -> 2 (вверх)
    'KeyS': 56,       // S -> 8 (вниз)  
    'KeyA': 52,       // A -> 4 (лево)
    'KeyD': 54,       // D -> 6 (право)
    // Прочие важные клавиши
    'Enter': 53,      // -> 5 (средняя кнопка)
    'KeyQ': 112,      // Левая софт-клавиша (F1)
    'KeyE': 113,      // Правая софт-клавиша (F2)
    'Escape': 27,     // Esc клавиша (стандартный ASCII код)
    // Звездочка * - разные способы ввода
    'NumpadMultiply': 42, // * с цифровой клавиатуры
    'NumpadAsterisk': 42, // * виртуальная кнопка
    'Equal': 42,          // = клавиша (Shift+= дает *)
    'KeyI': 42,           // * альтернативная клавиша
    // Решетка # - основной код 35
    'NumpadDivide': 35,   // / с цифровой клавиатуры  
    'Backquote': 35,      // ` клавиша (тильда)
    'Backslash': 35,      // \ клавиша  
    'KeyH': 35,           // H клавиша для #
    // Альтернативные коды для # (если 35 не работает)
    'Slash': 127,         // / основная клавиша -> альтернативный код 127
    'KeyN': 127           // N клавиша -> альтернативный код 127
};

window.evtQueue = evtQueue;

// Глобальная функция для виртуальных кнопок
window.handleVirtualKey = function(isDown, keyCode) {
    const mappedCode = KEY_MAP[keyCode];
    
    if (mappedCode) {
        evtQueue.queueEvent({
            kind: isDown ? 'keydown' : 'keyup',
            args: [mappedCode, mappedCode, false, false]
        });
    }
};

function autoscale() {
    if (!scaleSet) return;

    let screenWidth = window.innerWidth;
    let screenHeight = window.innerHeight;

    if (isMobile) {
        document.getElementById('left-keys').style.display = '';
        document.getElementById('right-keys').style.display = '';

        if (screenWidth > screenHeight) {
            document.body.classList.add('kbd-landscape');
            document.body.classList.remove('kbd-portrait');
            screenWidth = screenWidth - 2*kbdWidth;
        } else {
            document.body.classList.add('kbd-portrait');
            document.body.classList.remove('kbd-landscape');
            screenHeight = screenHeight - kbdHeight;
        }
    }

    let scale = Math.min(
        screenWidth/screenCtx.canvas.width,
        screenHeight/screenCtx.canvas.height
    );

    if (!fractionScale) {
        scale = scale|0;
    }

    display.style.zoom = scale;
}

function setListeners() {
    let mouseDown = false;
    let noMouse = false;

    // Виртуальная клавиатура использует window.handleVirtualKey напрямую

    // Простая функция обработки клавиш - в стиле Dendy
    function handleKeyboard(e) {
        let keyCode = KEY_MAP[e.code];
        
        // Обработка символов со Shift
        if (e.shiftKey) {
            if (e.code === 'Digit8') {
                keyCode = 42; // Shift+8 = *
            } else if (e.code === 'Digit3') {
                keyCode = 35; // Shift+3 = #
            }
        }
        
        if (!keyCode) return; // игнорируем неизвестные клавиши
        
        const isDown = e.type === 'keydown';
        
        // Мгновенно отправляем в очередь событий  
        evtQueue.queueEvent({
            kind: isDown ? 'keydown' : 'keyup',
            args: [keyCode, keyCode, e.ctrlKey, e.shiftKey]
        });
        
        e.preventDefault();
    }

    // Единственный обработчик событий
    document.addEventListener('keydown', handleKeyboard);
    document.addEventListener('keyup', handleKeyboard);

    display.addEventListener('mousedown', async e => {
        display.focus();
        if (noMouse) return;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: e.offsetX / display.currentCSSZoom | 0,
            y: e.offsetY / display.currentCSSZoom | 0,
        });

        mouseDown = true;

        e.preventDefault();
    });

    display.addEventListener('mousemove', async e => {
        if (noMouse) return;
        if (!mouseDown) return;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: e.offsetX / display.currentCSSZoom | 0,
            y: e.offsetY / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    document.addEventListener('mouseup', async e => {
        if (noMouse) return;
        if (!mouseDown) return;

        mouseDown = false;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (e.pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });


    display.addEventListener('touchstart', async e => {
        display.focus();
        noMouse = true;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    }, {passive: false});

    display.addEventListener('touchmove', async e => {
        noMouse = true;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    }, {passive: false});

    display.addEventListener('touchend', async e => {
        noMouse = true;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    document.addEventListener('mousedown', e => {
        setTimeout(() => display.focus(), 20);
    });

    display.addEventListener('blur', e => {
        // it doesn't work without any timeout
        setTimeout(() => display.focus(), 10);
    });

    window.addEventListener('resize', autoscale);

    initKbdListeners();
    setKbdHandler(window.handleVirtualKey);
}

function setFaviconFromBuffer(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    const reader = new FileReader();
    reader.onload = function() {
        const dataURL = reader.result;
        // сохраняем для run.html
        sessionStorage.setItem('currentGameIcon', dataURL);

        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'icon');
            document.head.appendChild(link);
        }
        link.setAttribute('href', dataURL);
    };
    reader.readAsDataURL(blob);
}

// Fallback: извлечь PNG-иконку из JAR
async function fallbackExtractIcon(jarPath) {
    const _JSZip = await ensureJSZip();
    try {
        const r = await fetch(jarPath);
        if (!r.ok) throw new Error('HTTP '+r.status);
        const buf = await r.arrayBuffer();
        const zip = await _JSZip.loadAsync(buf);

        // 1) icon.png
        let name = Object.keys(zip.files).find(n=>n.toLowerCase()==='icon.png');

        // 2) MIDlet-Icon
        if (!name && zip.file('META-INF/MANIFEST.MF')) {
            const mf = await zip.file('META-INF/MANIFEST.MF').async('string');
            const mIcon = mf.match(/^MIDlet-Icon:\s*(.+)$/m);
            if (mIcon) name = mIcon[1].trim();

            // 3) MIDlet-1, вторая часть
            if (!name) {
                const m1 = mf.match(/^MIDlet-1:\s*[^,]*,\s*([^,]+\.png)/m);
                if (m1) name = m1[1].trim();
            }
        }

        if (name && zip.file(name)) {
            const img = await zip.file(name).async('arraybuffer');
            setFaviconFromBuffer(img);
        }
    } catch(e) {
        console.warn('fallbackExtractIcon error', e);
    }
}

function cleanup() {
    console.log('Main: Очищаем ресурсы...');
    
    // Очищаем MIDI слушатели
    if (window.libmidi && window.libmidi.midiPlayer && midiEOMHandler) {
        window.libmidi.midiPlayer.removeEventListener('end-of-media', midiEOMHandler);
    }
    
    // Очищаем кеш MIDI плеера
    if (window.libMidiBridge && window.libMidiBridge.clearMidiPlayerCache) {
        window.libMidiBridge.clearMidiPlayerCache();
    }
    
    // Закрываем LibMidi
    if (window.libmidi) {
        window.libmidi.close();
    }
    
    // Закрываем LibMedia
    if (window.libmedia) {
        window.libmedia.close();
    }
}

// Добавляем слушатели для очистки при закрытии страницы
window.addEventListener('beforeunload', cleanup);
window.addEventListener('unload', cleanup);

async function init() {
    // Фильтруем debug логи FreeJ2ME 
    const originalConsoleLog = console.log;
    console.log = function(...args) {
        const message = args.join(' ');
        // Пропускаем debug логи MIDI системы
        if (message.includes('playerEOM called') || 
            message.includes('onplayerstop found') ||
            message.includes('MIDI sequence set, duration:')) {
            return;
        }
        originalConsoleLog.apply(console, args);
    };

    try {
        console.log("Main: Начинаем инициализацию...");
        document.getElementById("loading").textContent = "Initializing audio...";

        // Создаем аудио контекст
        console.log("Main: Создаем аудио контекст...");
        const audioContext = createUnlockingAudioContext();
        
        // Инициализируем LibMidi
        console.log("Main: Инициализируем LibMidi...");
        window.libmidi = new LibMidi(audioContext);
        await window.libmidi.init();
        
        // Инициализируем LibMedia
        console.log("Main: Инициализируем LibMedia...");
        window.libmedia = new LibMedia(audioContext);

        document.getElementById("loading").textContent = "Loading CheerpJ...";

        console.log("Main: Получаем display элементы...");
        display = document.getElementById('display');
        screenCtx = display.getContext('2d');

        console.log("Main: Устанавливаем слушатели событий...");
        console.log('🚀 About to call setListeners()');
        setListeners();
        console.log('🚀 setListeners() call completed');

        // Добавляем обработчик событий для MIDI (только один раз)
        if (!midiEOMHandler) {
            midiEOMHandler = (e) => {
                window.evtQueue.queueEvent({kind: 'player-eom', player: e.target});
            };
        }
        
        // Удаляем старый слушатель если он есть и добавляем новый
        if (window.libmidi.midiPlayer) {
            window.libmidi.midiPlayer.removeEventListener('end-of-media', midiEOMHandler);
            window.libmidi.midiPlayer.addEventListener('end-of-media', midiEOMHandler);
        }

        await cheerpjInit({
        enableDebug: false,
        natives: {
            ...canvasFontNatives,
            ...canvasGraphicsNatives,
            ...gles2Natives,
            ...jsReferenceNatives,
            ...mediaBridgeNatives,
            ...midiBridgeNatives,
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setTitle(lib, title) {
                document.title = title;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setIcon(lib, iconBytes) {
                if (iconBytes) {
                    setFaviconFromBuffer(iconBytes.buffer);
                } else if (window.currentJarPath) {
                    fallbackExtractIcon(window.currentJarPath);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_getScreenCtx(lib) {
                return screenCtx;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setCanvasSize(lib, width, height) {
                if (!scaleSet) {
                    document.getElementById('loading').hidden = true;
                    display.style.display = '';
                    scaleSet = true;
                    display.focus();
                }
                screenCtx.canvas.width = width;
                screenCtx.canvas.height = height;
                autoscale();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener) {
                const KeyEvent = await lib.pl.zb3.freej2me.bridge.shell.KeyEvent;
                const PointerEvent = await lib.pl.zb3.freej2me.bridge.shell.PointerEvent;

                const evt = await evtQueue.waitForEvent();
                
                try {
                    // Добавляем таймауты для всех Java вызовов
                    const processEventWithTimeout = async (eventProcessor) => {
                        // Выполняем обработчик без ограничений по времени
                        return eventProcessor();
                    };

                    if (evt.kind == 'keydown') {
                        await processEventWithTimeout(async () => {
                            await listener.keyPressed(await new KeyEvent(...evt.args));
                        });
                    } else if (evt.kind == 'keyup') {
                        await processEventWithTimeout(async () => {
                            await listener.keyReleased(await new KeyEvent(...evt.args));
                        });
                    } else if (evt.kind == 'pointerpressed') {
                        await processEventWithTimeout(async () => {
                            await listener.pointerPressed(await new PointerEvent(evt.x, evt.y));
                        });
                    } else if (evt.kind == 'pointerdragged') {
                        await processEventWithTimeout(async () => {
                            await listener.pointerDragged(await new PointerEvent(evt.x, evt.y));
                        });
                    } else if (evt.kind == 'pointerreleased') {
                        await processEventWithTimeout(async () => {
                            await listener.pointerReleased(await new PointerEvent(evt.x, evt.y));
                        });
                    } else if (evt.kind == 'player-eom') {
                        await processEventWithTimeout(async () => {
                            await listener.playerEOM(evt.player);
                        });
                    } else if (evt.kind == 'player-video-frame') {
                        await processEventWithTimeout(async () => {
                            await listener.playerVideoFrame(evt.player);
                        });
                    }
                } catch (error) {
                    console.error('Shell: ошибка при обработке события:', error);
                    if (error.message === 'Timeout') {
                        console.error('Shell: TIMEOUT! Событие зависло, пропускаем и продолжаем');
                    }
                    // Не блокируем обработку других событий даже при ошибке
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_restart(lib) {
                cleanup();
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_exit(lib) {
                cleanup();
                location.href = '/';
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sthop(lib) {
                debugger;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_say(lib, sth) {
                console.log('[say]', sth);
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sayObject(lib, label, obj) {
                debugger;
                console.log('[sayobject]', label, obj);
            }
        }
    });

    document.getElementById("loading").textContent = "Loading...";

    const lib = await cheerpjRunLibrary(cheerpjWebRoot+"/freej2me-web.jar");
    
    // Устанавливаем emulator для bridge callbacks
    window.emulator = lib;

    if (!window.__cheerpReadyLogged) {
        console.log("CheerpJ runtime ready");
        window.__cheerpReadyLogged = true;
    }

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;

    let args;

    if (sp.get('app')) {
        const appId = sp.get('app');
        console.log(`Main: Запуск приложения ${appId} в app режиме`);
        
        // Загружаем настройки только из файла конфига
        await loadSettingsFromConfig(appId, lib);
        
        args = ['app', appId];
    } else {
        // Используем LauncherUtil для инициализации JAR как приложения
        const jarName = sp.get('jar') || "game.jar";
        const appId = jarName.replace(/\.jar$/i, ''); // id без расширения

        window.currentJarName = jarName;
        window.currentJarPath = sp.get('jar') ? "./games/"+jarName : "/files/"+jarName;
        console.log(`Main: Инициализируем JAR ${jarName} как app ${appId} через LauncherUtil...`);
        
        try {
            const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
            const HashMap = await lib.java.util.HashMap;
            
            // Сначала проверяем, существует ли приложение уже в /files/
            const Files = await lib.java.nio.file.Files;
            const Paths = await lib.java.nio.file.Paths;
            
            const appDir = "/files/" + appId;
            const appDirPath = await Paths.get(appDir);

            const jarPath = "/files/" + jarName;
            const jarPathObj = await Paths.get(jarPath);

            // Считаем приложение существующим, если есть либо директория /files/appId, либо сам JAR.
            const appExists = (await Files.exists(appDirPath)) || (await Files.exists(jarPathObj));
            console.log(`Main: Проверяем существование: dir=${await Files.exists(appDirPath)} jar=${await Files.exists(jarPathObj)} → appExists=${appExists}`);
            let initSuccess = false;
            
            if (!appExists) {
                // Приложение не существует – сразу переходим к ручной копии JAR в /files/
                {
                    console.log("Main: Копируем JAR в /files...");
                    try {
                        // Убеждаемся, что каталог /files существует
                        try { await Files.createDirectories(await Paths.get('/files')); } catch(e) {}

                        // Пытаемся взять JAR из localStorage, иначе качаем
                        let jarData;
                        const uploadedGames = JSON.parse(localStorage.getItem('uploadedGames') || '[]');
                        const uploaded = uploadedGames.find(g => g.filename === jarName);
                        if (uploaded && uploaded.data) {
                            console.log(`Main: Найдена загруженная игра ${jarName} в localStorage`);
                            const bin = atob(uploaded.data);
                            jarData = new ArrayBuffer(bin.length);
                            const u8 = new Uint8Array(jarData);
                            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                            console.log(`Main: Декодировано ${jarData.byteLength} байт из localStorage`);
                        } else {
                            console.log(`Main: Загружаем ${jarName} через fetch...`);
                            const r = await fetch("./games/" + encodeURIComponent(jarName));
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            jarData = await r.arrayBuffer();
                            console.log(`Main: Загружено ${jarData.byteLength} байт`);
                        }

                        // Пишем во /str/<jarName>
                        const tempPath = "/str/" + jarName;
                        await addFileToStrMount(tempPath, new Uint8Array(jarData));
                        console.log(`Main: Файл записан во временный ${tempPath}`);

                        // Копируем JAR во /files/, перед этим пробуем удалить старый файл (если вдруг остался от предыдущих попыток)
                        const destPath = "/files/" + jarName;
                        const destPathObj = await Paths.get(destPath);
                        try { await Files.deleteIfExists(destPathObj); } catch(e) { /* ignore */ }
                        await Files.copy(await Paths.get(tempPath), destPathObj);
                        console.log(`Main: Файл скопирован в ${destPath}`);

                        if (await Files.exists(await Paths.get(destPath))) {
                            const size = await Files.size(await Paths.get(destPath));
                            console.log(`Main: ✓ файл сохранён (${size} байт)`);
                            initSuccess = true;
                        } else {
                            throw new Error("Копирование не удалось");
                        }
                        
                    } catch (e) {
                        console.error("Main: Ошибка копирования файла:", e.message);
                    }
                }
            }
            
            // Сохраняем дефолтные настройки только если приложение новое
            if (initSuccess && !appExists) {
                console.log("Main: Создаем дефолтные настройки для нового приложения...");
                
                // Удаляем старые настройки если есть, чтобы убрать поле fps
                try {
                    const oldSettingsPath = `/files/${appId}/config/settings.conf`;
                    const settingsFilePath = await Paths.get(oldSettingsPath);
                    await Files.deleteIfExists(settingsFilePath);
                    console.log("Main: Удалили старые настройки");
                } catch (e) {
                    console.log("Main: Старые настройки отсутствуют");
                }
                
                await saveDefaultSettings(appId, lib, LauncherUtil);
            }
            
            // Выбор режима запуска - всегда jar режим из /files/
            if (initSuccess || appExists) {
                // Если копирование успешно или файл уже существует - используем JAR из /files/
                args = ['jar', '/files/' + jarName];
                console.log("Main: Используем JAR из /files/");
            } else {
                // Файл не скопирован - копируем из ./games/ в /files/
                console.log("Main: Копируем JAR из ./games/ в /files/...");
                try {
                    const gameJarResponse = await fetch('./games/' + encodeURIComponent(jarName));
                    if (!gameJarResponse.ok) {
                        throw new Error(`HTTP ${gameJarResponse.status}`);
                    }
                    
                    const gameJarData = await gameJarResponse.arrayBuffer();
                    const gameJarBytes = new Uint8Array(gameJarData);
                    
                    await addFileToStrMount('/files/' + jarName, gameJarBytes);
                    console.log("Main: JAR успешно скопирован в /files/");
                    
                    // Используем скопированный файл
                    args = ['jar', '/files/' + jarName];
                } catch (copyError) {
                    console.error("Main: Ошибка копирования JAR:", copyError);
                    // Fallback к оригинальному пути
                    args = ['jar', './games/' + jarName];
                    console.log("Main: Fallback к оригинальному JAR из ./games/");
                }
            }
            
        } catch (error) {
            console.error("Main: Ошибка LauncherUtil, fallback to jar:", error);
            // Fallback to jar режим
            args = ['jar', "./games/" + jarName];
        }
    }

    console.log(`Main: Запускаем FreeJ2ME с аргументами:`, args);
    
    try {
        await FreeJ2ME.main(args);
        console.log("Main: FreeJ2ME запущен успешно");
    } catch (error) {
        console.error("Main: Краш FreeJ2ME:", error);
        if (error.printStackTrace) {
            error.printStackTrace();
        }
        document.getElementById('loading').textContent = 'Crash :(';
    }

    console.log("Main: Инициализация завершена");
    } catch (error) {
        console.error("Main: Ошибка инициализации:", error);
        document.getElementById('loading').textContent = 'Ошибка инициализации: ' + error.message;
    }
}

// Функция для загрузки настроек из конфига
async function loadSettingsFromConfig(appId, lib) {
    try {
        console.log(`Main: Загружаем настройки для приложения ${appId} из конфига...`);
        
        const settingsPath = `/files/${appId}/config/settings.conf`;
        const settingsBlob = await cjFileBlob(settingsPath);
        
        if (settingsBlob) {
            const settingsContent = await settingsBlob.text();
            console.log(`Main: Найдены сохраненные настройки: "${settingsContent}"`);
            
            if (settingsContent.trim()) {
                console.log("Main: Настройки загружены из файла успешно");
            } else {
                console.log("Main: Файл настроек пустой - используем настройки по умолчанию без сохранения");
            }
        } else {
            console.log("Main: Файл настроек не найден - используем настройки по умолчанию без сохранения");
        }
        
    } catch (error) {
        console.error("Main: Ошибка загрузки настроек из конфига:", error);
    }
}

// Функция для сохранения дефолтных настроек 
async function saveDefaultSettings(appId, libOrLauncherUtil, LauncherUtil) {
    try {
        console.log(`Main: Сохраняем дефолтные настройки для приложения ${appId}...`);
        
        let lib, launcherUtil;
        
        // Если второй параметр это lib объект
        if (libOrLauncherUtil && libOrLauncherUtil.pl) {
            lib = libOrLauncherUtil;
            launcherUtil = LauncherUtil || await lib.pl.zb3.freej2me.launcher.LauncherUtil;
        } else {
            // Если второй параметр это LauncherUtil (старый вызов)
            launcherUtil = libOrLauncherUtil;
            // lib должен быть доступен глобально
            lib = window.lib;
        }
        
        const HashMap = await lib.java.util.HashMap;
        
        // Создаем дефолтные настройки без привязки к URL
        console.log(`Main: Создаем дефолтные настройки для нового приложения ${appId}`);
        
        const correctSettings = await new HashMap();
        
        // Валидируем числовые значения чтобы избежать NumberFormatException
        const validatedWidth = "240";  // всегда строка числа
        const validatedHeight = "320"; // всегда строка числа
        
        await correctSettings.put("phone", "Standard");
        await correctSettings.put("fontSize", "2");  // 2 = Medium (как в оригинале)
        await correctSettings.put("dgFormat", "4444");
        await correctSettings.put("width", validatedWidth);
        await correctSettings.put("height", validatedHeight);
        await correctSettings.put("sound", "on");
        await correctSettings.put("rotate", "off");
        await correctSettings.put("forceFullscreen", "off");
        await correctSettings.put("textureDisableFilter", "off");
        await correctSettings.put("queuedPaint", "off");
        await correctSettings.put("limitFps", "0");
        
        // Удаляем старое поле fps если оно есть (из Java кода)
        if (await correctSettings.containsKey("fps")) {
            await correctSettings.remove("fps");
            console.log("Main: Удалили старое поле fps из настроек");
        }
        
        console.log(`Main: Валидированные настройки: width=${validatedWidth}, height=${validatedHeight}`);
        
        const emptyAppProps = await new HashMap();
        const emptySysProps = await new HashMap();
        
        console.log("Main: Вызываем LauncherUtil.saveApp...");
        await launcherUtil.saveApp(appId, correctSettings, emptyAppProps, emptySysProps);
        console.log("Main: Дефолтные настройки сохранены");
        
        // Проверяем что сохранилось и что нет старого поля fps
        setTimeout(async () => {
            try {
                const newSettingsBlob = await cjFileBlob(`/files/${appId}/config/settings.conf`);
                if (newSettingsBlob) {
                    const newContent = await newSettingsBlob.text();
                    console.log(`Main: Проверка сохранения - содержимое файла: "${newContent}"`);
                    
                    // Проверяем что нет старого поля fps
                    if (newContent.includes('fps:')) {
                        console.error("Main: ОШИБКА! В файле все еще есть старое поле fps!");
                    } else {
                        console.log("Main: ✓ Поле fps отсутствует, настройки корректны");
                    }
                } else {
                    console.log("Main: Проверка сохранения - файл не найден!");
                }
            } catch (checkError) {
                console.error("Main: Ошибка проверки сохранения:", checkError);
            }
        }, 2000);
        
    } catch (error) {
        console.error("Main: Ошибка сохранения дефолтных настроек:", error);
        console.error("Main: Stack trace:", error.stack);
    }
}

// Функция для применения настроек к запущенной игре
window.applyGameSettings = async function(appId, settings) {
    console.log(`Main: Применяем настройки к запущенной игре ${appId}:`, settings);
    
    if (!window.emulator) {
        throw new Error("Эмулятор не запущен");
    }
    
    try {
        // Получаем Config из эмулятора
        const Config = await window.emulator.org.recompile.freej2me.Config;
        
        // Применяем настройки
        const settingsMap = await Config.settings;
        
        // Преобразуем настройки в правильный формат
        await settingsMap.put("width", settings.width.toString());
        await settingsMap.put("height", settings.height.toString());
        await settingsMap.put("phone", settings.phone);
        await settingsMap.put("dgFormat", settings.dgFormat);
        await settingsMap.put("fontSize", settings.fontSize.toString());
        await settingsMap.put("limitFps", settings.limitFps.toString());
        await settingsMap.put("sound", settings.sound ? "on" : "off");
        await settingsMap.put("rotate", settings.rotate ? "on" : "off");
        await settingsMap.put("forceFullscreen", settings.forceFullscreen ? "on" : "off");
        await settingsMap.put("textureDisableFilter", "off");
        await settingsMap.put("queuedPaint", "off");
        
        // Удаляем старое поле fps если оно есть
        if (await settingsMap.containsKey("fps")) {
            await settingsMap.remove("fps");
            console.log("Main: Удалили старое поле fps из настроек запущенной игры");
        }
        
        // Сохраняем настройки в файл
        await saveUpdatedSettings(appId, settingsMap);
        
        console.log("Main: Настройки успешно применены к запущенной игре");
        return true;
    } catch (error) {
        console.error("Main: Ошибка применения настроек:", error);
        throw error;
    }
};

// Вспомогательная функция для сохранения обновленных настроек
async function saveUpdatedSettings(appId, settingsMap) {
    try {
        const LauncherUtil = await window.emulator.pl.zb3.freej2me.launcher.LauncherUtil;
        const HashMap = await window.emulator.java.util.HashMap;
        
        // Сохраняем настройки через LauncherUtil
        const emptyAppProps = await new HashMap();
        const emptySysProps = await new HashMap();
        
        await LauncherUtil.saveApp(appId, settingsMap, emptyAppProps, emptySysProps);
        
        console.log(`Main: Обновленные настройки сохранены для ${appId}`);
    } catch (error) {
        console.error(`Main: Ошибка сохранения обновленных настроек для ${appId}:`, error);
        throw error;
    }
}

// === CheerpJ FS helpers ===
// Безопасно добавляет файл в /str/, дожидаясь инициализации файловой системы
async function addFileToStrMount(path, uint8Arr, maxWaitMs = 5000) {
    const start = performance.now();

    // Ждём, пока смонтируется /str/
    while (!self.cheerpjGetFSMountForPath || !cheerpjGetFSMountForPath('/str/') ) {
        if (performance.now() - start > maxWaitMs) {
            throw new Error('CheerpJ FS /str/ mount not ready');
        }
        await new Promise(r => setTimeout(r, 50));
    }

    // Пытаемся сохранить файл; при сбое дадим ещё пару попыток
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            cheerpOSAddStringFile(path, uint8Arr);
            return;
        } catch (e) {
            if (attempt === 2) throw e;
            console.warn('addFileToStrMount retry after error:', e.message);
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

init();