const fs = require('fs');
const path = require('path');

const csvUrl = process.env.CSV || '';
const mapApi = process.env.MAP_API || '';

const configPath = path.join(__dirname, 'js', 'config.js');
const htmlPath = path.join(__dirname, 'index.html');
const configPlaceholder = '__CSV_URL_PLACEHOLDER__';
const mapPlaceholder = '__MAP_API_KEY_PLACEHOLDER__';

function replacePlaceholder(filePath, placeholder, value, label) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ ${label} file not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (!content.includes(placeholder)) {
    console.warn(`⚠️ ${label} placeholder not found in ${filePath}`);
    return;
  }

  if (!value) {
    console.warn(`⚠️ Environment variable for ${label} is not set. Skipping injection.`);
    return;
  }

  const replacedContent = content.split(placeholder).join(value);
  fs.writeFileSync(filePath, replacedContent, 'utf8');
  console.log(`✅ ${label} injection complete.`);
}

replacePlaceholder(configPath, configPlaceholder, csvUrl, 'CSV URL');
replacePlaceholder(htmlPath, mapPlaceholder, mapApi, 'Google Maps API Key');
