// note that we can only call java stuff if thread not running..
const cheerpjWebRoot = '.';

const emptyIcon = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

let lib = null, launcherUtil = null;
let state = {
    games: [],
    currentGame: null,
    uploadedJars: 0,
};
let defaultSettings = {};

// ===== Snowflake-style ID generator =====
const snowflake = { lastTs: 0, seq: 0 };

function generateSnowflakeId(machineId = 0) {
    const ts = Date.now(); // миллисекунды с эпохи, 41 бит хватает до 2081 года

    if (ts === snowflake.lastTs) {
        snowflake.seq = (snowflake.seq + 1) & 0xFFF; // 12-битный счётчик
        if (snowflake.seq === 0) {
            // переполнение счётчика – ждём следующей миллисекунды
            while (Date.now() === ts) {/* spin */}
        }
    } else {
        snowflake.seq = 0;
        snowflake.lastTs = ts;
    }

    const mid = machineId & 0x3FF; // 10 бит

    // Склеиваем поля вручную, нам не нужен BigInt
    const idStr = `${ts.toString(36)}-${mid.toString(36)}-${snowflake.seq.toString(36)}`;
    return idStr;
}

async function main() {
    try {
        console.log("Launcher: Начинаем инициализацию...");
        document.getElementById("loading").textContent = "Загрузка CheerpJ...";
        
        console.log("Launcher: Инициализируем CheerpJ...");
        await cheerpjInit({
            enableDebug: false
        });

        console.log("Launcher: Загружаем JAR библиотеку...");
        lib = await cheerpjRunLibrary(cheerpjWebRoot+"/freej2me-web.jar");

        document.getElementById("loading").textContent = "Загрузка...";

        console.log("Launcher: Получаем LauncherUtil...");
        launcherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;

        console.log("Launcher: Сбрасываем временную директорию...");
        await launcherUtil.resetTmpDir();

        console.log("Launcher: Загружаем настройки по умолчанию...");
        const Config = await lib.org.recompile.freej2me.Config;
            await javaToKv(Config.DEFAULT_SETTINGS, defaultSettings);
    console.log("Launcher: Настройки по умолчанию из Java:", defaultSettings);
    console.log("Launcher: fontSize из Java:", JSON.stringify(defaultSettings.fontSize));
    console.log("Launcher: dgFormat из Java:", JSON.stringify(defaultSettings.dgFormat));
    console.log("Launcher: phone из Java:", JSON.stringify(defaultSettings.phone));
    
    // Принудительно устанавливаем безопасные значения по умолчанию
    if (!defaultSettings.fontSize || defaultSettings.fontSize === "" || defaultSettings.fontSize === "0") {
        defaultSettings.fontSize = "medium";
        console.log("Launcher: Исправляем недопустимый fontSize на medium");
    }
    if (!defaultSettings.dgFormat || defaultSettings.dgFormat === "") {
        defaultSettings.dgFormat = "16bit";
        console.log("Launcher: Исправляем пустой dgFormat на 16bit");
    }
    if (!defaultSettings.phone || defaultSettings.phone === "" || defaultSettings.phone === "Nokia") {
        defaultSettings.phone = "standard";
        console.log("Launcher: Исправляем недопустимый phone на standard");
    }
    if (!defaultSettings.width || defaultSettings.width === "") {
        defaultSettings.width = "240";
        console.log("Launcher: Исправляем пустой width на 240");
    }
    if (!defaultSettings.height || defaultSettings.height === "") {
        defaultSettings.height = "320";
        console.log("Launcher: Исправляем пустой height на 320");
    }
    
    console.log("Launcher: Финальные настройки по умолчанию:", defaultSettings);
    console.log("Launcher: Финальный fontSize:", JSON.stringify(defaultSettings.fontSize));
    console.log("Launcher: Финальный dgFormat:", JSON.stringify(defaultSettings.dgFormat));
    console.log("Launcher: Финальный phone:", JSON.stringify(defaultSettings.phone));

        console.log("Launcher: Перезагружаем UI...");
        await reloadUI();

        console.log("Launcher: Инициализация завершена успешно");
        document.getElementById("loading").style.display = "none";
        document.getElementById("main").style.display = "";
    } catch (error) {
        console.error("Launcher: Ошибка инициализации:", error);
        document.getElementById("loading").textContent = "Ошибка загрузки: " + error.message;
    }
}

