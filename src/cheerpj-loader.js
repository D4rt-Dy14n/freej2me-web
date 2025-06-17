// Диагностика и резервная загрузка CheerpJ

// Функция для проверки доступности домена
async function checkCheerpJAvailability() {
    console.log("🔍 Проверяем доступность CheerpJ серверов...");
    
    try {
        const startTime = Date.now();
        const response = await fetch('https://cjrtnc.leaningtech.com/4.1/loader.js', {
            method: 'HEAD',
            cache: 'no-cache',
            signal: AbortSignal.timeout(5000) // 5 секунд таймаут
        });
        const endTime = Date.now();
        
        console.log(`✅ CheerpJ сервер доступен (${endTime - startTime}ms), статус: ${response.status}`);
        return true;
    } catch (error) {
        console.error("❌ CheerpJ сервер недоступен:", error.message);
        return false;
    }
}

// Функция для загрузки скрипта с диагностикой
function loadScriptWithDiagnostics(src, fallbacks = [], timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        console.log(`📥 Пытаемся загрузить: ${src} (таймаут: ${timeoutMs}ms)`);
        
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous'; // Добавляем для CORS
        
        const timeout = setTimeout(() => {
            console.error(`⏰ Таймаут загрузки скрипта: ${src}`);
            script.remove();
            reject(new Error(`Timeout loading ${src}`));
        }, timeoutMs);
        
        script.onload = () => {
            clearTimeout(timeout);
            console.log(`✅ Скрипт загружен успешно: ${src}`);
            resolve();
        };
        
        script.onerror = (error) => {
            clearTimeout(timeout);
            console.error(`❌ Ошибка загрузки скрипта: ${src}`, error);
            script.remove();
            
            if (fallbacks.length > 0) {
                const nextSrc = fallbacks.shift();
                console.log(`🔄 Пробуем резервный источник: ${nextSrc}`);
                loadScriptWithDiagnostics(nextSrc, fallbacks, timeoutMs)
                    .then(resolve)
                    .catch(reject);
            } else {
                reject(new Error(`Failed to load ${src} and all fallbacks`));
            }
        };
        
        document.head.appendChild(script);
    });
}

// Функция для создания локального резервного скрипта (fallback)
function createLocalFallback() {
    console.log("⚠️ Создаем локальную заглушку для CheerpJ...");
    
    // Создаем минимальную заглушку для cheerpjInit
    window.cheerpjInit = function() {
        return Promise.reject(new Error("CheerpJ недоступен. Проверьте соединение с интернетом и настройки файрвола/прокси."));
    };
    
    console.log("📝 Локальная заглушка создана");
}

// Основная функция загрузки CheerpJ
export async function loadCheerpJ() {
    console.log("🚀 Начинаем загрузку CheerpJ...");
    
    // Определяем браузер для специфичных workaround'ов
    const isChromium = navigator.userAgent.includes('Chrome') || navigator.userAgent.includes('Chromium');
    
    // Список возможных источников
    const sources = [
        'https://cjrtnc.leaningtech.com/4.1/loader.js',
        'https://cjrtnc.leaningtech.com/4.0/loader.js', // резервная версия
    ];
    
    // Для Chromium браузеров используем более агрессивные таймауты
    const timeout = isChromium ? 15000 : 10000;
    console.log(`⏱️ Используем таймаут ${timeout}ms для ${isChromium ? 'Chromium' : 'других'} браузеров`);
    
    // Сначала проверяем доступность основного сервера
    const isAvailable = await checkCheerpJAvailability();
    
    if (!isAvailable) {
        console.warn("⚠️ Основной CheerpJ сервер недоступен, будем пробовать все варианты...");
        
        if (isChromium) {
            console.warn("🔧 Chromium обнаружен - применяем специальные workaround'ы");
            // Для Chromium пытаемся с дополнительными заголовками
            return await loadCheerpJWithWorkarounds(sources, timeout);
        }
    }
    
    try {
        // Пытаемся загрузить с резервными вариантами
        await loadScriptWithDiagnostics(sources[0], sources.slice(1), timeout);
        
        // Проверяем что CheerpJ действительно загрузился
        if (typeof window.cheerpjInit === 'undefined') {
            throw new Error("CheerpJ загружен, но cheerpjInit не найден");
        }
        
        console.log("✅ CheerpJ загружен и готов к использованию");
        return true;
        
    } catch (error) {
        console.error("💥 Все попытки загрузки CheerpJ провалились:", error);
        
        // Выводим детальную диагностику
        console.group("🔧 Диагностика сети:");
        console.log("User Agent:", navigator.userAgent);
        console.log("Online:", navigator.onLine);
        console.log("Connection:", navigator.connection ? navigator.connection.effectiveType : "unknown");
        console.log("Referrer Policy:", document.referrerPolicy);
        console.groupEnd();
        
        // Создаем локальную заглушку
        createLocalFallback();
        
        return false;
    }
}

