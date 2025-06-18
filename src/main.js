// Детекция браузера
function isChrome() {
    return navigator.userAgent.includes('Chrome') && !navigator.userAgent.includes('Edg');
}

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

// ВАЖНО: используем /app/ префикс для CheerpJ виртуальной файловой системы
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
    });

    display.addEventListener('touchend', async e => {
        if (e.changedTouches.length == 0) return;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    display.addEventListener('touchmove', async e => {
        if (e.changedTouches.length == 0) return;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: (e.changedTouches[0].pageX - display.offsetLeft) / display.currentCSSZoom | 0,
            y: (e.changedTouches[0].pageY - display.offsetTop) / display.currentCSSZoom | 0,
        });

        e.preventDefault();
    });

    document.addEventListener('keydown', e => {
        if (e.code == 'KeyR' && e.ctrlKey) {
            location.reload();
            e.preventDefault();
        }

        if (e.code == 'KeyG' && e.ctrlKey) {
            location.href = '/';
            e.preventDefault();
        }

        if (e.code == 'KeyF') {
            fractionScale = !fractionScale;
            if (localStorage) {
                localStorage.setItem("pl.zb3.freej2me.fractionScale", fractionScale);
            }
            autoscale();
            e.preventDefault();
        }
    });

    window.addEventListener('resize', autoscale);

    if (isMobile) {
        initKbdListeners(setKbdHandler);
        setKbdHandler(evtQueue.queueEvent.bind(evtQueue));
    }
}

function setFaviconFromBuffer(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    
    // Удаляем старые favicon элементы
    const existingLinks = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
    existingLinks.forEach(link => link.remove());
    
    // Создаем новый favicon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = url;
    document.head.appendChild(link);
    
    console.log('✅ Установлен favicon игры');
}