async function maybeReadCheerpJFileText(path) {
    const blob = await cjFileBlob(path);
    if (blob) {
        return await blob.text();
    }
}

async function getDataUrlFromBlob(blob) {
    const reader = new FileReader();

    const promise = new Promise((r) => {
        reader.onload = function () {
            r(reader.result);
        };
    });

    reader.readAsDataURL(blob);
    return await promise;
}

function readToKv(txt, kv) {
    for (const line of txt.trim().split("\n")) {
        const parts = line.split(/\s*:\s*/);
        if (parts.length == 2) {
            kv[parts[0]] = parts[1];
        }
    }
}

async function javaToKv(hashMap, kv) {
    const es = await hashMap.entrySet();
    const esi = await es.iterator();

    while (await esi.hasNext()) {
        const entry = await esi.next();
        const key = await entry.getKey();
        const value = await entry.getValue();

        kv[key] = value;
    }
}

async function kvToJava(kv) {
    console.log("kvToJava: Входные данные:", JSON.stringify(kv, null, 2));
    const HashMap = await lib.java.util.HashMap;
    const ret = await new HashMap();

    for (const k of Object.keys(kv)) {
        const value = String(kv[k]); // Принудительно конвертируем в строку
        console.log(`kvToJava: Добавляем ${k} = ${value} (оригинал: ${kv[k]}, тип: ${typeof kv[k]})`);
        await ret.put(k, value);
    }

    return ret;
}

async function loadGames() {
    const apps = [];

    let installedAppsBlob = await cjFileBlob("/files/apps.list");
    if (!installedAppsBlob) {
        const res = await fetch("init.zip");
        const ab = await res.arrayBuffer();
        await launcherUtil.importData(new Int8Array(ab));

        installedAppsBlob = await cjFileBlob("/files/apps.list");
    }

    if (installedAppsBlob) {
        const installedIds = (await installedAppsBlob.text()).trim().split("\n").filter(id => id.trim());

        for (const appId of installedIds) {
            const napp = {
                appId,
                name: appId,
                icon: emptyIcon,
                settings: { ...defaultSettings },
                appProperties: {},
                systemProperties: {},
            };

            const name = await maybeReadCheerpJFileText("/files/" + appId + "/name");
            if (name) napp.name = name;

            const iconBlob = await cjFileBlob("/files/" + appId + "/icon");
            if (iconBlob) {
                const dataUrl = await getDataUrlFromBlob(iconBlob);
                if (dataUrl) {
                    napp.icon = dataUrl;
                }
            }

            for (const [fname, keyName] of [
                ["/files/" + appId + "/config/settings.conf", "settings"],
                ["/files/" + appId + "/config/appproperties.conf", "appProperties"],
                ["/files/" + appId + "/config/systemproperties.conf", "systemProperties"],
            ]) {
                const content = await maybeReadCheerpJFileText(fname);
                if (content) {
                    readToKv(content, napp[keyName]);
                }
            }

            // Исправляем проблемные настройки существующих игр
            let needsFixing = false;
            if (!napp.settings.fontSize || napp.settings.fontSize === "" || napp.settings.fontSize === "0") {
                console.log(`Launcher: Исправляем fontSize для игры ${appId}: ${napp.settings.fontSize} -> medium`);
                napp.settings.fontSize = "medium";
                needsFixing = true;
            }
            if (!napp.settings.phone || napp.settings.phone === "" || napp.settings.phone === "Nokia") {
                console.log(`Launcher: Исправляем phone для игры ${appId}: ${napp.settings.phone} -> standard`);
                napp.settings.phone = "standard";
                needsFixing = true;
            }
            if (!napp.settings.dgFormat || napp.settings.dgFormat === "") {
                console.log(`Launcher: Исправляем dgFormat для игры ${appId}: ${napp.settings.dgFormat} -> 16bit`);
                napp.settings.dgFormat = "16bit";
                needsFixing = true;
            }
            if (!napp.settings.width || napp.settings.width === "") {
                console.log(`Launcher: Исправляем width для игры ${appId}: ${napp.settings.width} -> 240`);
                napp.settings.width = "240";
                needsFixing = true;
            }
            if (!napp.settings.height || napp.settings.height === "") {
                console.log(`Launcher: Исправляем height для игры ${appId}: ${napp.settings.height} -> 320`);
                napp.settings.height = "320";
                needsFixing = true;
            }

            // Если настройки исправлены, сохраняем их на диск
            if (needsFixing) {
                console.log(`Launcher: Сохраняем исправленные настройки для игры ${appId}...`);
                try {
                    const jsettings = await kvToJava(napp.settings);
                    const jappProps = await kvToJava(napp.appProperties);
                    const jsysProps = await kvToJava(napp.systemProperties);
                    await launcherUtil.saveApp(appId, jsettings, jappProps, jsysProps);
                    console.log(`Launcher: Настройки игры ${appId} успешно исправлены и сохранены`);
                } catch (error) {
                    console.error(`Launcher: Ошибка при сохранении настроек игры ${appId}:`, error);
                }
            }

            apps.push(napp);
        }
    }

    return apps;
}

