// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        page1: resolve(__dirname, 'page1.html'),
        page2: resolve(__dirname, 'page2.html'),
        pageLP: resolve(__dirname, 'pageLessonPlay.html'),
        admin: resolve(__dirname, 'admin.html')
      },
    },
  },
  define: {
    // Firebase 일부 패키지가 process.env를 참조하는 경우가 있으므로 아래 추가
    'process.env': {},
  },
});
