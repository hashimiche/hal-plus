// Tests for model-client.mjs. No network: every call goes through a fake fetch.
// The API key used here is a sentinel string, never a real key.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { inspect } from "node:util";

import {
  createModelClient,
  createModelClientFromEnv,
  LESSON_FORMAT,
  ModelClientError,
  PROVIDER_KEY_ENV,
  SELECTION_FORMAT,
  validateLesson,
  validateSelection
} from "./model-client.mjs";

const KEY = "sk-sentinel-Zq81xV0rT5-NOT-A-REAL-KEY";
const MODEL = "pinned-model-1";
const PROMPT = "Why does GitLab CI fail to log into Vault?";
const SYSTEM = "You write HAL lessons. Answer in the language of the question.";

const SELECTION = { primary: "vault/jwt", secondary: "vault/index" };
const LESSON = {
  mechanism: "GitLab CI logs into Vault with a JWT bound to a tag.",
  configuration: "The lab binds the claim ref_type=tag.",
  commands: ["hal vault jwt", "hal vault status"],
  documents: ["https://developer.hashicorp.com/vault/docs/auth/jwt#bound-claims"]
};

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

// A fetch that records its calls and answers with `respond(url, init)`.
function recordingFetch(respond) {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  fakeFetch.calls = calls;
  return fakeFetch;
}

// A fetch that never answers and rejects with the signal's reason when aborted,
// like the real one. The interval keeps the event loop alive meanwhile.
function hangingFetch() {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const keepAlive = setInterval(() => {}, 1000);
      const onAbort = () => {
        clearInterval(keepAlive);
        reject(init.signal.reason);
      };
      if (init.signal.aborted) return onAbort();
      init.signal.addEventListener("abort", onAbort, { once: true });
    });
}

// Per-provider description of the wire format, written from the docs listed in
// the header of model-client.mjs (checked 2026-11-04), not from the code under test.
const PROVIDERS = {
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    auth: ["x-api-key", KEY],
    otherHeaders: { "anthropic-version": "2026-10-21", "content-type": "application/json" },
    systemField: "system",
    ok: (text) => ({
      id: "msg_01",
      type: "message",
      role: "assistant",
      content: [{ type: "thinking", thinking: "..." }, { type: "text", text }],
      stop_reason: "end_turn"
    }),
    withoutOutput: { type: "message", role: "assistant", content: [], stop_reason: "end_turn" },
    refusal: { type: "message", role: "assistant", content: [], stop_reason: "refusal" },
    truncated: { type: "message", role: "assistant", content: [{ type: "text", text: '{"primary":' }], stop_reason: "max_tokens" },
    errorBody: (message) => ({ type: "error", error: { type: "api_error", message }, request_id: "req_body" }),
    checkBody(body, { system, prompt, format }) {
      assert.equal(body.model, MODEL);
      assert.equal(typeof body.max_tokens, "number");
      assert.equal(body.system, system);
      assert.deepEqual(body.messages, [{ role: "user", content: prompt }]);
      assert.deepEqual(body.output_config, { format: { type: "json_schema", schema: format.schema } });
      for (const sampling of ["temperature", "top_p", "top_k"]) {
        assert.ok(!(sampling in body), `${sampling} must not be sent (400 with anthropic-version 2026-10-21)`);
      }
    }
  },
  openai: {
    url: "https://api.openai.com/v1/responses",
    auth: ["authorization", `Bearer ${KEY}`],
    otherHeaders: { "content-type": "application/json" },
    systemField: "instructions",
    ok: (text) => ({
      id: "resp_01",
      object: "response",
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }
      ]
    }),
    withoutOutput: { object: "response", status: "completed", output: [] },
    refusal: {
      object: "response",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I cannot help with that." }] }]
    },
    truncated: { object: "response", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] },
    errorBody: (message) => ({ error: { message, type: "server_error", param: null, code: null } }),
    checkBody: checkResponsesBody
  },
  xai: {
    url: "https://api.x.ai/v1/responses",
    auth: ["authorization", `Bearer ${KEY}`],
    otherHeaders: { "content-type": "application/json" },
    systemField: "instructions",
    ok: (text) => ({
      id: "resp_xai_01",
      object: "response",
      status: "completed",
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }]
    }),
    withoutOutput: { object: "response", status: "completed", output: [] },
    refusal: {
      object: "response",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Refused." }] }]
    },
    truncated: { object: "response", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] },
    errorBody: (message) => ({ error: message }),
    checkBody: checkResponsesBody
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    auth: ["x-goog-api-key", KEY],
    otherHeaders: { "api-revision": "2026-05-20", "content-type": "application/json" },
    systemField: "system_instruction",
    ok: (text) => ({
      id: "v1_abc",
      object: "interaction",
      status: "completed",
      steps: [
        { type: "thought", signature: "..." },
        { type: "model_output", content: [{ type: "text", text }] }
      ]
    }),
    withoutOutput: { object: "interaction", status: "completed", steps: [] },
    refusal: null,
    truncated: { object: "interaction", status: "incomplete", steps: [] },
    errorBody: (message) => ({ error: { code: 500, message, status: "INTERNAL" } }),
    checkBody(body, { system, prompt, format }) {
      assert.equal(body.model, MODEL);
      assert.equal(body.input, prompt);
      assert.equal(body.system_instruction, system);
      assert.equal(typeof body.generation_config.max_output_tokens, "number");
      assert.equal(body.store, false);
      assert.deepEqual(body.response_format, {
        type: "text",
        mime_type: "application/json",
        schema: format.schema
      });
      for (const sampling of ["temperature", "top_p", "top_k"]) {
        assert.ok(!(sampling in body) && !(sampling in body.generation_config), `${sampling} must not be sent`);
      }
    }
  }
};

