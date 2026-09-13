import { cp, copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist/src', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
await copyFile('index.html', 'dist/index.html');
await copyFile('src/style.css', 'dist/src/style.css');
await copyFile('node_modules/phaser/dist/phaser.esm.min.js', 'dist/vendor/phaser.esm.min.js');
await cp('public', 'dist', { recursive: true });
