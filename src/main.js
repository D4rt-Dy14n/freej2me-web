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

    // Очищаем кэш FreeJ2ME для свежего запуска
    try {
        console.log("Main: Очищаем кэш браузера...");
        
        // Очищаем sessionStorage
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

        // Очищаем localStorage
        try {
            const localKeysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('cheerpj') || key.includes('CheerpJ') || key.includes('freej2me'))) {
                    localKeysToRemove.push(key);
                }
            }
            localKeysToRemove.forEach(key => {
                localStorage.removeItem(key);
                console.log(`Main: Удален localStorage ключ: ${key}`);
            });
        } catch (e) {
            console.log("Main: Ошибка при очистке localStorage:", e.message);
        }

        // Очищаем IndexedDB (CheerpJ виртуальная файловая система)
        try {
            const databases = await indexedDB.databases();
            for (const db of databases) {
                if (db.name && (db.name.includes('cheerpj') || db.name.includes('CheerpJ') || db.name.includes('/CheerpJ'))) {
                    console.log(`Main: Удаляем базу данных: ${db.name}`);
                    const deleteReq = indexedDB.deleteDatabase(db.name);
                    await new Promise((resolve, reject) => {
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => reject(deleteReq.error);
                        deleteReq.onblocked = () => {
                            console.log(`Main: База данных ${db.name} заблокирована, принудительно удаляем...`);
                            setTimeout(resolve, 1000);
                        };
                    });
                }
            }
        } catch (e) {
            console.log("Main: Ошибка при очистке IndexedDB:", e.message);
        }

        // Дополнительная очистка - удаляем временные папки игр
        try {
            console.log("Main: Удаляем временные файлы игр...");
            const databases = await indexedDB.databases();
            for (const db of databases) {
                if (db.name && db.name.includes('files')) {
                    console.log(`Main: Удаляем файловую базу: ${db.name}`);
                    const deleteReq = indexedDB.deleteDatabase(db.name);
                    await new Promise((resolve, reject) => {
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => reject(deleteReq.error);
                        deleteReq.onblocked = () => setTimeout(resolve, 1000);
                    });
                }
            }
        } catch (e) {
            console.log("Main: Ошибка при очистке файловых баз:", e.message);
        }
        
        console.log("Main: Браузерное хранилище очищено");
        
    } catch (error) {
        console.error("Main: Ошибка при очистке хранилища:", error);
    }

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;

    let args;

    if (sp.get('app')) {
        args = ['app', sp.get('app')];
    } else {
        // Используем LauncherUtil для инициализации JAR как приложения
        const jarName = sp.get('jar') || "game.jar";
        const isUploaded = sp.get('uploaded') === 'true';
        const appId = jarName.replace('.jar', '');
        
        console.log(`Main: Инициализируем JAR ${jarName} как app ${appId} через LauncherUtil...`);
        
        try {
            const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
            const HashMap = await lib.java.util.HashMap;
            
            // Пытаемся инициализировать приложение с разными путями
            let initSuccess = false;
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
            
            if (!initSuccess) {
                console.log("Main: Не удалось инициализировать ни с одним из путей");
                
                // Попробуем загрузить файл через cheerpJDataFS
                try {
                    console.log("Main: Загружаем JAR файл...");
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
                    
                    // Теперь копируем в нужную директорию через Java File API
                    try {
                        const Files = await lib.java.nio.file.Files;
                        const Paths = await lib.java.nio.file.Paths;
                        
                        // Создаем target директорию
                        const finalTargetDir = "/files/" + appId;
                        const finalTargetPath = finalTargetDir + "/app.jar";
                        
                        const targetDirPath = await Paths.get(finalTargetDir);
                        await Files.createDirectories(targetDirPath);
                        console.log(`Main: Создана финальная директория ${finalTargetDir}`);
                        
                        // Копируем из /str/ в /files/
                        const sourcePath = await Paths.get(targetPath);
                        const finalTargetFilePath = await Paths.get(finalTargetPath);
                        await Files.copy(sourcePath, finalTargetFilePath);
                        console.log(`Main: Файл скопирован из ${targetPath} в ${finalTargetPath}`);
                        
                        // Проверяем финальный файл
                        const exists = await Files.exists(finalTargetFilePath);
                        if (exists) {
                            const size = await Files.size(finalTargetFilePath);
                            console.log(`Main: Финальный файл существует, размер: ${size} байт`);
                        } else {
                            throw new Error("Финальный файл не создался");
                        }
                    } catch (copyError) {
                        console.log(`Main: Ошибка копирования файла: ${copyError.message}`);
                        throw copyError;
                    }
                    
                } catch (copyError) {
                    console.log("Main: Ошибка загрузки/записи файла:", copyError.message || copyError);
                }
            }
            
            // Создаем корректные настройки
            const correctSettings = await new HashMap();
            await correctSettings.put("fontSize", "medium");
            await correctSettings.put("phone", "standard");
            await correctSettings.put("dgFormat", "4444");
            await correctSettings.put("width", 240);
            await correctSettings.put("height", 320);
            await correctSettings.put("sound", "on");
            await correctSettings.put("rotate", "off");
            await correctSettings.put("forceFullscreen", "off");
            await correctSettings.put("textureDisableFilter", "off");
            await correctSettings.put("queuedPaint", "off");
            
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