function checkResponsesBody(body, { system, prompt, format }) {
  assert.equal(body.model, MODEL);
  assert.equal(body.instructions, system);
  assert.equal(body.input, prompt);
  assert.equal(typeof body.max_output_tokens, "number");
  assert.equal(body.store, false);
  assert.deepEqual(body.text, {
    format: { type: "json_schema", name: format.name, strict: true, schema: format.schema }
  });
  assert.ok(!("temperature" in body), "temperature must not be sent");
}

function makeClient(provider, fetchImpl, extra = {}) {
  return createModelClient({ provider, model: MODEL, apiKey: KEY, fetch: fetchImpl, ...extra });
}

function answering(provider, payload) {
  return recordingFetch(() => jsonResponse(200, PROVIDERS[provider].ok(JSON.stringify(payload))));
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to reject");
}

function assertModelClientError(error, code, extra = {}) {
  assert.ok(error instanceof ModelClientError, `expected ModelClientError, got ${error?.name}: ${error?.message}`);
  assert.equal(error.code, code, error.message);
  for (const [key, value] of Object.entries(extra)) assert.equal(error[key], value, `error.${key}`);
}

// ---------------------------------------------------------------------------
// Per provider: request, response, unreadable response
// ---------------------------------------------------------------------------

for (const [provider, spec] of Object.entries(PROVIDERS)) {
  describe(`provider ${provider}`, () => {
    test("request: URL, auth header, headers and body", async () => {
      const fakeFetch = answering(provider, LESSON);
      await makeClient(provider, fakeFetch).writeLesson({ system: SYSTEM, prompt: PROMPT });

      assert.equal(fakeFetch.calls.length, 1, "exactly one fetch per call");
      const { url, init } = fakeFetch.calls[0];
      assert.equal(url, spec.url);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error", "redirects must not replay the key header");
      assert.ok(init.signal instanceof AbortSignal);

      const headers = new Headers(init.headers);
      assert.equal(headers.get(spec.auth[0]), spec.auth[1]);
      for (const [name, value] of Object.entries(spec.otherHeaders)) {
        assert.equal(headers.get(name), value, name);
      }

      assert.ok(!url.includes(KEY), "the key must not be in the URL");
      assert.ok(!init.body.includes(KEY), "the key must not be in the body");
      spec.checkBody(JSON.parse(init.body), { system: SYSTEM, prompt: PROMPT, format: LESSON_FORMAT });
    });

    test("request: the selection call sends the selection schema", async () => {
      const fakeFetch = answering(provider, SELECTION);
      await makeClient(provider, fakeFetch).selectTopics({ system: SYSTEM, prompt: PROMPT });
      spec.checkBody(JSON.parse(fakeFetch.calls[0].init.body), {
        system: SYSTEM,
        prompt: PROMPT,
        format: SELECTION_FORMAT
      });
    });

    test("request: no system field when no system prompt is given", async () => {
      const fakeFetch = answering(provider, SELECTION);
      await makeClient(provider, fakeFetch).selectTopics({ prompt: PROMPT });
      assert.ok(!(spec.systemField in JSON.parse(fakeFetch.calls[0].init.body)));
    });

    test("response: a lesson is parsed and validated", async () => {
      const lesson = await makeClient(provider, answering(provider, LESSON)).writeLesson({ prompt: PROMPT });
      assert.deepEqual(lesson, LESSON);
    });

    test("response: a selection is parsed and validated", async () => {
      const selection = await makeClient(provider, answering(provider, SELECTION)).selectTopics({ prompt: PROMPT });
      assert.deepEqual(selection, SELECTION);
    });

    describe("unreadable response", () => {
      const lessonCall = (fetchImpl) => makeClient(provider, fetchImpl).writeLesson({ prompt: PROMPT });

      test("empty body", async () => {
        const error = await rejection(lessonCall(recordingFetch(() => new Response("", { status: 200 }))));
        assertModelClientError(error, "unreadable_response", { provider, status: 200 });
      });

      test("body that is not JSON", async () => {
        const error = await rejection(
          lessonCall(recordingFetch(() => new Response("<html>Gateway page</html>", { status: 200 })))
        );
        assertModelClientError(error, "unreadable_response", { provider });
        assert.ok(!error.message.includes("Gateway page"), "the body must not be echoed");
      });

      test("envelope without output", async () => {
        const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, spec.withoutOutput))));
        assertModelClientError(error, "unreadable_response", { provider });
      });

      test("envelope that is not an object", async () => {
        const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, ["nope"]))));
        assertModelClientError(error, "unreadable_response", { provider });
      });

      test("empty output text", async () => {
        const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, spec.ok("  ")))));
        assertModelClientError(error, "unreadable_response", { provider });
      });

      test("output text that is not JSON (prose)", async () => {
        const error = await rejection(
          lessonCall(recordingFetch(() => jsonResponse(200, spec.ok("Here is your lesson: ..."))))
        );
        assertModelClientError(error, "unreadable_response", { provider });
      });

      test("output text wrapped in a markdown fence", async () => {
        const fenced = `\`\`\`json\n${JSON.stringify(LESSON)}\n\`\`\``;
        const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, spec.ok(fenced)))));
        assertModelClientError(error, "unreadable_response", { provider });
      });

      test("output text that is JSON but not an object", async () => {
        const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, spec.ok("[1,2]")))));
        assertModelClientError(error, "unreadable_response", { provider });
      });

      test("missing fields", async () => {
        const { documents, ...partial } = LESSON;
        const error = await rejection(lessonCall(answering(provider, partial)));
        assertModelClientError(error, "invalid_output", { provider });
        assert.match(error.message, /documents \(missing\)/);
      });

      test("wrong types", async () => {
        const error = await rejection(lessonCall(answering(provider, { ...LESSON, commands: "hal vault jwt" })));
        assertModelClientError(error, "invalid_output");
        assert.match(error.message, /commands/);
      });

      test("selection without primary", async () => {
        const error = await rejection(
          makeClient(provider, answering(provider, { secondary: "vault/index" })).selectTopics({ prompt: PROMPT })
        );
        assertModelClientError(error, "invalid_output");
        assert.match(error.message, /primary \(missing\)/);
      });

      test("output cut off by the token limit", async () => {
        const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, spec.truncated))));
        assertModelClientError(error, "truncated", { provider });
      });

      if (spec.refusal) {
        test("refusal", async () => {
          const error = await rejection(lessonCall(recordingFetch(() => jsonResponse(200, spec.refusal))));
          assertModelClientError(error, "refusal", { provider });
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP errors
// ---------------------------------------------------------------------------

describe("HTTP errors", () => {
  for (const [provider, spec] of Object.entries(PROVIDERS)) {
    const call = (fetchImpl) => makeClient(provider, fetchImpl).writeLesson({ prompt: PROMPT });

    test(`${provider}: 401 is an auth error that names the key variable`, async () => {
      const error = await rejection(
        call(recordingFetch(() => jsonResponse(401, spec.errorBody("invalid credentials"), { "request-id": "req_42" })))
      );
      assertModelClientError(error, "auth", { provider, status: 401, retryable: false, requestId: "req_42" });
      assert.match(error.message, new RegExp(PROVIDER_KEY_ENV[provider]));
      assert.match(error.message, /invalid credentials/);
    });

    test(`${provider}: 403 is an auth error`, async () => {
      const error = await rejection(call(recordingFetch(() => jsonResponse(403, spec.errorBody("forbidden")))));
      assertModelClientError(error, "auth", { status: 403 });
    });

    test(`${provider}: 429 is a retryable rate limit and keeps retry-after`, async () => {
      const error = await rejection(
        call(recordingFetch(() => jsonResponse(429, spec.errorBody("slow down"), { "retry-after": "7" })))
      );
      assertModelClientError(error, "rate_limit", { provider, status: 429, retryable: true, retryAfterSeconds: 7 });
      assert.match(error.message, /retry after 7s/);
    });

    test(`${provider}: 429 without a usable retry-after`, async () => {
      const error = await rejection(
        call(recordingFetch(() => jsonResponse(429, spec.errorBody("slow down"), { "retry-after": "soon" })))
      );
      assertModelClientError(error, "rate_limit", { retryAfterSeconds: undefined, retryable: true });
    });

    for (const status of [500, 503, 529]) {
      test(`${provider}: ${status} is a retryable server error`, async () => {
        const error = await rejection(call(recordingFetch(() => jsonResponse(status, spec.errorBody("overloaded")))));
        assertModelClientError(error, "server", { provider, status, retryable: true });
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /overloaded/);
      });
    }

    test(`${provider}: 400 is a non-retryable bad request`, async () => {
      const error = await rejection(call(recordingFetch(() => jsonResponse(400, spec.errorBody("bad schema")))));
      assertModelClientError(error, "bad_request", { status: 400, retryable: false });
      assert.match(error.message, /bad schema/);
    });

    test(`${provider}: an HTML error page is not echoed`, async () => {
      const error = await rejection(
        call(recordingFetch(() => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 })))
      );
      assertModelClientError(error, "server", { status: 502 });
      assert.ok(!error.message.includes("<html>"));
    });

    test(`${provider}: a plain-text error body is kept, bounded`, async () => {
      const error = await rejection(call(recordingFetch(() => new Response("upstream timeout ".repeat(100), { status: 504 }))));
      assertModelClientError(error, "server", { status: 504 });
      assert.match(error.message, /upstream timeout/);
      assert.ok(error.message.length < 600, `message too long: ${error.message.length}`);
    });
  }

  test("openai: 429 insufficient_quota is not retryable", async () => {
    const body = { error: { message: "You exceeded your current quota.", type: "insufficient_quota", code: "insufficient_quota" } };
    const error = await rejection(
      makeClient("openai", recordingFetch(() => jsonResponse(429, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "rate_limit", { status: 429, retryable: false });
  });

  test("openai: 429 for a spent credit balance is not retryable either", async () => {
    const body = { error: { message: "Your organization has no prepaid credits remaining.", type: "rate_limit_error", code: "credit_balance_exhausted" } };
    const error = await rejection(
      makeClient("openai", recordingFetch(() => jsonResponse(429, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "rate_limit", { status: 429, retryable: false });
  });

  test("google: a transient 429 that mentions quota in its message stays retryable", async () => {
    const body = { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } };
    const error = await rejection(
      makeClient("google", recordingFetch(() => jsonResponse(429, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "rate_limit", { status: 429, retryable: true });
  });

  test("a failed Responses status is a server error", async () => {
    const body = { object: "response", status: "failed", error: { code: "server_error", message: "model crashed" }, output: [] };
    const error = await rejection(
      makeClient("openai", recordingFetch(() => jsonResponse(200, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "server", { retryable: true });
    assert.match(error.message, /model crashed/);
  });

  test("a failed Google interaction is a server error", async () => {
    const body = { object: "interaction", status: "failed", errors: [{ code: "internal", message: "decode failed" }] };
    const error = await rejection(
      makeClient("google", recordingFetch(() => jsonResponse(200, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "server");
    assert.match(error.message, /decode failed/);
  });

  test("a content-filtered Responses output is a refusal", async () => {
    const body = { object: "response", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] };
    const error = await rejection(
      makeClient("xai", recordingFetch(() => jsonResponse(200, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "refusal");
  });

  test("a Google interaction that is not completed is unreadable", async () => {
    const body = { object: "interaction", status: "in_progress", steps: [] };
    const error = await rejection(
      makeClient("google", recordingFetch(() => jsonResponse(200, body))).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "unreadable_response");
  });

  test("a network failure is a retryable network error without fetch's own text", async () => {
    const failing = recordingFetch(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    });
    const error = await rejection(makeClient("openai", failing).writeLesson({ prompt: PROMPT }));
    assertModelClientError(error, "network", { retryable: true });
    assert.match(error.message, /api\.openai\.com/);
    assert.match(error.message, /ECONNREFUSED/);
    assert.equal(error.cause, undefined);
  });
});

// ---------------------------------------------------------------------------
// Timeout and abort
// ---------------------------------------------------------------------------

describe("timeout and abort", () => {
  test("timeoutMs aborts a call that never answers", async () => {
    const started = Date.now();
    const error = await rejection(
      makeClient("anthropic", hangingFetch(), { timeoutMs: 30 }).writeLesson({ prompt: PROMPT })
    );
    assertModelClientError(error, "timeout", { provider: "anthropic", retryable: true });
    assert.match(error.message, /30 ms/);
    assert.ok(Date.now() - started < 2000);
  });

  test("an injected AbortSignal.timeout is reported as a timeout", async () => {
    const error = await rejection(
      makeClient("openai", hangingFetch()).writeLesson({ prompt: PROMPT, signal: AbortSignal.timeout(30) })
    );
    assertModelClientError(error, "timeout", { retryable: true });
  });

  test("an injected signal aborted before the call is reported as aborted", async () => {
    const error = await rejection(
      makeClient("google", hangingFetch()).selectTopics({ prompt: PROMPT, signal: AbortSignal.abort() })
    );
    assertModelClientError(error, "aborted", { retryable: false });
  });

  test("a signal aborted during the call cancels the request", async () => {
    const controller = new AbortController();
    const fakeFetch = recordingFetch(hangingFetch());
    const pending = makeClient("xai", fakeFetch).writeLesson({ prompt: PROMPT, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const error = await rejection(pending);
    assertModelClientError(error, "aborted");
    assert.equal(fakeFetch.calls[0].init.signal.aborted, true);
  });

  test("a signal that is never aborted does not disturb a normal call", async () => {
    const lesson = await makeClient("anthropic", answering("anthropic", LESSON)).writeLesson({
      prompt: PROMPT,
      signal: new AbortController().signal
    });
    assert.deepEqual(lesson, LESSON);
  });
});

// ---------------------------------------------------------------------------
// The API key never leaves the request header
// ---------------------------------------------------------------------------

describe("API key hygiene", () => {
  function everyRepresentation(error) {
    return [
      error.message,
      String(error),
      error.stack,
      JSON.stringify(error),
      JSON.stringify({ ...error }),
      inspect(error, { depth: 10, showHidden: true })
    ];
  }

  function assertNoKey(error) {
    assert.ok(error instanceof ModelClientError);
    for (const text of everyRepresentation(error)) {
      assert.ok(!text.includes(KEY), `the key leaked: ${text.slice(0, 200)}`);
      assert.ok(!text.includes(encodeURIComponent(KEY)), "the encoded key leaked");
    }
    assert.equal(error.cause, undefined);
  }

  const echoing = `Incorrect API key provided: ${KEY}. See https://example.invalid/?k=${encodeURIComponent(KEY)}`;

  for (const [provider, spec] of Object.entries(PROVIDERS)) {
    const call = (fetchImpl) => makeClient(provider, fetchImpl).writeLesson({ prompt: PROMPT, system: SYSTEM });

    test(`${provider}: not in 401, 429, 5xx messages that echo it`, async () => {
      for (const status of [401, 429, 500]) {
        assertNoKey(await rejection(call(recordingFetch(() => jsonResponse(status, spec.errorBody(echoing))))));
      }
      const plain = new Response(`bad key ${KEY}`, { status: 502 });
      assertNoKey(await rejection(call(recordingFetch(() => plain))));
    });

    test(`${provider}: not in the error of a fetch that throws it back`, async () => {
      const throwing = recordingFetch(() => {
        throw new TypeError(`fetch failed: header value ${KEY}`, { cause: new Error(`bad header ${KEY}`) });
      });
      assertNoKey(await rejection(call(throwing)));
    });

    test(`${provider}: not in an unreadable-response error`, async () => {
      assertNoKey(await rejection(call(recordingFetch(() => new Response(`oops ${KEY}`, { status: 200 })))));
      assertNoKey(await rejection(call(recordingFetch(() => jsonResponse(200, spec.ok(`not json ${KEY}`))))));
      const wrongShape = spec.ok(JSON.stringify({ ...LESSON, mechanism: KEY, extra: KEY }));
      assertNoKey(await rejection(call(recordingFetch(() => jsonResponse(200, wrongShape)))));
    });

    test(`${provider}: not in anything logged during a success or a failure`, async (t) => {
      const logged = [];
      for (const method of ["log", "info", "warn", "error", "debug", "trace"]) {
        t.mock.method(console, method, (...args) => logged.push(args.map(String).join(" ")));
      }
      await call(answering(provider, LESSON));
      await rejection(call(recordingFetch(() => jsonResponse(401, spec.errorBody(echoing)))));
      assert.deepEqual(logged.filter((line) => line.includes(KEY)), []);
    });

    test(`${provider}: the client object does not hold it as a property`, () => {
      const client = makeClient(provider, answering(provider, LESSON));
      assert.ok(!JSON.stringify(client).includes(KEY));
      assert.ok(!inspect(client, { depth: 10, showHidden: true }).includes(KEY));
    });
  }

  test("a model refusal or provider error text that echoes the key is redacted", async () => {
    const refusal = {
      object: "response",
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: `your key is ${KEY}` }] }]
    };
    assertNoKey(
      await rejection(makeClient("openai", recordingFetch(() => jsonResponse(200, refusal))).writeLesson({ prompt: PROMPT }))
    );
    const failed = { object: "interaction", status: "failed", errors: [{ code: "x", message: `key ${KEY}` }] };
    assertNoKey(
      await rejection(makeClient("google", recordingFetch(() => jsonResponse(200, failed))).writeLesson({ prompt: PROMPT }))
    );
  });

  test("a key cut by the length limit is still redacted", async () => {
    // Error messages are bounded (400 characters in model-client.mjs). Sweep the
    // padding so that, for some lengths, the cut falls in the middle of the key:
    // redacting after truncating would leave a readable key prefix there.
    for (let padding = 300; padding <= 460; padding += 1) {
      const padded = `${"x".repeat(padding)}${KEY}`;
      const error = await rejection(
        makeClient("anthropic", recordingFetch(() => jsonResponse(500, PROVIDERS.anthropic.errorBody(padded)))).writeLesson({
          prompt: PROMPT
        })
      );
      assertNoKey(error);
      assert.ok(!error.message.includes(KEY.slice(0, 8)), `readable key prefix left with padding ${padding}`);
    }
  });

  test("a key that cannot go in an HTTP header is rejected without being shown", () => {
    for (const bad of [`${KEY}\nx-evil: 1`, `${KEY} suffix`, `${KEY}é`]) {
      let error;
      try {
        createModelClient({ provider: "openai", model: MODEL, apiKey: bad, fetch: async () => {} });
      } catch (caught) {
        error = caught;
      }
      assertModelClientError(error, "config");
      assert.ok(!error.message.includes("sentinel"));
      assert.ok(!error.message.includes("evil"));
    }
  });

  test("model-client.mjs has no logging call site", () => {
    const source = readFileSync(new URL("./model-client.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bconsole\s*\./);
    assert.doesNotMatch(source, /process\s*\.\s*(stdout|stderr)/);
  });
});

// ---------------------------------------------------------------------------
// Configuration from the environment
// ---------------------------------------------------------------------------

describe("createModelClientFromEnv", () => {
  const baseEnv = (provider, extra = {}) => ({
    HAL_PROVIDER: provider,
    HAL_MODEL: MODEL,
    ANTHROPIC_API_KEY: "anthropic-key-value",
    OPENAI_API_KEY: "openai-key-value",
    XAI_API_KEY: "xai-key-value",
    GEMINI_API_KEY: "gemini-key-value",
    ...extra
  });

  for (const [provider, keyEnv] of Object.entries(PROVIDER_KEY_ENV)) {
    test(`${provider}: reads HAL_PROVIDER, HAL_MODEL and ${keyEnv} only`, async () => {
      const fakeFetch = answering(provider, SELECTION);
      const client = createModelClientFromEnv({ env: baseEnv(provider), fetch: fakeFetch });
      assert.equal(client.provider, provider);
      assert.equal(client.model, MODEL);
      await client.selectTopics({ prompt: PROMPT });

      const { url, init } = fakeFetch.calls[0];
      assert.equal(url, PROVIDERS[provider].url);
      assert.equal(JSON.parse(init.body).model, MODEL);
      const sent = [...new Headers(init.headers)].map(([, value]) => value).join(" ");
      assert.ok(sent.includes(baseEnv(provider)[keyEnv]));
      for (const [otherProvider, otherKeyEnv] of Object.entries(PROVIDER_KEY_ENV)) {
        if (otherProvider !== provider) assert.ok(!sent.includes(baseEnv(provider)[otherKeyEnv]), otherKeyEnv);
      }
    });
  }

  test("provider names are matched case-insensitively and trimmed", () => {
    const client = createModelClientFromEnv({ env: baseEnv(" OpenAI "), fetch: async () => {} });
    assert.equal(client.provider, "openai");
  });

  test("a missing HAL_PROVIDER is a config error", () => {
    const env = baseEnv("openai");
    delete env.HAL_PROVIDER;
    assert.throws(() => createModelClientFromEnv({ env }), (error) => {
      assertModelClientError(error, "config");
      assert.match(error.message, /HAL_PROVIDER/);
      return true;
    });
  });

  test("an unknown HAL_PROVIDER is a config error that lists the supported ones", () => {
    assert.throws(() => createModelClientFromEnv({ env: baseEnv("ollama") }), (error) => {
      assertModelClientError(error, "config");
      assert.match(error.message, /anthropic, openai, xai, google/);
      return true;
    });
  });

  test("inherited object keys are not providers", () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      assert.throws(() => createModelClientFromEnv({ env: baseEnv(name) }), (error) => error.code === "config");
    }
  });

  test("a missing HAL_MODEL is a config error", () => {
    const env = baseEnv("anthropic");
    delete env.HAL_MODEL;
    assert.throws(() => createModelClientFromEnv({ env }), (error) => {
      assertModelClientError(error, "config", { provider: "anthropic" });
      assert.match(error.message, /HAL_MODEL/);
      return true;
    });
  });

  for (const [provider, keyEnv] of Object.entries(PROVIDER_KEY_ENV)) {
    test(`${provider}: a missing or blank ${keyEnv} is a config error that names the variable`, () => {
      for (const value of [undefined, "", "   "]) {
        assert.throws(
          () => createModelClientFromEnv({ env: baseEnv(provider, { [keyEnv]: value }) }),
          (error) => {
            assertModelClientError(error, "config", { provider });
            assert.match(error.message, new RegExp(keyEnv));
            return true;
          }
        );
      }
    });
  }

  test("only the key of the selected provider is required", () => {
    const env = { HAL_PROVIDER: "xai", HAL_MODEL: MODEL, XAI_API_KEY: "xai-key-value" };
    assert.doesNotThrow(() => createModelClientFromEnv({ env, fetch: async () => {} }));
  });

  test("a bad model id, timeout or token limit is a config error", () => {
    const base = { provider: "openai", apiKey: "k-value", fetch: async () => {} };
    assert.throws(() => createModelClient({ ...base, model: "two words" }), (e) => e.code === "config");
    assert.throws(() => createModelClient({ ...base, model: MODEL, timeoutMs: 0 }), (e) => e.code === "config");
    assert.throws(() => createModelClient({ ...base, model: MODEL, maxOutputTokens: 1.5 }), (e) => e.code === "config");
  });

  test("maxOutputTokens is passed to the provider", async () => {
    const fakeFetch = answering("anthropic", SELECTION);
    await makeClient("anthropic", fakeFetch, { maxOutputTokens: 777 }).selectTopics({ prompt: PROMPT });
    assert.equal(JSON.parse(fakeFetch.calls[0].init.body).max_tokens, 777);
  });
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

describe("validateSelection", () => {
  test("accepts a primary and a secondary", () => {
    assert.deepEqual(validateSelection({ primary: " vault/jwt ", secondary: "vault" }), {
      primary: "vault/jwt",
      secondary: "vault"
    });
  });

  test("a secondary is optional or null", () => {
    assert.deepEqual(validateSelection({ primary: "vault/jwt" }), { primary: "vault/jwt", secondary: null });
    assert.deepEqual(validateSelection({ primary: "vault/jwt", secondary: null }), {
      primary: "vault/jwt",
      secondary: null
    });
  });

  test("a null primary means no topic matched", () => {
    assert.deepEqual(validateSelection({ primary: null, secondary: null }), { primary: null, secondary: null });
  });

  test("rejects non-objects, missing, empty, mistyped and unexpected fields", () => {
    for (const bad of [null, undefined, "vault/jwt", [], 3]) {
      assert.throws(() => validateSelection(bad), (e) => e.code === "invalid_output");
    }
    for (const bad of [
      {},
      { secondary: "vault" },
      { primary: "" },
      { primary: "   " },
      { primary: 3 },
      { primary: ["vault/jwt"] },
      { primary: "vault/jwt", secondary: "" },
      { primary: "vault/jwt", secondary: 4 },
      { primary: "vault/jwt", tool: "hal_run" }
    ]) {
      assert.throws(() => validateSelection(bad), (e) => e.code === "invalid_output", JSON.stringify(bad));
    }
  });
});

describe("validateLesson", () => {
  test("accepts exactly the four fields", () => {
    assert.deepEqual(validateLesson(LESSON), LESSON);
  });

  test("configuration, commands and documents may be empty", () => {
    const lesson = { mechanism: "Explains it.", configuration: "", commands: [], documents: [] };
    assert.deepEqual(validateLesson(lesson), lesson);
  });

  test("trims commands and documents, keeps mechanism and configuration text as written", () => {
    const lesson = validateLesson({ ...LESSON, commands: ["  hal vault jwt "], documents: [" https://a.example/x "] });
    assert.deepEqual(lesson.commands, ["hal vault jwt"]);
    assert.deepEqual(lesson.documents, ["https://a.example/x"]);
    assert.equal(lesson.mechanism, LESSON.mechanism);
  });

  test("rejects each missing field", () => {
    for (const field of Object.keys(LESSON)) {
      const { [field]: removed, ...rest } = LESSON;
      assert.throws(() => validateLesson(rest), (error) => {
        assertModelClientError(error, "invalid_output");
        assert.match(error.message, new RegExp(`${field} \\(missing\\)`));
        return true;
      });
    }
  });

  test("rejects wrong types, empty mechanism and empty entries", () => {
    for (const bad of [
      { ...LESSON, mechanism: "" },
      { ...LESSON, mechanism: 3 },
      { ...LESSON, configuration: null },
      { ...LESSON, commands: null },
      { ...LESSON, commands: "hal vault jwt" },
      { ...LESSON, commands: ["hal vault jwt", 3] },
      { ...LESSON, commands: [""] },
      { ...LESSON, documents: [{ url: "https://a.example" }] },
      { ...LESSON, documents: [" "] }
    ]) {
      assert.throws(() => validateLesson(bad), (e) => e.code === "invalid_output", JSON.stringify(bad));
    }
  });

  test("rejects extra fields: the lesson has exactly four", () => {
    assert.throws(() => validateLesson({ ...LESSON, notes: "more" }), (error) => {
      assert.match(error.message, /notes \(unexpected\)/);
      return true;
    });
  });

  test("rejects non-objects", () => {
    for (const bad of [null, undefined, "text", [LESSON], 1]) {
      assert.throws(() => validateLesson(bad), (e) => e.code === "invalid_output");
    }
  });
});

describe("schemas", () => {
  test("stay in the subset all four providers accept", () => {
    const banned = new Set(["minLength", "maxLength", "minimum", "maximum", "pattern", "maxItems", "minItems", "format", "oneOf", "anyOf", "$ref"]);
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((child, index) => walk(child, `${path}[${index}]`));
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (path.endsWith(".properties")) walk(value, `${path}.${key}`);
        else {
          assert.ok(!banned.has(key), `${path}.${key} is not portable`);
          walk(value, `${path}.${key}`);
        }
      }
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false, `${path} needs additionalProperties:false`);
        assert.deepEqual([...(node.required ?? [])].sort(), Object.keys(node.properties).sort(), `${path}: all properties required (OpenAI strict)`);
      }
    };
    walk(SELECTION_FORMAT.schema, "selection");
    walk(LESSON_FORMAT.schema, "lesson");
  });

  test("the lesson schema has exactly the four fields", () => {
    assert.deepEqual(Object.keys(LESSON_FORMAT.schema.properties), ["mechanism", "configuration", "commands", "documents"]);
  });
});