function cleanup() {
    if (window.libmidi && window.libmidi.destroy) {
        window.libmidi.destroy();
    }
    
    if (window.libmedia && window.libmedia.destroy) {
        window.libmedia.destroy();
    }
}

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

        // Проверяем что CheerpJ загружен
        if (typeof cheerpjInit === 'undefined' && typeof window.cheerpjInit === 'undefined') {
            throw new Error('CheerpJ не загружен. Проверьте соединение с интернетом и попробуйте обновить страницу.');
        }
        
        // Используем window.cheerpjInit если cheerpjInit недоступен
        const cheerpjInitFunc = typeof cheerpjInit !== 'undefined' ? cheerpjInit : window.cheerpjInit;

        await cheerpjInitFunc({
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

    console.log("CheerpJ runtime ready");

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
                
                // Для существующих приложений только проверяем настройки, но НЕ создаем дефолтные
                const settingsPath = `/files/${appId}/config/settings.conf`;
                try {
                    const settingsBlob = await cjFileBlob(settingsPath);
                    if (settingsBlob) {
                        const settingsContent = await settingsBlob.text();
                        if (settingsContent.trim()) {
                            // Проверяем на наличие неправильных fontSize значений (строки вместо чисел)
                            if (settingsContent.includes('fontSize:medium') || settingsContent.includes('fontSize:small') || settingsContent.includes('fontSize:large')) {
                                console.log("Main: Найдены старые настройки с текстовыми fontSize, пересоздаем...");
                                // Удаляем старые настройки
                                const settingsFilePath = await Paths.get(settingsPath);
                                await Files.deleteIfExists(settingsFilePath);
                                // Создаем новые
                                await saveDefaultSettings(appId, lib, LauncherUtil);
                            } else {
                                console.log("Main: Найдены корректные настройки для существующего приложения");
                            }
                        } else {
                            console.log("Main: Настройки пустые, но приложение существует - пропускаем создание дефолтных");
                        }
                    } else {
                        console.log("Main: Файл настроек не найден, но приложение существует - пропускаем создание дефолтных");
                    }
                } catch (error) {
                    console.log("Main: Ошибка проверки настроек существующего приложения:", error.message);
                }
                
                initSuccess = true;
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
                
                // Если инициализация не удалась, пытаемся вручную скопировать файл
                if (!initSuccess) {
                    console.log("Main: Инициализация не удалась, пытаемся скопировать файл вручную...");
                    try {
                        // Сначала проверяем загруженную игру из localStorage
                        const uploadedGames = JSON.parse(localStorage.getItem('uploadedGames') || '[]');
                        const uploadedGame = uploadedGames.find(game => game.filename === jarName);
                        
                        let jarData;
                        
                        if (uploadedGame && uploadedGame.data) {
                            console.log(`Main: Найдена загруженная игра ${jarName} в localStorage`);
                            // Декодируем base64 данные
                            const base64 = uploadedGame.data;
                            const binary = atob(base64);
                            jarData = new ArrayBuffer(binary.length);
                            const uint8Array = new Uint8Array(jarData);
                            for (let i = 0; i < binary.length; i++) {
                                uint8Array[i] = binary.charCodeAt(i);
                            }
                            console.log(`Main: Декодировано ${jarData.byteLength} байт из localStorage`);
                        } else {
                            // Загружаем JAR файл через fetch
                            console.log(`Main: Загружаем ${jarName} через fetch...`);
                            const response = await fetch("./games/" + jarName);
                            if (!response.ok) {
                                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                            }
                            jarData = await response.arrayBuffer();
                            console.log(`Main: Загружено ${jarData.byteLength} байт`);
                        }
                        
                        // Создаем директории
                        await Files.createDirectories(appDirPath);
                        console.log(`Main: Создана директория ${appDir}`);
                        
                        // Записываем файл через CheerpJ API
                        const uint8Array = new Uint8Array(jarData);
                        const targetPath = "/str/" + appId + "_app.jar";
                        await cheerpOSAddStringFile(targetPath, uint8Array);
                        console.log(`Main: Файл записан в ${targetPath}`);
                        
                        // Копируем из /str/ в /files/
                        const sourcePath = await Paths.get(targetPath);
                        await Files.copy(sourcePath, appJarFilePath);
                        console.log(`Main: Файл скопирован в ${appJarPath}`);
                        
                        // Проверяем финальный файл
                        const exists = await Files.exists(appJarFilePath);
                        if (exists) {
                            const size = await Files.size(appJarFilePath);
                            console.log(`Main: Финальный файл создан, размер: ${size} байт`);
                            initSuccess = true;
                        } else {
                            throw new Error("Финальный файл не создался");
                        }
                        
                    } catch (copyError) {
                        console.error("Main: Ошибка копирования файла:", copyError.message);
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
            
            // Используем app режим
            args = ['app', appId];
            
        } catch (error) {
            console.error("Main: Ошибка LauncherUtil, fallback to jar:", error);
            // Fallback to jar режим
            args = ['jar', "/app/jar/" + jarName];
        }
    }

    console.log("Main: Запускаем FreeJ2ME с аргументами:", args);
    
    try {
        await FreeJ2ME.main(args);
        console.log("Main: FreeJ2ME запущен успешно");
    } catch (e) {
        console.error("Main: Краш FreeJ2ME:", e);
        document.getElementById("loading").textContent = "Failed to start: " + e.toString();
        throw e;
    }

    } catch (e) {
        console.error("Main: Краш init:", e);
        document.getElementById("loading").textContent = "Failed to init: " + e.toString();
        throw e;
    }
}

async function loadSettingsFromConfig(appId, lib) {
    console.log(`Main: Загружаем настройки для ${appId} из конфига...`);
    
    try {
        const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
        const HashMap = await lib.java.util.HashMap;
        
        // Проверяем существует ли файл настроек
        const settingsPath = `/files/${appId}/config/settings.conf`;
        try {
            const settingsBlob = await cjFileBlob(settingsPath);
            if (settingsBlob) {
                const settingsContent = await settingsBlob.text();
                console.log(`Main: Настройки из файла: ${settingsContent}`);
                
                if (settingsContent.trim()) {
                    console.log("Main: Настройки загружены из файла");
                    return;
                }
            }
        } catch (e) {
            console.log("Main: Файл настроек не найден, создаем дефолтные");
        }
        
        // Если настроек нет, создаем дефолтные
        await saveDefaultSettings(appId, lib, LauncherUtil);
        
    } catch (error) {
        console.error("Main: Ошибка загрузки настроек:", error);
    }
}