function fillGamesList(games) {
    const container = document.getElementById("game-list");
    container.innerHTML = "";

    if (games.length === 0) {
        container.style.display = "none";
        return;
    } else {
        container.style.display = "";
    }

    for (const game of games) {
        const item = document.createElement("div");
        item.className = "game-item";

        const link = document.createElement("a");
        
        // Формируем URL только с appId - настройки берем из конфига
        const buildGameUrl = (mobile = false) => {
            let url = `run?app=${game.appId}`;
            if (mobile) {
                url += "&mobile=1";
            }
            return url;
        };
        
        link.href = buildGameUrl();
        link.className = "game-link";
        link.addEventListener('pointerdown', e => {
            if (e.pointerType === 'touch') {
                link.href = buildGameUrl(true);
            }
        });

        const icon = document.createElement("div");
        icon.className = "game-icon";
        
        if (game.icon && game.icon !== emptyIcon) {
            const img = document.createElement("img");
            img.src = game.icon;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            img.style.borderRadius = "12px";
            icon.appendChild(img);
        } else {
            icon.textContent = game.name.charAt(0).toUpperCase();
        }
        
        link.appendChild(icon);

        const info = document.createElement("div");
        info.className = "game-info";
        
        const title = document.createElement("div");
        title.className = "game-title";
        title.textContent = game.name;
        info.appendChild(title);
        
        const subtitle = document.createElement("div");
        subtitle.className = "game-subtitle";
        subtitle.textContent = "J2ME игра";
        info.appendChild(subtitle);
        
        link.appendChild(info);
        item.appendChild(link);

        container.appendChild(item);
    }
}


