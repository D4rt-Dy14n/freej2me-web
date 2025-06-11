import { LibMedia } from "../libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "../libmidi/libmidi.js";
import { EventQueue } from "./eventqueue.js";
import { initKbdListeners, setKbdHandler, kbdWidth, kbdHeight } from "./screenKbd.js";

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
                    const processEventWithTimeout = async (eventProcessor, timeoutMs = 100) => {
                        return Promise.race([
                            eventProcessor(),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), timeoutMs)
                            )
                        ]);
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

    // Мягкая очистка кэша без удаления файлов игр
    try {
        console.log("Main: Мягкая очистка кэша (без удаления файлов игр)...");
        
        // Очищаем только sessionStorage (временные данные сессии)
        try {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && (key.includes('cheerpj') || key.includes('CheerpJ') || key.includes('freej2me'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => {
                sessionStorage.removeItem(key);
                console.log(`Main: Удален sessionStorage ключ: ${key}`);
            });
        } catch (e) {
            console.log("Main: Ошибка при очистке sessionStorage:", e.message);
        }

        // НЕ очищаем localStorage - там хранятся загруженные игры
        console.log("Main: localStorage сохранен (содержит загруженные игры)");

        // НЕ очищаем IndexedDB - там хранятся файлы и RMS данные игр
        console.log("Main: IndexedDB сохранен (содержит файлы игр и RMS данные)");
        
        console.log("Main: Мягкая очистка завершена");
        
    } catch (error) {
        console.error("Main: Ошибка при очистке кэша:", error);
    }

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;

    let args;

    if (sp.get('app')) {
        const appId = sp.get('app');
        console.log(`Main: Запуск приложения ${appId} в app режиме`);
        
        // Загружаем и применяем настройки даже для app режима
        try {
            const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
            const HashMap = await lib.java.util.HashMap;
            const Files = await lib.java.nio.file.Files;
            const Paths = await lib.java.nio.file.Paths;
            
            // Настройки по умолчанию
            const defaults = {
                phone: "standard",
                fontSize: "medium", 
                dgFormat: "4444",
                width: 240,
                height: 320,
                sound: true,
                rotate: false,
                forceFullscreen: false,
                limitFps: 0
            };

            // Загружаем сохраненные настройки из файлов
            let savedFileSettings = {};
            try {
                console.log("Main: Загружаем сохраненные настройки из файлов для app режима...");
                const settingsPath = `/files/${appId}/config/settings.conf`;
                
                // Используем CheerpJ API для чтения файлов
                const settingsBlob = await cjFileBlob(settingsPath);
                if (settingsBlob) {
                    const settingsContent = await settingsBlob.text();
                    console.log("Main: Найдены сохраненные настройки:", settingsContent);
                    
                    // Парсим настройки из формата "key: value"
                    const lines = settingsContent.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed && trimmed.includes(':')) {
                            const [key, value] = trimmed.split(':').map(s => s.trim());
                            if (key && value) {
                                // Конвертируем значения в правильные типы
                                if (value === 'true' || value === 'false') {
                                    savedFileSettings[key] = value === 'true';
                                } else if (!isNaN(value)) {
                                    savedFileSettings[key] = parseInt(value);
                                } else if (value === 'on') {
                                    savedFileSettings[key] = true;
                                } else if (value === 'off') {
                                    savedFileSettings[key] = false;
                                } else {
                                    savedFileSettings[key] = value;
                                }
                            }
                        }
                    }
                    console.log("Main: Разобранные настройки из файла (app режим):", savedFileSettings);
                } else {
                    console.log("Main: Файл настроек не найден для app режима");
                }
            } catch (loadError) {
                console.log("Main: Ошибка загрузки настроек из файла (app режим):", loadError.message);
            }

            // Применяем настройки: defaults <- savedFileSettings <- URL параметры
            const settings = { ...defaults, ...savedFileSettings };
            
            // URL параметры имеют наивысший приоритет
            for (const [key, defaultValue] of Object.entries(defaults)) {
                const urlValue = sp.get(key);
                if (urlValue !== null) {
                    // Конвертируем значения в правильный тип
                    if (typeof defaultValue === 'boolean') {
                        settings[key] = urlValue === 'true';
                    } else if (typeof defaultValue === 'number') {
                        settings[key] = parseInt(urlValue) || defaultValue;
                    } else {
                        settings[key] = urlValue;
                    }
                }
            }

            console.log("Main: Финальные настройки для app режима:", settings);

            // Если есть изменения в настройках, сохраняем их
            const hasUrlSettings = Object.keys(defaults).some(key => sp.get(key) !== null);
            if (hasUrlSettings || Object.keys(savedFileSettings).length === 0) {
                console.log("Main: Обновляем настройки приложения в app режиме...");
                
                const correctSettings = await new HashMap();
                await correctSettings.put("phone", settings.phone);
                await correctSettings.put("fontSize", settings.fontSize);
                await correctSettings.put("dgFormat", settings.dgFormat);
                await correctSettings.put("width", settings.width);
                await correctSettings.put("height", settings.height);
                await correctSettings.put("sound", settings.sound ? "on" : "off");
                await correctSettings.put("rotate", settings.rotate ? "on" : "off");
                await correctSettings.put("forceFullscreen", settings.forceFullscreen ? "on" : "off");
                await correctSettings.put("textureDisableFilter", "off");
                await correctSettings.put("queuedPaint", "off");
                
                if (settings.limitFps > 0) {
                    await correctSettings.put("limitFps", settings.limitFps);
                }
                
                const emptyAppProps = await new HashMap();
                const emptySysProps = await new HashMap();
                
                await LauncherUtil.saveApp(appId, correctSettings, emptyAppProps, emptySysProps);
                console.log("Main: Настройки обновлены в app режиме");
            }
            
        } catch (error) {
            console.error("Main: Ошибка обработки настроек в app режиме:", error);
        }
        
        args = ['app', appId];
    } else {
        // Используем LauncherUtil для инициализации JAR как приложения
        const jarName = sp.get('jar') || "game.jar";
        const isUploaded = sp.get('uploaded') === 'true';
        const appId = jarName.replace('.jar', '');
        
        console.log(`Main: Инициализируем JAR ${jarName} как app ${appId} через LauncherUtil...`);
        
        try {
            const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
            const HashMap = await lib.java.util.HashMap;
            
            // Сначала проверяем, существует ли приложение уже в /files/
            const Files = await lib.java.nio.file.Files;
            const Paths = await lib.java.nio.file.Paths;
            
            const appDir = "/files/" + appId;
            const appJarPath = appDir + "/app.jar";
            const appDirPath = await Paths.get(appDir);
            const appJarFilePath = await Paths.get(appJarPath);
            
            const appExists = await Files.exists(appDirPath);
            const jarExists = await Files.exists(appJarFilePath);
            
            console.log(`Main: Проверяем существование: ${appDir} = ${appExists}, ${appJarPath} = ${jarExists}`);
            
            let initSuccess = false;
            
            if (appExists && jarExists) {
                // Приложение уже существует, не копируем JAR заново
                console.log(`Main: Приложение ${appId} уже существует, используем существующую установку`);
                initSuccess = true;
                
                // Применяем только настройки из URL без перезаписи JAR файла
                console.log("Main: Обновляем настройки для существующего приложения...");
            } else {
                // Приложение не существует, пытаемся инициализировать с разными путями
                const possiblePaths = [
                    "./games/" + jarName,
                    "/app/jar/" + jarName,
                    "/files/" + jarName,
                    "/jar/" + jarName,
                    jarName
                ];
                
                for (const path of possiblePaths) {
                    try {
                        console.log(`Main: Пробуем инициализировать с путем: ${path}`);
                        await LauncherUtil.initApp(appId, path);
                        console.log(`Main: Приложение успешно инициализировано с путем: ${path}`);
                        initSuccess = true;
                        break;
                    } catch (initError) {
                        console.log(`Main: Ошибка с путем ${path}:`, initError.message);
                    }
                }
            }
            
            if (!initSuccess) {
                console.log("Main: Не удалось инициализировать приложение стандартным способом, попробуем JAR загрузку...");
                
                try {
                    console.log("Main: Загружаем JAR файл для копирования в /files/...");
                    let jarData;
                    
                    if (isUploaded) {
                        // Загружаем из localStorage
                        console.log("Main: Ищем загруженную игру в localStorage...");
                        const uploadedGames = JSON.parse(localStorage.getItem('uploadedGames') || '[]');
                        const game = uploadedGames.find(g => g.filename === jarName);
                        
                        if (!game) {
                            throw new Error(`Загруженная игра ${jarName} не найдена в localStorage`);
                        }
                        
                        // Конвертируем base64 обратно в ArrayBuffer
                        const binary = atob(game.data);
                        jarData = new ArrayBuffer(binary.length);
                        const bytes = new Uint8Array(jarData);
                        for (let i = 0; i < binary.length; i++) {
                            bytes[i] = binary.charCodeAt(i);
                        }
                        console.log(`Main: Загружено ${jarData.byteLength} байт из localStorage`);
                    } else {
                        // Загружаем из файла
                        console.log("Main: Загружаем JAR файл через fetch...");
                        const response = await fetch("./games/" + jarName);
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        jarData = await response.arrayBuffer();
                    }
                    console.log(`Main: Загружено ${jarData.byteLength} байт`);
                    
                    // Используем правильный подход CheerpJ - запись в /str/ mount point
                    const targetPath = "/str/" + jarName;
                    
                    console.log(`Main: Записываем JAR файл в /str/ mount point: ${targetPath}`);
                    
                    // Используем cheerpOSAddStringFile для записи файла в /str/ mount point
                    const uint8Array = new Uint8Array(jarData);
                    await cheerpOSAddStringFile(targetPath, uint8Array);
                    console.log(`Main: Файл записан в ${targetPath}, размер: ${uint8Array.length} байт`);
                    
                    // Проверяем, не существует ли уже файл в /files/
                    const finalTargetDir = "/files/" + appId;
                    const finalTargetPath = finalTargetDir + "/app.jar";
                    const finalTargetFilePath = await Paths.get(finalTargetPath);
                    const fileAlreadyExists = await Files.exists(finalTargetFilePath);
                    
                    if (fileAlreadyExists) {
                        console.log(`Main: Файл ${finalTargetPath} уже существует, пропускаем копирование (сохраняем RMS данные)`);
                        initSuccess = true;
                    } else {
                        // Копируем только если файл не существует
                        try {
                            // Создаем target директорию
                            const targetDirPath = await Paths.get(finalTargetDir);
                            await Files.createDirectories(targetDirPath);
                            console.log(`Main: Создана финальная директория ${finalTargetDir}`);
                        
                            // Копируем из /str/ в /files/
                            const sourcePath = await Paths.get(targetPath);
                            await Files.copy(sourcePath, finalTargetFilePath);
                            console.log(`Main: Файл скопирован из ${targetPath} в ${finalTargetPath}`);
                            
                            // Проверяем финальный файл
                            const exists = await Files.exists(finalTargetFilePath);
                            if (exists) {
                                const size = await Files.size(finalTargetFilePath);
                                console.log(`Main: Финальный файл существует, размер: ${size} байт`);
                                initSuccess = true;
                            } else {
                                throw new Error("Финальный файл не создался");
                            }
                        } catch (copyError) {
                            console.log(`Main: Ошибка копирования файла: ${copyError.message}`);
                            throw copyError;
                        }
                    }
                    
                } catch (jarError) {
                    console.log("Main: Ошибка загрузки/записи файла:", jarError.message || jarError);
                }
            }
            
            // Создаем настройки с учетом переданных параметров
            const correctSettings = await new HashMap();
            
            // Настройки по умолчанию
            const defaults = {
                phone: "standard",
                fontSize: "medium", 
                dgFormat: "4444",
                width: 240,
                height: 320,
                sound: true,
                rotate: false,
                forceFullscreen: false,
                limitFps: 0
            };

            // Сначала загружаем сохраненные настройки из файлов (если они есть)
            let savedFileSettings = {};
            if (initSuccess) {
                try {
                    console.log("Main: Загружаем сохраненные настройки из файлов...");
                    const settingsPath = `/files/${appId}/config/settings.conf`;
                    
                    // Используем CheerpJ API для чтения файлов
                    const settingsBlob = await cjFileBlob(settingsPath);
                    if (settingsBlob) {
                        const settingsContent = await settingsBlob.text();
                        console.log("Main: Найдены сохраненные настройки:", settingsContent);
                        
                        // Парсим настройки из формата "key: value"
                        const lines = settingsContent.split('\n');
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed && trimmed.includes(':')) {
                                const [key, value] = trimmed.split(':').map(s => s.trim());
                                if (key && value) {
                                    // Конвертируем значения в правильные типы
                                    if (value === 'true' || value === 'false') {
                                        savedFileSettings[key] = value === 'true';
                                    } else if (!isNaN(value)) {
                                        savedFileSettings[key] = parseInt(value);
                                    } else if (value === 'on') {
                                        savedFileSettings[key] = true;
                                    } else if (value === 'off') {
                                        savedFileSettings[key] = false;
                                    } else {
                                        savedFileSettings[key] = value;
                                    }
                                }
                            }
                        }
                        console.log("Main: Разобранные настройки из файла:", savedFileSettings);
                    } else {
                        console.log("Main: Файл настроек не найден, используем defaults");
                    }
                } catch (loadError) {
                    console.log("Main: Ошибка загрузки настроек из файла:", loadError.message);
                }
            }

            // Применяем настройки: defaults <- savedFileSettings <- URL параметры
            const settings = { ...defaults, ...savedFileSettings };
            
            // URL параметры имеют наивысший приоритет
            for (const [key, defaultValue] of Object.entries(defaults)) {
                const urlValue = sp.get(key);
                if (urlValue !== null) {
                    // Конвертируем значения в правильный тип
                    if (typeof defaultValue === 'boolean') {
                        settings[key] = urlValue === 'true';
                    } else if (typeof defaultValue === 'number') {
                        settings[key] = parseInt(urlValue) || defaultValue;
                    } else {
                        settings[key] = urlValue;
                    }
                }
            }

            console.log("Main: Финальные настройки для применения:", settings);

            // Устанавливаем настройки в HashMap
            await correctSettings.put("phone", settings.phone);
            await correctSettings.put("fontSize", settings.fontSize);
            await correctSettings.put("dgFormat", settings.dgFormat);
            await correctSettings.put("width", settings.width);
            await correctSettings.put("height", settings.height);
            await correctSettings.put("sound", settings.sound ? "on" : "off");
            await correctSettings.put("rotate", settings.rotate ? "on" : "off");
            await correctSettings.put("forceFullscreen", settings.forceFullscreen ? "on" : "off");
            await correctSettings.put("textureDisableFilter", "off");
            await correctSettings.put("queuedPaint", "off");
            
            // Устанавливаем лимит FPS если указан
            if (settings.limitFps > 0) {
                await correctSettings.put("limitFps", settings.limitFps);
            }
            
            const emptyAppProps = await new HashMap();
            const emptySysProps = await new HashMap();
            
            console.log("Main: Сохраняем настройки приложения...");
            await LauncherUtil.saveApp(appId, correctSettings, emptyAppProps, emptySysProps);
            console.log("Main: Настройки сохранены");
            
            // Используем app режим
            args = ['app', appId];
            
        } catch (error) {
            console.error("Main: Ошибка LauncherUtil, fallback to jar:", error);
            
            // Попробуем загрузить JAR файл для прямого запуска
            try {
                console.log("Main: Загружаем JAR для прямого запуска...");
                let jarData;
                
                if (isUploaded) {
                    // Загружаем из localStorage
                    console.log("Main: Ищем загруженную игру в localStorage (fallback)...");
                    const uploadedGames = JSON.parse(localStorage.getItem('uploadedGames') || '[]');
                    const game = uploadedGames.find(g => g.filename === jarName);
                    
                    if (!game) {
                        throw new Error(`Загруженная игра ${jarName} не найдена в localStorage`);
                    }
                    
                    // Конвертируем base64 обратно в ArrayBuffer
                    const binary = atob(game.data);
                    jarData = new ArrayBuffer(binary.length);
                    const bytes = new Uint8Array(jarData);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    console.log(`Main: Загружено ${jarData.byteLength} байт из localStorage (fallback)`);
                } else {
                    // Загружаем из файла
                    const response = await fetch("./games/" + jarName);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    jarData = await response.arrayBuffer();
                }
                console.log(`Main: Загружено ${jarData.byteLength} байт для прямого запуска`);
                
                // Используем /str/ mount point для fallback
                console.log(`Main: Записываем JAR файл в /str/ для fallback...`);
                
                const tempPath = "/str/" + jarName;
                const uint8Array = new Uint8Array(jarData);
                await cheerpOSAddStringFile(tempPath, uint8Array);
                console.log(`Main: Файл записан в ${tempPath} для fallback, размер: ${uint8Array.length} байт`);
                
                // Используем /str/ путь напрямую
                args = ['jar', tempPath];
                
            } catch (fetchError) {
                console.error("Main: Ошибка загрузки JAR для fallback:", fetchError);
                // Последняя попытка с исходным путем
                args = ['jar', "./games/" + jarName];
            }
        }
    }

    console.log("Main: Запускаем FreeJ2ME с аргументами:", args);
    
    FreeJ2ME.main(args).catch(e => {
        console.error("Main: Краш FreeJ2ME:", e);
        e.printStackTrace();
        document.getElementById('loading').textContent = 'Crash :(';
    });

    console.log("Main: Инициализация завершена");
    } catch (error) {
        console.error("Main: Ошибка инициализации:", error);
        document.getElementById('loading').textContent = 'Ошибка инициализации: ' + error.message;
    }
}

init();