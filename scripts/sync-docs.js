const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const docsDir = path.join(rootDir, 'docs');

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const filesToSync = [
  'index.html',
  'style.css',
  'app.js',
  'room.js',
  'firebase-config.js',
  'sw.js',
  'manifest.json'
];

filesToSync.forEach(file => {
  const src = path.join(rootDir, file);
  const dest = path.join(docsDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copié ${file} -> docs/${file}`);
  }
});

// Synchroniser le dossier icons s'il existe
const iconsSrc = path.join(rootDir, 'icons');
const iconsDest = path.join(docsDir, 'icons');
if (fs.existsSync(iconsSrc)) {
  fs.cpSync(iconsSrc, iconsDest, { recursive: true });
  console.log('✓ Dossier icons/ synchronisé dans docs/icons/');
}

console.log('✨ Synchronisation vers docs/ terminée avec succès.');
