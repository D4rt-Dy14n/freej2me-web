export const codeMap = {
    'Enter': 53,   // 5 (центральная кнопка навигации)
    'Backspace': 8,
    'Delete': 46,
    // Стрелки - используем уникальные коды без конфликтов
    'ArrowLeft': 37,   // Стандартный код VK_LEFT
    'ArrowRight': 39,  // Стандартный код VK_RIGHT  
    'ArrowUp': 38,     // Стандартный код VK_UP
    'ArrowDown': 40,   // Стандартный код VK_DOWN
    'Escape': 27,
    'Digit0': 48,
    'Digit1': 49,
    'Digit2': 50,
    'Digit3': 51,
    'Digit4': 52,
    'Digit5': 53,
    'Digit6': 54,
    'Digit7': 55,
    'Digit8': 56,
    'Digit9': 57,
    'KeyQ': 112,           // Левая софт-клавиша (через [)
    'KeyE': 113,           // Правая софт-клавиша (через ])
    'NumpadMultiply': 42,  // * (звездочка)
    'KeyR': 35,            // R -> # (решетка)
    'F3': 114,
    'Space': 32,
    'KeyA': 65,
    'KeyB': 66,
    'KeyC': 67,
    'KeyD': 68,
    'KeyF': 70,
    'KeyG': 71,
    'KeyH': 72,
    'KeyI': 73,
    'KeyJ': 74,
    'KeyK': 75,
    'KeyL': 76,
    'KeyM': 77,
    'KeyN': 78,
    'KeyO': 79,
    'KeyP': 80,
    'KeyQ': 81,
    'KeyS': 83,
    'KeyT': 84,
    'KeyU': 85,
    'KeyV': 86,
    'KeyW': 87,
    'KeyX': 88,
    'KeyY': 89,
    'KeyZ': 90,
};



export class KeyRepeatManager {
    static TIME_TO_FIRST_REPEAT = 300;  // Уменьшено с 500 для быстрого отклика
    static REPEAT_INTERVAL = 50;        // Увеличено с 30 для более плавных повторов
    static QUICK_CLICK_THRESHOLD = 150; // Максимальное время для быстрого клика
    static MULTI_CLICK_WINDOW = 400;    // Окно для определения мульти-кликов

    keyStates = new Map();
    listener = null;
    clickHistory = new Map(); // История кликов для определения паттернов

    /**
     * Registers or unregisters a listener callback to receive emitted events.
     * @param {(eventType: string, key: string, args: object) => void | null} callback - The function to call or null to unregister.
     * - eventType: 'down', 'repeat', 'up', 'click', 'quickclick', 'multiclick', or 'hold'.
     * - key: The identifier of the key.
     * - args: The optional arguments associated with the key event.
     */
    register(callback) {
        if (callback !== null && typeof callback !== 'function') {
            console.error("KeyRepeater.register: Provided callback is not a function or null.");
            return;
        }
        this.listener = callback;
    }

    /**
     * Posts a key event (down or up).
     * @param {boolean} isDown - True if the key is pressed down, false if released up.
     * @param {string} key - The identifier for the key (e.g., "Enter", "ArrowUp", "a").
     * @param {object} [args={}] - Optional dictionary of arguments (e.g., { ctrlKey: true }).
     */
    post(isDown, key, args = {}) {
        if (!key) {
            console.error("KeyRepeater.post: 'key' argument is required.");
            return;
        }

        const currentState = this.keyStates.get(key);
        const now = Date.now();

        if (isDown) {
            if (currentState) {
                // key is already down, don't emit another 'down' event
                // just update the args
                currentState.args = args || {};
            } else {
                const newState = {
                    args: args || {},
                    pressTime: now,
                    timeoutToFirstRepeatId: null,
                    repeatIntervalId: null,
                    isHolding: false,
                };
                this.keyStates.set(key, newState);

                // Мгновенно отправляем событие нажатия
                this.emit('down', key, newState.args);

                // Устанавливаем таймер для определения удержания
                newState.timeoutToFirstRepeatId = setTimeout(() => {
                    newState.isHolding = true;
                    this.emit('hold', key, newState.args);
                    this.emit('repeat', key, newState.args);
                    
                    newState.repeatIntervalId = setInterval(() => {
                        this.emit('repeat', key, newState.args);
                    }, KeyRepeatManager.REPEAT_INTERVAL);
                }, KeyRepeatManager.TIME_TO_FIRST_REPEAT);
            }
        } else if (currentState) {
            const pressDuration = now - currentState.pressTime;
            
            this.emit('up', key, currentState.args);

            // Очищаем таймеры
            if (currentState.timeoutToFirstRepeatId) {
                clearTimeout(currentState.timeoutToFirstRepeatId);
            }
            if (currentState.repeatIntervalId) {
                clearInterval(currentState.repeatIntervalId);
            }

            // Определяем тип клика
            if (!currentState.isHolding) {
                if (pressDuration <= KeyRepeatManager.QUICK_CLICK_THRESHOLD) {
                    // Быстрый клик
                    this.handleQuickClick(key, currentState.args, now);
                } else {
                    // Обычный клик
                    this.emit('click', key, currentState.args);
                }
            }

            this.keyStates.delete(key);
        }
    }