// Специальный загрузчик для Chromium с workaround'ами
async function loadCheerpJWithWorkarounds(sources, timeout) {
    console.log("🔧 Применяем Chromium workaround'ы...");
    
    // Попытка 1: Загрузка через fetch + eval (обходит некоторые CSP проблемы)
    try {
        console.log("📥 Попытка 1: fetch + eval");
        const response = await fetch(sources[0], {
            mode: 'cors',
            credentials: 'omit',
            referrerPolicy: 'no-referrer'
        });
        
        if (response.ok) {
            const scriptContent = await response.text();
            eval(scriptContent);
            
            if (typeof window.cheerpjInit !== 'undefined') {
                console.log("✅ CheerpJ загружен через fetch + eval");
                return true;
            }
        }
    } catch (error) {
        console.warn("❌ Fetch + eval провалился:", error.message);
    }
    
    // Попытка 2: Создание iframe для обхода CSP
    try {
        console.log("📥 Попытка 2: iframe workaround");
        return await loadViaIframe(sources[0]);
    } catch (error) {
        console.warn("❌ Iframe workaround провалился:", error.message);
    }
    
    // Попытка 3: Обычная загрузка скрипта с увеличенным таймаутом
    try {
        console.log("📥 Попытка 3: стандартная загрузка с увеличенным таймаутом");
        await loadScriptWithDiagnostics(sources[0], sources.slice(1), timeout);
        
        if (typeof window.cheerpjInit !== 'undefined') {
            console.log("✅ CheerpJ загружен стандартным способом");
            return true;
        }
    } catch (error) {
        console.warn("❌ Стандартная загрузка провалилась:", error.message);
    }
    
    return false;
}

// Загрузка через iframe для обхода CSP
function loadViaIframe(src) {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.onload = () => {
            try {
                // Пытаемся получить доступ к глобальной области iframe
                const iframeWindow = iframe.contentWindow;
                
                if (iframeWindow && iframeWindow.cheerpjInit) {
                    // Копируем cheerpjInit в родительское окно
                    window.cheerpjInit = iframeWindow.cheerpjInit;
                    window.cheerpjRunLibrary = iframeWindow.cheerpjRunLibrary;
                    
                    iframe.remove();
                    resolve(true);
                } else {
                    iframe.remove();
                    reject(new Error("CheerpJ не найден в iframe"));
                }
            } catch (error) {
                iframe.remove();
                reject(error);
            }
        };
        
        iframe.onerror = () => {
            iframe.remove();
            reject(new Error("Ошибка загрузки iframe"));
        };
        
        // Создаем HTML для iframe с загрузкой CheerpJ
        const iframeHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <script src="${src}"></script>
            </head>
            <body></body>
            </html>
        `;
        
        document.body.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(iframeHTML);
        iframe.contentDocument.close();
    });
}

// Функция для диагностики окружения
export function diagnoseEnvironment() {
    console.group("🔍 Диагностика окружения:");
    console.log("Browser:", navigator.userAgent);
    console.log("Platform:", navigator.platform);
    console.log("Online:", navigator.onLine);
    console.log("Cookies enabled:", navigator.cookieEnabled);
    console.log("Language:", navigator.language);
    console.log("Screen:", `${screen.width}x${screen.height}`);
    console.log("Viewport:", `${window.innerWidth}x${window.innerHeight}`);
    
    // Определяем браузер
    const isChrome = navigator.userAgent.includes('Chrome');
    const isSafari = navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome');
    const isChromium = navigator.userAgent.includes('Chromium') || isChrome;
    
    console.log("Browser type:", {
        isChrome,
        isSafari,
        isChromium,
        engine: isChromium ? 'Blink/V8' : (isSafari ? 'WebKit/JavaScriptCore' : 'Unknown')
    });
    
    if (navigator.connection) {
        console.log("Connection type:", navigator.connection.effectiveType);
        console.log("Connection speed:", navigator.connection.downlink + " Mbps");
    }
    
    // Проверяем CSP
    try {
        const testScript = document.createElement('script');
        testScript.textContent = 'window.cspTest = true;';
        document.head.appendChild(testScript);
        document.head.removeChild(testScript);
        console.log("CSP inline scripts:", window.cspTest ? 'Allowed' : 'Blocked');
        delete window.cspTest;
    } catch (e) {
        console.log("CSP inline scripts: Blocked (" + e.message + ")");
    }
    
    // Проверяем блокировщики рекламы/скриптов
    const testDiv = document.createElement('div');
    testDiv.className = 'ad ads advertisement';
    testDiv.style.position = 'absolute';
    testDiv.style.left = '-9999px';
    document.body.appendChild(testDiv);
    
    setTimeout(() => {
        const blocked = testDiv.offsetHeight === 0;
        console.log("Ad blocker detected:", blocked);
        testDiv.remove();
    }, 100);
    
    // Проверяем CORS preflight для CheerpJ домена
    checkCORSSupport();
    
    console.groupEnd();
}

// Функция для проверки CORS поддержки
async function checkCORSSupport() {
    try {
        // Простая проверка OPTIONS запроса
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch('https://cjrtnc.leaningtech.com/4.1/', {
            method: 'HEAD',
            mode: 'cors',
            signal: controller.signal
        });
        
        console.log("CORS support for cjrtnc.leaningtech.com:", response.ok ? 'OK' : 'Issues detected');
    } catch (error) {
        console.log("CORS check failed:", error.message);
    }
} 