async function processGameFile(fileBuffer, fileName) {
    const MIDletLoader = await lib.org.recompile.mobile.MIDletLoader;
    const File = await lib.java.io.File;

    const jarFile = await new File(
        "/files/_tmp/" + state.uploadedJars++ + ".jar"
    );

    await launcherUtil.copyJar(new Int8Array(fileBuffer), jarFile);
    state.currentGame.jarFile = jarFile;

    const AnalyserUtil = await lib.pl.zb3.freej2me.launcher.AnalyserUtil;
    const analysisResult = await AnalyserUtil.analyseFile(jarFile, fileName);
    fillGuessedSettings(analysisResult, state.currentGame);

    if (state.lastLoader) {
        await state.lastLoader.close();
    }
    const loader = await MIDletLoader.getMIDletLoader(jarFile);
    state.lastLoader = loader;

    // Если у loader нет appId, генерируем на основе имени файла
    if (!(await loader.getAppId())) {
        const genId = generateSnowflakeId(state.currentGame.jarSize);
        if (typeof loader.setAppId === 'function') {
            await loader.setAppId(genId);
        } else {
            loader.appId = genId;
        }
    }

    setupNewGameManage(loader);
}

function fillGuessedSettings(analysisResult, app) {
    if (analysisResult.screenWidth !== -1) {
        app.settings.width = analysisResult.screenWidth + '';
        app.settings.height = analysisResult.screenHeight + '';
    }

    if (analysisResult.phoneType) {
        app.settings.phone = analysisResult.phoneType;
    }
}

async function setupNewGameManage(loader) {
    state.currentGame.appId = await loader.getAppId();
    state.currentGame.name = loader.name || state.currentGame.appId;
    const iconBytes = await loader.getIconBytes();
    state.currentGame.icon = iconBytes
        ? await getDataUrlFromBlob(new Blob([iconBytes]))
        : emptyIcon;

    await javaToKv(loader.properties, state.currentGame.appProperties);
}

async function doAddSaveGame() {
    try {
        console.log("Launcher: Начинаем сохранение игры...");
        document.getElementById("add-save-button").disabled = true;

        console.log("Launcher: Читаем настройки из UI...");
        readUI(state.currentGame);
        console.log("Launcher: Настройки игры:", state.currentGame.settings);

        console.log("Launcher: Конвертируем настройки в Java объекты...");
        console.log("Launcher: Финальные настройки перед конвертацией:", JSON.stringify(state.currentGame.settings, null, 2));
        const jsettings = await kvToJava(state.currentGame.settings);
        const jappProps = await kvToJava(state.currentGame.appProperties);
        const jsysProps = await kvToJava(state.currentGame.systemProperties);

        if (state.currentGame.jarFile) {
            console.log("Launcher: Инициализируем новую игру...");
            // генерируем snowflake-id
            const newAppId = generateSnowflakeId(state.currentGame.jarSize);

            if (typeof state.lastLoader.setAppId === 'function') {
                await state.lastLoader.setAppId(newAppId);
            } else {
                state.lastLoader.appId = newAppId;
            }

            state.currentGame.appId = newAppId;

            await launcherUtil.initApp(
                state.currentGame.jarFile,
                state.lastLoader, // loader with final уникальным appId
                jsettings,
                jappProps,
                jsysProps
            );
            console.log("Launcher: Новая игра успешно добавлена");
        } else {
            console.log("Launcher: Сохраняем существующую игру...");
            await launcherUtil.saveApp(
                state.currentGame.appId,
                jsettings,
                jappProps,
                jsysProps
            );
            console.log("Launcher: Игра успешно сохранена");
        }

        console.log("Launcher: Перезагружаем UI...");
        reloadUI();
    } catch (error) {
        console.error("Launcher: Ошибка при сохранении игры:", error);
        document.getElementById("add-save-button").disabled = false;
        alert("Ошибка при сохранении игры: " + error.message);
    }
}

