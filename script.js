// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
let faceMatcher = null;
let knownFaces = [];

// ===== ЗАГРУЗКА МОДЕЛЕЙ С CDN (без локальной папки) =====
async function loadModels() {
    // Модели берутся с официального CDN face-api.js
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
    
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        document.getElementById('status').textContent = '✅ Модели загружены. Загрузите фото.';
        
        // Пытаемся загрузить базу known_faces.json (если есть)
        try {
            const resp = await fetch('known_faces.json');
            if (resp.ok) {
                const data = await resp.json();
                knownFaces = data.map(item => ({
                    ...item,
                    descriptor: new Float32Array(item.descriptor)
                }));
                const labeledDescriptors = knownFaces.map(item => 
                    new faceapi.LabeledFaceDescriptors(item.label, [item.descriptor])
                );
                faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
                document.getElementById('status').textContent = '✅ Модели и база загружены.';
            } else {
                console.warn('Файл known_faces.json не найден, работаем без базы.');
            }
        } catch (e) {
            console.warn('Не удалось загрузить known_faces.json', e);
        }
    } catch (err) {
        console.error('Ошибка загрузки моделей:', err);
        document.getElementById('status').textContent = '❌ Ошибка загрузки моделей: ' + err.message;
    }
}

// ===== ОБРАБОТКА ЗАГРУЖЕННОГО ФАЙЛА =====
async function handleFile(file) {
    const status = document.getElementById('status');
    status.textContent = '⏳ Обработка...';
    
    // Проверяем, загружены ли модели
    if (!faceapi.nets.tinyFaceDetector.params) {
        status.textContent = '❌ Модели ещё не загружены. Подождите...';
        return;
    }

    try {
        const img = await faceapi.bufferToImage(file);
        document.getElementById('preview').innerHTML = `<img src="${URL.createObjectURL(file)}" alt="preview">`;

        // 1. EXIF (GPS)
        const exifData = await readExif(file);
        let gps = null;
        if (exifData.gps) {
            const lat = exifData.gps.GPSLatitude;
            const lon = exifData.gps.GPSLongitude;
            if (lat && lon) gps = { lat, lon };
        }

        // 2. OCR (текст с фото)
        const ocrText = await performOCR(file);

        // 3. Распознавание лица
        const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();
        
        let match = null;
        if (detection && faceMatcher) {
            match = faceMatcher.findBestMatch(detection.descriptor);
        }

        // 4. Поиск в интернете (заглушка, можно заменить на реальный API)
        const googleLinks = await searchGoogleImages(file);

        // 5. Сборка результата
        let output = '🧾 РЕЗУЛЬТАТ АНАЛИЗА\n\n';
        if (match && match.label !== 'unknown') {
            const person = knownFaces.find(f => f.label === match.label);
            output += `👤 Совпадение: ${person ? person.fullName : match.label}\n`;
            if (person && person.phone) output += `📱 Телефон: ${person.phone}\n`;
            if (person && person.address) output += `🏠 Адрес: ${person.address}\n`;
            if (person && person.social) output += `🔗 Соцсети: ${person.social.join(', ')}\n`;
            output += `🎯 Уверенность: ${(1 - match.distance) * 100}%\n\n`;
        } else {
            output += `👤 Лицо не найдено в базе.\n\n`;
        }
        if (gps) {
            output += `🌍 GPS: ${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}\n`;
            output += `   https://maps.google.com?q=${gps.lat},${gps.lon}\n\n`;
        }
        if (ocrText) {
            output += `📝 Распознанный текст:\n${ocrText.substring(0, 300)}\n\n`;
        }
        if (googleLinks.length) {
            output += `🔗 Возможные ссылки:\n${googleLinks.join('\n')}\n`;
        }
        output += `\n<code>Данные собраны из открытых источников.</code>`;

        const resultBox = document.getElementById('result');
        resultBox.textContent = output;
        resultBox.style.display = 'block';
        status.textContent = '✅ Готово';
    } catch (err) {
        console.error(err);
        status.textContent = '❌ Ошибка обработки: ' + err.message;
    }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function readExif(file) {
    return new Promise((resolve) => {
        EXIF.getData(file, function() {
            const gps = EXIF.getTag(this, 'GPSInfo');
            resolve({ gps });
        });
    });
}

async function performOCR(file) {
    const worker = await Tesseract.createWorker('rus+eng');
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    return text;
}

async function searchGoogleImages(file) {
    // Заглушка – для реального поиска нужен API-ключ Google Custom Search
    return ['https://vk.com/search?c[photo]=1', 'https://ok.ru/search?st.photo=1'];
}

// ===== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ =====
document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#58a6ff'; });
    uploadArea.addEventListener('dragleave', () => uploadArea.style.borderColor = '#30363d');
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#30363d';
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    // Запускаем загрузку моделей
    loadModels().catch(err => {
        document.getElementById('status').textContent = '❌ Критическая ошибка: ' + err.message;
    });
});