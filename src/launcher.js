// note that we can only call java stuff if thread not running..
const cheerpjWebRoot = '.';

const emptyIcon = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

let lib = null, launcherUtil = null;
let state = {
    games: [],
    currentGame: null,
    editedGameId: null,
    uploadedJars: 0,
};
let defaultSettings = {};

// Проверяем, существует ли путь /files/<appId>
async function doesAppExist(appId) {
    // Проверяем наличие файла app.jar внутри директории приложения
    return (await cjFileBlob(`/files/${appId}/app.jar`)) !== null;
}

// Генерирует уникальный appId, добавляя суффикс _1, _2, ...
async function makeUniqueAppId(loader) {
    let baseId = await loader.getAppId();

    // если appId ещё не задан – формируем базовый идентификатор
    if (!baseId) {
        baseId = `app_${Date.now()}`; // гарантированно уникально по времени
    }

    let uniqueId = baseId;
    let counter = 1;
    while (await doesAppExist(uniqueId)) {
        uniqueId = `${baseId}_${counter++}`;
    }

    if (uniqueId !== baseId) {
        await loader.setAppId(uniqueId);
    }

    return uniqueId;
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

        const manageButton = document.createElement("button");
        manageButton.className = "manage-btn";
        manageButton.textContent = "Управление";
        manageButton.onclick = () => openEditGame(game);
        item.appendChild(manageButton);

        container.appendChild(item);
    }
}

function setupAddMode() {
    if (!confirmDiscard()) {
        return;
    }
    state.currentGame = {
        icon: emptyIcon,
        settings: { ...defaultSettings },
        appProperties: {},
        systemProperties: {},
    };

    document.getElementById("add-edit-text").textContent = "➕ Добавить новую игру";

    document.getElementById("file-input-step").style.display = "";
    document.getElementById("file-input-loading").style.display = "none";
    document.getElementById("file-input-jad-step").style.display = "none";
    document.getElementById("add-manage-step").style.display = "none";

    document.getElementById("game-file-input").disabled = false;
    document.getElementById("game-file-input").value = null;

    document.getElementById("game-file-input").onchange = (e) => {
        // read file to arraybuffer
        const file = e.target.files[0];
        if (file) {
            document.getElementById("game-file-input").disabled = true;
            document.getElementById("file-input-step").style.display = "none";
            document.getElementById("file-input-loading").style.display = "";

            const reader = new FileReader();
            reader.onload = async () => {
                const arrayBuffer = reader.result;
                await processGameFile(arrayBuffer, file.name);
            };
            reader.readAsArrayBuffer(file);
        }
    };
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

    if (!(await loader.getAppId())) {
        document.getElementById("file-input-step").style.display = "";
        document.getElementById("file-input-loading").style.display = "none";
        document.getElementById("file-input-jad-step").style.display = "";
        document.getElementById("upload-descriptor-file-input").value = null;

        document.getElementById("upload-descriptor-file-input").onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                document.getElementById("file-input-step").style.display = "none";
                document.getElementById("file-input-jad-step").style.display = "none";
                document.getElementById("file-input-loading").style.display = "";

                const reader = new FileReader();
                reader.onload = async () => {
                    const arrayBuffer = reader.result;
                    await launcherUtil.augementLoaderWithJAD(
                        loader,
                        new Int8Array(arrayBuffer)
                    );

                    if (await loader.getAppId()) {
                        setupNewGameManage(loader);
                    }
                };
                reader.readAsArrayBuffer(file);
            }
        };

        document.getElementById('continue-without-jad').onclick = () => {
            continueWithoutJAD(loader, fileName);
        };
    } else {
        setupNewGameManage(loader);
    }
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

async function continueWithoutJAD(loader, origName) {
    // if we're here then need fallback name
    await launcherUtil.ensureAppId(loader, origName);
    loader.name = await loader.getAppId();

    setupNewGameManage(loader);
}

async function setupNewGameManage(loader) {
    state.currentGame.appId = await loader.getAppId();
    state.currentGame.name = loader.name || state.currentGame.appId;
    const iconBytes = await loader.getIconBytes();
    state.currentGame.icon = iconBytes
        ? await getDataUrlFromBlob(new Blob([iconBytes]))
        : emptyIcon;

    await javaToKv(loader.properties, state.currentGame.appProperties);

    // Здесь ещё рано вызывать initApp, делаем это позже при сохранении

    setupAddManageGame(state.currentGame, true);
}

