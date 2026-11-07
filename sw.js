const CACHE_NAME = 'motivator-app-v1';

// ВАЖНО: Убедитесь, что имена файлов здесь ТОЧНО совпадают с вашими реальными файлами!
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',       // <-- ИСПРАВЛЕНО (было styles.css)
  // '/script.js',    // <-- РАСКОММЕНТИРУЙТЕ, если у вас есть файл script.js. Если нет - оставьте закомментированным (//)
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Кеш открыт');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => {
        console.error('Ошибка кэширования. Проверьте, что все файлы из urlsToCache существуют:', err);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});