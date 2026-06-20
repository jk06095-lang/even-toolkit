import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ECHO API client auth boundary', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__PROJECT_ECHO_SESSION_TOKEN__;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends a runtime-injected session token as an Authorization bearer header', async () => {
    const fetchMock = mockJsonFetch({ cue: 'Runtime cue' });
    (globalThis as Record<string, unknown>).__PROJECT_ECHO_SESSION_TOKEN__ = 'runtime-session-token';
    const { requestCue } = await importEchoApi();

    await requestCue({ topic: 'Travel', difficulty: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.project-echo.app/v1/cue',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: ['Bearer', 'runtime-session-token'].join(' '),
        }),
      }),
    );
  });

  it('can read the short-lived session token from sessionStorage at runtime', async () => {
    const fetchMock = mockJsonFetch({ cue: 'Stored token cue' });
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => (key === 'projectEcho.sessionToken' ? 'stored-session-token' : null)),
    });
    const { requestCue } = await importEchoApi();

    await requestCue({ topic: 'Food', difficulty: 2 });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(requestInit.headers.Authorization).toBe(['Bearer', 'stored-session-token'].join(' '));
  });

  it('does not send placeholder session-token values', async () => {
    const fetchMock = mockJsonFetch({ cue: 'Unauthenticated local cue' });
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => (key === 'projectEcho.sessionToken' ? 'TBD' : null)),
    });
    const { requestCue } = await importEchoApi();

    await requestCue({ topic: 'Business', difficulty: 3 });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(requestInit.headers).not.toHaveProperty('Authorization');
  });
});

async function importEchoApi() {
  vi.resetModules();
  vi.stubEnv('VITE_ECHO_API_BASE_URL', 'https://api.project-echo.app');
  return import('../src/services/echo-api');
}

function mockJsonFetch(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
