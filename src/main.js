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
            let useJarMode = false;
            
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
                // Приложение не существует – сразу переходим к ручной копии JAR в /files/
                {
                    console.log("Main: Инициализация не удалась, копируем JAR напрямую в /files...");
                    try {
                        // Проверяем загруженную игру из localStorage
                        const uploadedGames = JSON.parse(localStorage.getItem('uploadedGames') || '[]');
                        const uploadedGame = uploadedGames.find(game => game.filename === jarName);

                        let jarData;
                        if (uploadedGame && uploadedGame.data) {
                            console.log(`Main: Найдена загруженная игра ${jarName} в localStorage`);
                            const base64 = uploadedGame.data;
                            const binary = atob(base64);
                            jarData = new ArrayBuffer(binary.length);
                            const uint8ArrayTmp = new Uint8Array(jarData);
                            for (let i = 0; i < binary.length; i++) {
                                uint8ArrayTmp[i] = binary.charCodeAt(i);
                            }
                            console.log(`Main: Декодировано ${jarData.byteLength} байт из localStorage`);
                        } else {
                            console.log(`Main: Загружаем ${jarName} через fetch...`);
                            const resp = await fetch("./games/" + jarName);
                            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                            jarData = await resp.arrayBuffer();
                            console.log(`Main: Загружено ${jarData.byteLength} байт`);
                        }

                        // Убеждаемся, что каталог /files существует
                        try { await Files.createDirectories(await Paths.get('/files')); } catch(e) {}

                        const targetPath = "/files/" + jarName;
                        await cheerpOSAddStringFile(targetPath, new Uint8Array(jarData));
                        console.log(`Main: Файл записан в ${targetPath}`);

                        // Проверяем
                        const targetFilePath = await Paths.get(targetPath);
                        if (await Files.exists(targetFilePath)) {
                            const size = await Files.size(targetFilePath);
                            console.log(`Main: ✓ файл сохранён (${size} байт)`);
                            initSuccess = true;
                            useJarMode = true;
                        } else {
                            throw new Error("Финальный файл не создался");
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
            
            // Выбор режима запуска после всех операций
            if (useJarMode) {
                args = ['jar', '/files/' + jarName];
            } else {
                args = ['app', appId];
            }
            
        } catch (error) {
            console.error("Main: Ошибка LauncherUtil, fallback to jar:", error);
            // Fallback to jar режим
            args = ['jar', "./games/" + jarName];
        }
    }

    console.log("Main: Запускаем FreeJ2ME с аргументами:", args);
    
    try {
        await FreeJ2ME.main(args);
        console.log("Main: FreeJ2ME запущен успешно");
    } catch (e) {
        console.error("Main: Краш FreeJ2ME:", e);
        if (e.printStackTrace) {
            e.printStackTrace();
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

init();