function readUI(targetGameObj) {
    try {
        console.log("Launcher: Читаем тип телефона...");
        const phoneTypeElement = document.getElementById("phoneType");
        if (!phoneTypeElement) {
            throw new Error("Элемент phoneType не найден");
        }
        targetGameObj.settings.phone = phoneTypeElement.value || "standard";
        console.log("Launcher: Тип телефона:", targetGameObj.settings.phone);

        console.log("Launcher: Читаем размер экрана...");
        const screenSizeElement = document.getElementById("screenSize");
        if (!screenSizeElement) {
            throw new Error("Элемент screenSize не найден");
        }
        const screenSize = screenSizeElement.value;
        
        if (screenSize === "custom") {
            const customWidthElement = document.getElementById("customWidth");
            const customHeightElement = document.getElementById("customHeight");
            if (!customWidthElement || !customHeightElement) {
                throw new Error("Элементы customWidth или customHeight не найдены");
            }
            targetGameObj.settings.width = customWidthElement.value || "240";
            targetGameObj.settings.height = customHeightElement.value || "320";
        } else {
            const [width, height] = screenSize.split("x");
            targetGameObj.settings.width = width || "240";
            targetGameObj.settings.height = height || "320";
        }
        console.log("Launcher: Размер экрана:", `${targetGameObj.settings.width}x${targetGameObj.settings.height}`);

        console.log("Launcher: Читаем настройки шрифта и графики...");
        const fontSizeElement = document.getElementById("fontSize");
        const dgFormatElement = document.getElementById("dgFormat");
        if (!fontSizeElement || !dgFormatElement) {
            throw new Error("Элементы fontSize или dgFormat не найдены");
        }
        targetGameObj.settings.fontSize = fontSizeElement.value || "medium";
        targetGameObj.settings.dgFormat = dgFormatElement.value || "16bit";
        
        console.log("Launcher: Значения fontSize и dgFormat:", {
            fontSizeValue: fontSizeElement.value,
            fontSizeSet: targetGameObj.settings.fontSize,
            dgFormatValue: dgFormatElement.value,
            dgFormatSet: targetGameObj.settings.dgFormat
        });

        console.log("Launcher: Читаем checkbox настройки...");
        const soundCheckbox = document.querySelector('input[name="enableSound"]');
        const rotateCheckbox = document.querySelector('input[name="rotate"]');
        const fullscreenCheckbox = document.querySelector('input[name="forceFullscreen"]');
        const textureFilterCheckbox = document.querySelector('input[name="textureDisableFilter"]');
        const queuedPaintCheckbox = document.querySelector('input[name="queuedPaint"]');
        
        console.log("Launcher: Найденные элементы:", {
            soundCheckbox: !!soundCheckbox,
            rotateCheckbox: !!rotateCheckbox,
            fullscreenCheckbox: !!fullscreenCheckbox,
            textureFilterCheckbox: !!textureFilterCheckbox,
            queuedPaintCheckbox: !!queuedPaintCheckbox
        });

        targetGameObj.settings.sound = soundCheckbox ? (soundCheckbox.checked ? "on" : "off") : "on";
        targetGameObj.settings.rotate = rotateCheckbox ? (rotateCheckbox.checked ? "on" : "off") : "off";
        targetGameObj.settings.forceFullscreen = fullscreenCheckbox ? (fullscreenCheckbox.checked ? "on" : "off") : "off";
        targetGameObj.settings.textureDisableFilter = textureFilterCheckbox ? (textureFilterCheckbox.checked ? "on" : "off") : "off";
        targetGameObj.settings.queuedPaint = queuedPaintCheckbox ? (queuedPaintCheckbox.checked ? "on" : "off") : "off";

        console.log("Launcher: Читаем свойства приложения и системы...");
        const appPropsElement = document.getElementById("editAppProps");
        const sysPropsElement = document.getElementById("editSysProps");
        if (!appPropsElement || !sysPropsElement) {
            throw new Error("Элементы editAppProps или editSysProps не найдены");
        }

        readToKv(appPropsElement.value, targetGameObj.appProperties);
        readToKv(sysPropsElement.value, targetGameObj.systemProperties);
        
        console.log("Launcher: Чтение UI завершено успешно");
    } catch (error) {
        console.error("Launcher: Ошибка при чтении UI:", error);
        throw error;
    }
}

async function reloadUI() {
    state.currentGame = null;

    state.games = await loadGames();
    fillGamesList(state.games);
 
}

main();
