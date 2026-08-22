import readline from 'node:readline';

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function protocolError(id, code, message) {
  return { id, error: { code, message } };
}

export async function handleNativeMessage(compiler, message) {
  const id = message && typeof message === 'object' && Object.hasOwn(message, 'id')
    ? message.id
    : null;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return protocolError(id, 'invalid_message', 'Message must be a JSON object');
  }
  if (message.method === 'compile_request') {
    if (!message.params || typeof message.params.request !== 'object') {
      return protocolError(id, 'invalid_params', 'compile_request requires params.request');
    }
    const result = await compiler.compileRequest(message.params.request, message.params.options ?? {});
    return { id, result };
  }
  if (message.method === 'evidence_get' || message.method === 'capabilities_search') {
    try {
      const result = await compiler.invokeLocalOperation(message.method, message.params ?? {});
      return { id, result };
    } catch (error) {
      return protocolError(id, 'local_operation_error', error instanceof Error ? error.message : String(error));
    }
  }
  return protocolError(id, 'unsupported_method', `Unsupported method: ${String(message.method)}`);
}

export async function runNativeCompilerStdio({ compiler, input, output }) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeJson(output, protocolError(null, 'invalid_json', 'Input line is not valid JSON'));
      continue;
    }
    try {
      writeJson(output, await handleNativeMessage(compiler, message));
    } catch (error) {
      const id = message && typeof message === 'object' && Object.hasOwn(message, 'id')
        ? message.id
        : null;
      writeJson(output, protocolError(id, 'native_compiler_error', error instanceof Error ? error.message : String(error)));
    }
  }
}
