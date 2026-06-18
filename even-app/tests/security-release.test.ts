import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walkFiles(fullPath);
    return fullPath;
  });
}

describe('release safety checks', () => {
  it('keeps the browser client free of direct Gemini credentials and SDK imports', () => {
    const sourceText = walkFiles(path.join(appRoot, 'src'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(sourceText).not.toContain('@google/genai');
    expect(sourceText).not.toContain('VITE_GEMINI_API_KEY');
  });

  it('uses a single minimal app manifest synchronized with package.json', () => {
    const packageJson = readJson<{ version: string }>(path.join(appRoot, 'package.json'));
    const appJson = readJson<{
      version: string;
      permissions: Array<{ name: string; whitelist?: string[] }>;
    }>(path.join(appRoot, 'app.json'));

    expect(existsSync(path.join(appRoot, 'public', 'app.json'))).toBe(false);
    expect(appJson.version).toBe(packageJson.version);

    const permissionNames = appJson.permissions.map((permission) => permission.name);
    expect(permissionNames).not.toContain('camera');
    expect(permissionNames).not.toContain('location');

    const networkPermission = appJson.permissions.find((permission) => permission.name === 'network');
    expect(networkPermission?.whitelist ?? []).toContain('https://api.project-echo.app');
    expect(networkPermission?.whitelist ?? []).not.toContain('https://generativelanguage.googleapis.com');
    expect((networkPermission?.whitelist ?? []).some((host) => host.includes('192.168.'))).toBe(false);
  });
});
