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
function loadScriptWithDiagnostics(src, fallbacks = []) {
    return new Promise((resolve, reject) => {
        console.log(`📥 Пытаемся загрузить: ${src}`);
        
        const script = document.createElement('script');
        script.src = src;
        
        const timeout = setTimeout(() => {
            console.error(`⏰ Таймаут загрузки скрипта: ${src}`);
            script.remove();
            reject(new Error(`Timeout loading ${src}`));
        }, 10000); // 10 секунд таймаут
        
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
                loadScriptWithDiagnostics(nextSrc, fallbacks)
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
    
    // Список возможных источников (включая альтернативные версии)
    const sources = [
        'https://cjrtnc.leaningtech.com/4.1/loader.js',
        'https://cjrtnc.leaningtech.com/4.0/loader.js', // резервная версия
        // Можно добавить другие резервные источники если появятся
    ];
    
    // Сначала проверяем доступность основного сервера
    const isAvailable = await checkCheerpJAvailability();
    
    if (!isAvailable) {
        console.warn("⚠️ Основной CheerpJ сервер недоступен, будем пробовать все варианты...");
    }
    
    try {
        // Пытаемся загрузить с резервными вариантами
        await loadScriptWithDiagnostics(sources[0], sources.slice(1));
        
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
        console.groupEnd();
        
        // Создаем локальную заглушку
        createLocalFallback();
        
        return false;
    }
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
    
    if (navigator.connection) {
        console.log("Connection type:", navigator.connection.effectiveType);
        console.log("Connection speed:", navigator.connection.downlink + " Mbps");
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
    
    console.groupEnd();
} 