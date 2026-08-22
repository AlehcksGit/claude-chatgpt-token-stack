import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  CodexAppServerClient,
  checkCodexSubscription,
  sanitizedCodexEnvironment,
} from '../src/codex-app-server.mjs';

function appServerFixture(account) {
  let child;
  let spawnOptions;
  const messages = [];
  const spawnImpl = (command, args, options) => {
    spawnOptions = { command, args, options };
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    let buffer = '';
    child.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        messages.push(message);
        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
        } else if (message.method === 'account/read') {
          child.stdout.write(`${JSON.stringify({
            id: message.id,
            result: { account, requiresOpenaiAuth: true },
          })}\n`);
        }
      }
    });
    return child;
  };
  return { spawnImpl, getChild: () => child, getMessages: () => messages, getSpawnOptions: () => spawnOptions };
}

test('subscription gate accepts ChatGPT Pro without exposing account identity', async () => {
  const fixture = appServerFixture({
    type: 'chatgpt',
    planType: 'pro',
    email: 'private@example.com',
  });
  const result = await checkCodexSubscription({ clientOptions: { spawnImpl: fixture.spawnImpl } });
  assert.deepEqual(result, {
    eligible: true,
    authType: 'chatgpt',
    planType: 'pro',
    reason: 'eligible',
    platformApiBillingAllowed: false,
    paidCreditsAllowed: false,
    modelCallsMade: 0,
  });
  assert.equal(fixture.getChild().killed, true);
  assert.doesNotMatch(JSON.stringify(result), /private@example\.com/);
});

test('subscription gate rejects usage-billed API-key authentication', async () => {
  const fixture = appServerFixture({ type: 'apiKey' });
  const result = await checkCodexSubscription({ clientOptions: { spawnImpl: fixture.spawnImpl } });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'usage_billed_api_auth_forbidden');
  assert.equal(result.platformApiBillingAllowed, false);
  assert.equal(result.modelCallsMade, 0);
});

test('subscription gate rejects Plus, Free, and unverified plan types', async () => {
  for (const account of [
    { type: 'chatgpt', planType: 'plus' },
    { type: 'chatgpt', planType: 'free' },
    { type: 'chatgpt' },
  ]) {
    const fixture = appServerFixture(account);
    const result = await checkCodexSubscription({ clientOptions: { spawnImpl: fixture.spawnImpl } });
    assert.equal(result.eligible, false);
    assert.equal(result.modelCallsMade, 0);
  }
});

test('app-server spawn environment excludes sensitive credentials and keeps stdio isolation', async () => {
  const fixture = appServerFixture({ type: 'chatgpt', planType: 'plus' });
  const client = new CodexAppServerClient({
    command: 'fake-codex',
    spawnImpl: fixture.spawnImpl,
    env: {
      PATH: 'safe-path',
      APPDATA: 'safe-appdata',
      OPENAI_API_KEY: 'must-not-leak',
      ANTHROPIC_API_KEY: 'must-not-leak',
      RANDOM_SECRET: 'must-not-leak',
    },
  });
  try {
    await client.start();
    const initialize = fixture.getMessages().find((message) => message.method === 'initialize');
    assert.equal(initialize.params.capabilities.experimentalApi, true);
    const spawn = fixture.getSpawnOptions();
    assert.deepEqual(spawn.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(spawn.options.shell, false);
    assert.equal(spawn.options.windowsHide, true);
    assert.deepEqual(spawn.options.env, { PATH: 'safe-path', APPDATA: 'safe-appdata' });
    assert.equal(spawn.args.includes('47821'), false);
    assert.equal(spawn.args.includes('47823'), false);
    assert.equal(spawn.args.includes('47831'), false);
    assert.equal(spawn.args.includes('47841'), false);
  } finally {
    client.close();
  }
});

test('app-server client dispatches notifications and denies inbound server requests', async () => {
  const fixture = appServerFixture({ type: 'chatgpt', planType: 'plus' });
  const client = new CodexAppServerClient({ command: 'fake-codex', spawnImpl: fixture.spawnImpl });
  try {
    await client.start();
    const cursor = client.eventCursor();
    fixture.getChild().stdout.write(`${JSON.stringify({
      method: 'thread/tokenUsage/updated',
      params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: {} },
    })}\n`);
    const event = await client.waitForEvent({
      after: cursor,
      predicate: (candidate) => candidate.kind === 'notification',
    });
    assert.equal(event.value.method, 'thread/tokenUsage/updated');

    fixture.getChild().stdout.write(`${JSON.stringify({
      id: 'server-request-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1' },
    })}\n`);
    const requestEvent = await client.waitForEvent({
      after: event.sequence,
      predicate: (candidate) => candidate.kind === 'serverRequest',
    });
    assert.equal(requestEvent.value.method, 'item/commandExecution/requestApproval');
    const denial = fixture.getMessages().find((message) => message.id === 'server-request-1' && message.error);
    assert.equal(denial.error.code, -32601);
  } finally {
    client.close();
  }
});

test('environment sanitizer never passes unlisted values', () => {
  assert.deepEqual(sanitizedCodexEnvironment({
    HOME: '/safe/home',
    TEMP: '/safe/temp',
    API_TOKEN: 'secret',
    AWS_SECRET_ACCESS_KEY: 'secret',
    NODE_OPTIONS: '--require bad.js',
  }), { HOME: '/safe/home', TEMP: '/safe/temp' });
});
