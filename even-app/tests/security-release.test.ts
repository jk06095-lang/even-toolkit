import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dynamicTextBoundaryDirs = [
  path.join(appRoot, 'src', 'ambient'),
  path.join(appRoot, 'src', 'calibration'),
  path.join(appRoot, 'src', 'combat'),
  path.join(appRoot, 'src', 'debrief'),
  path.join(appRoot, 'src', 'hud'),
  path.join(appRoot, 'src', 'learning'),
  path.join(appRoot, 'src', 'live-practice'),
  path.join(appRoot, 'src', 'services'),
];
const htmlInjectionSinkPattern = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment)\b/;

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

  it('does not log raw bridge transcription text from recognizers', () => {
    const recognizerSource = [
      path.join(appRoot, 'src', 'combat', 'speech-recognizer.ts'),
      path.join(appRoot, 'src', 'combat', 'hybrid-recognizer.ts'),
    ]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(recognizerSource).not.toContain('Bridge transcript: "');
    expect(recognizerSource).not.toContain('Bridge interim transcript: "');
    expect(recognizerSource).not.toMatch(/console\.(?:log|info|warn|error|debug)\([^)]*\$\{clean\}/);
  });

  it('keeps imported, learner, and model text away from HTML injection sinks', () => {
    const offenders = dynamicTextBoundaryDirs
      .filter((dir) => existsSync(dir))
      .flatMap((dir) => walkFiles(dir))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => htmlInjectionSinkPattern.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(appRoot, file).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('keeps live grammar analysis out of the SessionEngine real-time path', () => {
    const sessionEngineSource = readFileSync(
      path.join(appRoot, 'src', 'combat', 'session-engine.ts'),
      'utf8',
    );

    expect(sessionEngineSource).not.toContain('evaluateGrammar');
    expect(sessionEngineSource).not.toContain("beginRequest('grammar')");
    expect(sessionEngineSource).not.toMatch(/showGrammarFeedbackIfCurrent/);
    expect(sessionEngineSource).not.toMatch(/Hint used:.*\$\{.*trimmed/);
  });

  it('loads the heavy voice runtime only from the explicit Phone Mic path', () => {
    const vadManagerSource = readFileSync(path.join(appRoot, 'src', 'combat', 'vad-manager.ts'), 'utf8');

    expect(vadManagerSource).not.toMatch(/^import\s+.*@ricky0123\/vad-web/m);
    expect(vadManagerSource).not.toMatch(/^import\s+.*onnxruntime-web/m);
    expect(vadManagerSource).toContain("import('@ricky0123/vad-web')");
    expect(vadManagerSource).toContain("import('onnxruntime-web')");
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

  it('keeps packaged artifacts free of direct provider credentials and development hosts', () => {
    const artifactPaths = [
      path.join(appRoot, 'echo.ehpk'),
      ...(existsSync(path.join(appRoot, 'dist')) ? walkFiles(path.join(appRoot, 'dist')) : []),
    ].filter((file) => existsSync(file));

    expect(artifactPaths.length).toBeGreaterThan(0);

    const artifactText = artifactPaths
      .map((file) => readFileSync(file).toString('latin1'))
      .join('\n');

    expect(artifactText).not.toContain('VITE_GEMINI_API_KEY');
    expect(artifactText).not.toContain('@google/genai');
    expect(artifactText).not.toContain('generativelanguage.googleapis.com');
    expect(artifactText).not.toContain('192.168.0.17');
    expect(artifactText).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  });
});
