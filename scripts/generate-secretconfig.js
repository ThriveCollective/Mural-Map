const fs = require('fs');
const path = require('path');

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error('Error: GOOGLE_MAPS_API_KEY environment variable is required.');
  process.exit(1);
}

const filePath = path.join(process.cwd(), 'secretconfig.js');
const fileContents = `window.MURAL_MAP_SECRETS = { GOOGLE_MAPS_API_KEY: "${apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" };\n`;

fs.writeFileSync(filePath, fileContents, 'utf8');
console.log(`Generated ${filePath}`);