async function saveDefaultSettings(appId, libOrLauncherUtil, LauncherUtil) {
    console.log(`Main: Создаем дефолтные настройки для ${appId}...`);
    
    try {
        // Если передана библиотека напрямую, получаем LauncherUtil
        let launcherUtil = LauncherUtil;
        if (!launcherUtil) {
            launcherUtil = await libOrLauncherUtil.pl.zb3.freej2me.launcher.LauncherUtil;
        }
        
        const HashMap = await libOrLauncherUtil.java.util.HashMap || 
                       await launcherUtil.java.util.HashMap ||
                       await (async () => {
                           const lib = window.emulator || libOrLauncherUtil;
                           return await lib.java.util.HashMap;
                       })();
        
        const settings = await new HashMap();
        
        // Настройки эмуляции
        await settings.put("emulateKeyboard", "false");      // false для touch устройств
        await settings.put("emulatePointer", "false");       // false для мыши/touch
        await settings.put("virtualKeyboard", "false");      // виртуальная клавиатура
        await settings.put("rotateDisplay", "false");        // поворот дисплея
        await settings.put("limitFPS", "false");             // НЕ ограничиваем FPS для web (удалили fps настройку совсем)
        await settings.put("soundEnabled", "true");          // включаем звук
        
        // Настройки интерфейса - используем ЧИСЛА вместо строк 
        await settings.put("fontSize", "12");                // размер шрифта как число
        await settings.put("colorSystem", "Nokia");          // цветовая схема
        await settings.put("screenSize", "0");               // авто-размер экрана
        await settings.put("graphicsAPI", "standard");       // стандартный graphics API
        
        // Настройки платформы 
        await settings.put("phone", "Nokia");                // эмуляция Nokia
        await settings.put("manufacturer", "Nokia");         // производитель 
        await settings.put("model", "6280");                 // модель телефона
        await settings.put("locale", "en-US");               // локаль
        
        // Сохраняем настройки - используем статический метод класса
        const LauncherUtilClass = launcherUtil.constructor || launcherUtil;
        await LauncherUtilClass.saveSettings(appId, settings);
        console.log("Main: Дефолтные настройки сохранены");
        
        // Логируем что именно сохранили
        console.log("Main: Сохраненные настройки:");
        const settingsEntries = await settings.entrySet();
        const iterator = await settingsEntries.iterator();
        while (await iterator.hasNext()) {
            const entry = await iterator.next();
            const key = await entry.getKey();
            const value = await entry.getValue();
            console.log(`  ${key}: ${value}`);
        }
        
    } catch (error) {
        console.error("Main: Ошибка создания дефолтных настроек:", error);
    }
}

async function saveUpdatedSettings(appId, settingsMap) {
    console.log(`Main: Обновляем настройки для ${appId}...`);
    
    try {
        const lib = window.emulator;
        if (!lib) {
            throw new Error("Эмулятор не инициализирован");
        }
        
        const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
        const HashMap = await lib.java.util.HashMap;
        
        const settings = await new HashMap();
        
        // Переносим настройки из JS объекта в Java HashMap
        for (const [key, value] of Object.entries(settingsMap)) {
            await settings.put(key, String(value));
        }
        
        // Сохраняем настройки
        await LauncherUtil.saveSettings(appId, settings);
        console.log("Main: Настройки обновлены и сохранены");
        
        // Логируем что именно сохранили
        console.log("Main: Обновленные настройки:");
        for (const [key, value] of Object.entries(settingsMap)) {
            console.log(`  ${key}: ${value}`);
        }
        
    } catch (error) {
        console.error("Main: Ошибка обновления настроек:", error);
    }
}

// Автоматически вызываем init при загрузке модуля
console.log("🚀 Main: Модуль загружен, начинаем инициализацию...");
init().catch(error => {
    console.error("❌ Main: Критическая ошибка инициализации:", error);
});

export { init, saveUpdatedSettings };