#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const specPath = path.join(repoRoot, 'integrations', 'chatgpt-action', 'openapi.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const errors = [];

const requiredPaths = new Map([
  ['/v1/learner/profile', ['get']],
  ['/v1/reviews/next', ['get']],
  ['/v1/reviews/attempt', ['post']],
  ['/v1/roleplays/start', ['post']],
  ['/v1/roleplays/result', ['post']],
  ['/v1/sessions/import-summary', ['post']],
]);

const requiredScopes = new Set([
  'profile:read',
  'review:read',
  'review:write',
  'roleplay:write',
  'session:write',
]);

const forbiddenNames = [
  'rawTranscript',
  'fullTranscript',
  'transcriptEntries',
  'conversationTurns',
  'audio',
  'audioBase64',
  'email',
  'phone',
  'apiKey',
  'sessionToken',
];

if (!String(spec.openapi || '').startsWith('3.')) {
  errors.push('openapi must be 3.x');
}

for (const [index, server] of Object.entries(spec.servers ?? [])) {
  if (!String(server?.url || '').startsWith('https://')) {
    errors.push(`servers[${index}].url must use https`);
  }
}

for (const [pathName, methods] of requiredPaths) {
  const pathItem = spec.paths?.[pathName];
  if (!pathItem) {
    errors.push(`missing path ${pathName}`);
    continue;
  }

  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation) {
      errors.push(`missing ${method.toUpperCase()} ${pathName}`);
      continue;
    }
    if (!operation.operationId) {
      errors.push(`${method.toUpperCase()} ${pathName} missing operationId`);
    }
    if (!operation.security || operation.security.length === 0) {
      errors.push(`${method.toUpperCase()} ${pathName} missing operation security`);
    }
  }
}

const oauth = spec.components?.securitySchemes?.oauth2;
if (oauth?.type !== 'oauth2') {
  errors.push('components.securitySchemes.oauth2 must be oauth2');
}

const oauthScopes = oauth?.flows?.authorizationCode?.scopes ?? {};
for (const scope of requiredScopes) {
  if (!(scope in oauthScopes)) {
    errors.push(`missing OAuth scope ${scope}`);
  }
}

const schemas = spec.components?.schemas ?? {};
for (const [name, schema] of Object.entries(schemas)) {
  checkSchema(name, schema);
}

const serializedSpec = JSON.stringify(spec);
for (const forbidden of forbiddenNames) {
  if (serializedSpec.includes(`"${forbidden}"`)) {
    errors.push(`forbidden schema field appears: ${forbidden}`);
  }
}

if (!serializedSpec.includes('"const":"2.0.0"')) {
  errors.push('schemaVersion const 2.0.0 is required');
}

if (errors.length > 0) {
  console.error('[chatgpt-action] validation failed');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.info('[chatgpt-action] OpenAPI contract passed');

function checkSchema(pointer, schema) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type === 'object' && schema.additionalProperties !== false) {
    errors.push(`${pointer} must set additionalProperties: false`);
  }

  if (schema.type === 'string') {
    if (!Number.isFinite(schema.maxLength)) {
      errors.push(`${pointer} string must set maxLength`);
    }
    if (schema.maxLength > 1000) {
      errors.push(`${pointer} maxLength must be <= 1000`);
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, child] of Object.entries(schema.properties)) {
      if (forbiddenNames.includes(name)) {
        errors.push(`${pointer}.${name} uses forbidden field name`);
      }
      checkSchema(`${pointer}.${name}`, child);
    }
  }

  if (schema.items) {
    checkSchema(`${pointer}[]`, schema.items);
  }

  for (const key of ['$ref', 'const', 'enum', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'not']) {
    if (schema[key]?.properties) {
      checkSchema(`${pointer}.${key}`, schema[key]);
    }
  }
}