    /**
     * Обрабатывает быстрые клики и мульти-клики
     * @private
     */
    handleQuickClick(key, args, now) {
        const history = this.clickHistory.get(key) || [];
        
        // Удаляем старые клики из истории
        const recentClicks = history.filter(time => 
            now - time <= KeyRepeatManager.MULTI_CLICK_WINDOW
        );
        
        recentClicks.push(now);
        this.clickHistory.set(key, recentClicks);

        // Определяем тип события
        if (recentClicks.length === 1) {
            // Первый быстрый клик
            this.emit('quickclick', key, { ...args, clickCount: 1 });
            this.emit('click', key, args); // Совместимость
        } else {
            // Мульти-клик
            this.emit('multiclick', key, { ...args, clickCount: recentClicks.length });
        }

        // Очищаем историю кликов через некоторое время
        setTimeout(() => {
            const currentHistory = this.clickHistory.get(key) || [];
            const filteredHistory = currentHistory.filter(time => 
                Date.now() - time <= KeyRepeatManager.MULTI_CLICK_WINDOW
            );
            
            if (filteredHistory.length === 0) {
                this.clickHistory.delete(key);
            } else {
                this.clickHistory.set(key, filteredHistory);
            }
        }, KeyRepeatManager.MULTI_CLICK_WINDOW + 100);
    }

    /**
     * Internal helper method to emit events to the registered listener.
     * @private
     */
    emit(eventType, key, args) {
        if (this.listener) {
            try {
                this.listener(eventType, key, args);
            } catch (error) {
                console.error('Error in key event listener:', error);
            }
        }
    }

    reset() {
        for (const state of this.keyStates.values()) {
            clearTimeout(state.timeoutToFirstRepeatId);
            clearInterval(state.repeatIntervalId);
        }
        this.keyStates.clear();
        this.clickHistory.clear();
    }
}

/*
// --- Example Usage ---

const keyRepeater = new KeyRepeater();

// Register the listener
keyRepeater.register((eventType, key, args) => {
    const argsString = Object.keys(args).length > 0 ? JSON.stringify(args) : '';
    // console.log(`EVENT: type=${eventType}, key=${key} ${argsString}`);
});

console.log("Simulating 'Enter' press and hold...");
keyRepeater.post(true, "Enter"); // Down

// Simulate holding Ctrl+Shift+Enter after a short delay (before first repeat)
setTimeout(() => {
     console.log("Updating args for 'Enter' to Ctrl+Shift");
    keyRepeater.post(true, "Enter", { ctrlKey: true, shiftKey: true }); // Update args
}, 200);

// Simulate releasing 'Enter' after 700ms (after first repeat should have started)
setTimeout(() => {
    console.log("Simulating 'Enter' release...");
    keyRepeater.post(false, "Enter"); // Up
}, 700);


// Simulate a quick 'Space' press/release (should trigger 'click')
setTimeout(() => {
    console.log("\nSimulating 'Space' quick press/release...");
    keyRepeater.post(true, "Space"); // Down
    setTimeout(() => {
        keyRepeater.post(false, "Space"); // Up (within 500ms)
    }, 100); // Release quickly
}, 1000);

// Simulate holding 'a' for a longer time
setTimeout(() => {
    console.log("\nSimulating 'a' press and hold...");
    keyRepeater.post(true, "a"); // Down
    setTimeout(() => {
         console.log("Simulating 'a' release...");
        keyRepeater.post(false, "a"); // Up
    }, 1500); // Hold for 1.5 seconds
}, 1500);

// Example of resetting
setTimeout(() => {
    console.log("\nSimulating 'b' press then resetting...");
    keyRepeater.post(true, "b");
    setTimeout(() => {
        keyRepeater.reset(); // Reset while 'b' is down
        console.log("Attempting to release 'b' after reset (should have no effect):");
        keyRepeater.post(false, "b"); // This will be ignored
    }, 600) // Reset after first repeat would have triggered
}, 3500);
*/