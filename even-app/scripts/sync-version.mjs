import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const appPath = path.join(root, 'app.json');

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const appJson = JSON.parse(readFileSync(appPath, 'utf8'));

if (appJson.version !== packageJson.version) {
  appJson.version = packageJson.version;
  writeFileSync(appPath, `${JSON.stringify(appJson, null, 2)}\n`);
  console.log(`Synced app.json version to ${packageJson.version}`);
}
