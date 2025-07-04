# 🎮 FreeJ2ME Web

<div align="center">

![FreeJ2ME Logo](https://img.shields.io/badge/FreeJ2ME-Web_Emulator-blue?style=for-the-badge&logo=java)

**Классические Java ME игры в современном браузере**

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Web](https://img.shields.io/badge/platform-Web-orange.svg)](https://developer.mozilla.org/en-US/docs/Web)
[![Java ME](https://img.shields.io/badge/Java-ME-red.svg)](https://www.oracle.com/java/technologies/javameoverview.html)

[🚀 Демо](#демо) • [📖 Документация](#документация) • [🎯 Возможности](#возможности) • [⚙️ Установка](#установка)

</div>

---

## 📝 Описание

**FreeJ2ME Web** — это мощный веб-эмулятор Java ME (J2ME), который позволяет запускать классические мобильные игры прямо в браузере. Проект использует современные веб-технологии для обеспечения аутентичного игрового опыта эпохи мобильных телефонов 2000-х годов.

## ✨ Возможности

### 🎯 Основной функционал
- **🎮 Эмуляция J2ME игр** — полная поддержка Java ME приложений
- **📱 Множественные разрешения** — от 96x65 до 800x480 пикселей  
- **🔧 Настройки устройств** — эмуляция различных моделей телефонов
- **💾 Автосохранение** — игры сохраняются в локальном хранилище браузера
- **🖱️ Drag & Drop** — простая загрузка JAR файлов перетаскиванием

### 🎨 Интерфейс
- **🌟 Современный дизайн** — красивый градиентный интерфейс
- **📱 Адаптивность** — оптимизация для мобильных устройств
- **🌐 Мультиязычность** — поддержка русского и английского языков
- **⚡ Быстрая загрузка** — оптимизированная производительность

### 🎲 Предустановленные игры
- **Prince of Persia: The Forgotten Sands**
- **God of War**
- **Half Life**
- **Metro 2033**  
- **Doom RPG** / **Doom 2 RPG**
- **Wolfenstein RPG**
- **Splinter Cell: Conviction**
- **Splinter Cell: Pandora**
- **Heroes Lore**
- **Lost Planet 2**
- **Far Cry 2**
- И многие другие...

## 🚀 Демо

![Скриншот главной страницы](https://via.placeholder.com/800x400/667eea/ffffff?text=FreeJ2ME+Web+Interface)

### 🎮 Поддерживаемые разрешения:
- 📱 **96x65** — Nokia 3210
- 📱 **128x128** — BlackBerry 
- 📱 **176x208** — Nokia Series 40
- 📱 **240x320** — Стандартный QVGA
- 📱 **360x640** — Современные J2ME устройства
- 🔧 **Пользовательские** — настраиваемые размеры

## ⚙️ Установка

### 🌐 Веб-версия (рекомендуется)

1. **Клонируйте репозиторий:**
   ```bash
   git clone https://github.com/yourusername/freej2me-web.git
   cd freej2me-web
   ```

2. **Запустите локальный сервер:**
   ```bash
   # Используя Python 3
   python -m http.server 8000
   
   # Или используя Node.js
   npx serve .
   
   # Или используя PHP
   php -S localhost:8000
   ```

3. **Откройте в браузере:**
   ```
   http://localhost:8000
   ```

### 📋 Требования

- **Браузер:** Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **JavaScript:** Поддержка ES6 модулей
- **WebAssembly:** Поддержка WASM (для CheerpJ)

## 🎯 Использование

### 📁 Загрузка игр

1. **Откройте главную страницу** `index.html`
2. **Перетащите JAR файл** в зону загрузки или нажмите для выбора
3. **Настройте параметры** игры (разрешение, тип устройства)
4. **Запустите игру** нажав "Играть"

### ⚙️ Настройка игры

```javascript
// Поддерживаемые настройки
{
  screenSize: "240x320",     // Разрешение экрана
  phoneType: "Nokia_N95",    // Тип телефона
  soundEnabled: true,        // Включение звука
  keyMapping: "default"      // Схема управления
}
```

### 🎮 Управление

| Кнопка | Действие |
|--------|----------|
| **↑↓←→** | Навигация |
| **Enter** | ОК/Выбор |
| **Escape** | Назад/Меню |
| **1-9,0,*,#** | Цифровые кнопки |

## 🏗️ Архитектура

```
freej2me-web/
├── 📁 src/                 # Исходный код JavaScript
│   ├── main.js            # Основная логика эмулятора
│   ├── launcher.js        # Менеджер запуска игр
│   ├── key.js             # Обработка клавиатуры
│   └── screenKbd.js       # Виртуальная клавиатура
├── 📁 games/              # JAR файлы игр
├── 📁 lib/                # Внешние библиотеки
├── 📁 libjs/              # JavaScript библиотеки
├── 📁 libmedia/           # Медиа библиотеки
├── 📁 libmidi/            # MIDI библиотеки
├── 📄 index.html          # Главная страница
├── 📄 launcher.html       # Менеджер игр
├── 📄 run.html            # Страница эмулятора
└── 📄 freej2me-web.jar    # Core эмулятор
```

## 🔧 Технологии

- **Frontend:** HTML5, CSS3, JavaScript ES6+
- **Эмуляция:** CheerpJ (Java-to-WebAssembly)
- **Библиотеки:** JSZip для работы с JAR файлами
- **Стили:** CSS Grid, Flexbox, CSS Variables
- **Производительность:** Web Workers, Service Workers

## 🤝 Участие в разработке

Мы приветствуем вклад в развитие проекта! 

### 📋 Как участвовать:

1. **Fork** репозиторий
2. **Создайте ветку** для новой функции (`git checkout -b feature/amazing-feature`)
3. **Внесите изменения** и добавьте тесты
4. **Commit** изменения (`git commit -m 'Add amazing feature'`)
5. **Push** в ветку (`git push origin feature/amazing-feature`)
6. **Создайте Pull Request**

### 🐛 Сообщение об ошибках

Используйте [Issues](https://github.com/yourusername/freej2me-web/issues) для сообщения об ошибках:
- Опишите проблему подробно
- Укажите браузер и версию
- Приложите скриншоты при необходимости
- Добавьте шаги воспроизведения

## 📚 Документация

### 🔗 Полезные ссылки
- [Java ME Documentation](https://docs.oracle.com/javame/)
- [CheerpJ Documentation](https://docs.leaningtech.com/cheerpj/)
- [FreeJ2ME Original Project](https://github.com/hex007/freej2me)

### 📖 Дополнительные ресурсы
- [Список совместимых игр](docs/compatible-games.md)
- [Руководство по отладке](docs/debugging.md)
- [API Reference](docs/api.md)

## 📄 Лицензия

Этот проект распространяется под лицензией MIT. Подробности в файле [LICENSE](LICENSE).

## 🙏 Благодарности

- **FreeJ2ME** — за основной движок эмуляции
- **CheerpJ** — за технологию конвертации Java в WebAssembly
- **Разработчики J2ME игр** — за создание классических игр
- **Сообщество** — за тестирование и обратную связь

## 📞 Контакты

- **Автор:** [Ваше имя](https://github.com/yourusername)
- **Email:** your.email@example.com
- **Telegram:** @yourusername

---

<div align="center">

**⭐ Поставьте звезду, если проект был полезен!**

[![GitHub stars](https://img.shields.io/github/stars/yourusername/freej2me-web.svg?style=social&label=Star)](https://github.com/yourusername/freej2me-web)
[![GitHub forks](https://img.shields.io/github/forks/yourusername/freej2me-web.svg?style=social&label=Fork)](https://github.com/yourusername/freej2me-web/fork)

</div>