async function setupAddManageGame(app, isAdding) {
    document.getElementById("file-input-step").style.display = "none";
    document.getElementById("file-input-jad-step").style.display = "none";
    document.getElementById("file-input-loading").style.display = "none";
    document.getElementById("add-manage-step").style.display = "";

    // Создаем динамический UI для управления игрой
    const manageStep = document.getElementById("add-manage-step");
    manageStep.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 30px; padding: 20px; background: white; border-radius: 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <img class="preview-icon" src="${app.icon || emptyIcon}" style="width: 64px; height: 64px; border-radius: 12px; margin-right: 20px; object-fit: cover;">
            <div>
                <div class="preview-name" style="font-size: 1.3em; font-weight: 600; margin-bottom: 5px;">${app.name}</div>
                <div style="color: #666;">J2ME игра</div>
            </div>
        </div>

        <div id="preview-controls" style="display: ${isAdding ? "none" : ""}; margin-bottom: 20px;">
            <button id="uninstall-btn" class="btn btn-outline" style="background: #dc3545; color: white; border-color: #dc3545; margin-right: 10px;">🗑️ Удалить игру</button>
            <button id="wipe-data-btn" class="btn btn-outline">🧹 Очистить данные</button>
        </div>

        <div style="background: linear-gradient(135deg, #f8f9ff 0%, #e8f4fd 100%); padding: 20px; border-radius: 15px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 20px 0; color: #333;">⚙️ Настройки игры</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Тип телефона:</label>
                <select id="phoneType" class="file-input">
                    <option value="standard">Стандартный</option>
                </select>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Размер экрана:</label>
                <select id="screenSize" class="file-input">
                    <option value="128x128">128x128</option>
                    <option value="128x160">128x160</option>
                    <option value="176x220">176x220</option>
                    <option value="240x320">240x320</option>
                    <option value="320x240">320x240</option>
                    <option value="custom">Пользовательский</option>
                </select>
            </div>

            <div id="edit-custom-size-inputs" style="display: none; margin-bottom: 15px;">
                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Ширина:</label>
                        <input type="number" id="customWidth" class="file-input" value="240">
                    </div>
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Высота:</label>
                        <input type="number" id="customHeight" class="file-input" value="320">
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Размер шрифта:</label>
                <select id="fontSize" class="file-input">
                    <option value="small">Маленький</option>
                    <option value="medium" selected>Средний</option>
                    <option value="large">Большой</option>
                </select>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Формат графики:</label>
                <select id="dgFormat" class="file-input">
                    <option value="16bit" selected>16-bit</option>
                    <option value="32bit">32-bit</option>
                </select>
            </div>

            <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 15px 0; color: #333;">Дополнительные опции:</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <label style="display: flex; align-items: center; gap: 8px; padding: 10px; background: white; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" name="enableSound" checked> Звук
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; padding: 10px; background: white; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" name="rotate"> Поворот экрана
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; padding: 10px; background: white; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" name="forceFullscreen"> Полный экран
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; padding: 10px; background: white; border-radius: 8px; cursor: pointer;">
                        <input type="checkbox" name="textureDisableFilter"> Без фильтра текстур
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; padding: 10px; background: white; border-radius: 8px; cursor: pointer; grid-column: span 2;">
                        <input type="checkbox" name="queuedPaint" checked> Оптимизация отрисовки
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Дополнительный JAD файл (опционально):</label>
                <input type="file" id="aux-jad-file-input" class="file-input" accept=".jad">
            </div>
        </div>

        <div style="background: white; padding: 20px; border-radius: 15px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; color: #333;">📋 Свойства приложения</h3>
            <textarea id="editAppProps" class="file-input" rows="4" placeholder="key: value" style="resize: vertical; font-family: monospace;"></textarea>
        </div>

        <div style="background: white; padding: 20px; border-radius: 15px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; color: #333;">🔧 Системные свойства</h3>
            <textarea id="editSysProps" class="file-input" rows="4" placeholder="key: value" style="resize: vertical; font-family: monospace;"></textarea>
        </div>

        <button id="add-save-button" class="save-button">${isAdding ? "Добавить игру" : "Сохранить изменения"}</button>
    `;

    if (!isAdding) {
        document.getElementById("uninstall-btn").onclick = (e) => {
            if (!confirm(`Вы хотите удалить игру "${app.name}"?`)) {
                return;
            }

            document.getElementById("uninstall-btn").disabled = true;
            doUninstallGame(app.appId);
        };

        document.getElementById("wipe-data-btn").onclick = (e) => {
            if (!confirm(`Вы хотите очистить данные игры "${app.name}"?`)) {
                return;
            }

            document.getElementById("wipe-data-btn").disabled = true;
            doWipeData(app.appId);
        };
    }

    const jadFileInput = document.getElementById("aux-jad-file-input");
    jadFileInput.onchange = handleOptionalJadFileUpload;

    const phoneType = document.getElementById("phoneType");
    phoneType.value = app.settings.phone || "standard";

    const screenSize = document.getElementById("screenSize");
    const sizeStr = `${app.settings.width || 240}x${app.settings.height || 320}`;
    if ([...screenSize.options].some((opt) => opt.value === sizeStr)) {
        screenSize.value = sizeStr;
    } else {
        screenSize.value = "custom";
    }
    document.getElementById("customWidth").value = app.settings.width || 240;
    document.getElementById("customHeight").value = app.settings.height || 320;
    screenSize.onchange = adjustScreenSizeInput;
    adjustScreenSizeInput();

    const fontSize = document.getElementById("fontSize");
    fontSize.value = app.settings.fontSize || "medium";

    const dgFormat = document.getElementById("dgFormat");
    dgFormat.value = app.settings.dgFormat || "16bit";

    document.querySelector('input[name="enableSound"]').checked = app.settings.sound !== "off";
    document.querySelector('input[name="rotate"]').checked = app.settings.rotate === "on";
    document.querySelector('input[name="forceFullscreen"]').checked = app.settings.forceFullscreen === "on";
    document.querySelector('input[name="textureDisableFilter"]').checked = app.settings.textureDisableFilter === "on";
    document.querySelector('input[name="queuedPaint"]').checked = app.settings.queuedPaint !== "off";

    const appPropsTextarea = document.getElementById("editAppProps");
    appPropsTextarea.value = Object.entries(app.appProperties || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");

    const sysPropsTextarea = document.getElementById("editSysProps");
    sysPropsTextarea.value = Object.entries(app.systemProperties || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");

    document.getElementById("add-save-button").onclick = doAddSaveGame;
}

function adjustScreenSizeInput() {
    document.getElementById("edit-custom-size-inputs").style.display =
        document.getElementById("screenSize").value === "custom" ? "" : "none";
}

function handleOptionalJadFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById("add-manage-step").style.display = "none";
    document.getElementById("file-input-loading").style.display = "";

    // read as text?
    const reader = new FileReader();
    reader.onload = async () => {
        // this won't affect the name/id
        readToKv(reader.result, state.currentGame.appProperties);

        const appPropsTextarea = document.getElementById("editAppProps");
        appPropsTextarea.value = Object.entries(
            state.currentGame.appProperties || {}
        )
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
    };
    reader.onloadend = () => {
        document.getElementById("add-manage-step").style.display = "";
        document.getElementById("file-input-loading").style.display = "none";
    };
    reader.readAsText(file);
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
            // генерируем уникальный appId, если такой уже существует
            await makeUniqueAppId(state.lastLoader);

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

function openEditGame(gameObj) {
    if (!confirmDiscard()) {
        return;
    }
    state.currentGame = gameObj;
    document.getElementById("add-edit-text").textContent = "✏️ Редактировать игру";

    setupAddManageGame(gameObj, false);
}

function confirmDiscard() {
    if (state.currentGame != null && (state.currentGame.jarFile || state.currentGame.appId)) {
        if (!confirm("Отменить изменения?")) {
            return false;
        }
    }

    return true;
}

async function reloadUI() {
    state.currentGame = null;

    state.games = await loadGames();
    fillGamesList(state.games);
    setupAddMode();
}

async function doUninstallGame(appId) {
    await launcherUtil.uninstallApp(appId);
    await reloadUI();
}

async function doWipeData(appId) {
    await launcherUtil.wipeAppData(appId);
    document.getElementById("wipe-data-btn").disabled = false;
}

main();
