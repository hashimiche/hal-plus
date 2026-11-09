// model-client.mjs
//
// Hosted model client for the HAL Plus lesson pipeline (plan task T06). One
// `fetch` per provider, no SDK, no LangChain, no new dependency. The lesson
// pipeline (T07) makes two calls through this module and never lets the model
// pick a tool:
//   call 1  catalog (id + summary)  ->  { primary, secondary }
//   call 2  prose + reads + excerpts ->  { mechanism, configuration, commands, documents }
// Everything here is about getting a strict JSON object back and failing
// loudly when that did not happen. Checking ids against the catalog and
// filtering commands / URLs against the topic files is T07, not this module.
//
// Environment (read once, by createModelClientFromEnv):
//   HAL_PROVIDER   anthropic | openai | xai | google
//   HAL_MODEL      pinned model id for that provider. The plan does not name
//                  this variable; the hal side (T05) must inject this exact name.
//   key            ANTHROPIC_API_KEY | OPENAI_API_KEY | XAI_API_KEY | GEMINI_API_KEY
//                  (only the variable of the selected provider is read)
//
// Exported surface (T07 consumes this):
//   createModelClientFromEnv({ env, fetch, timeoutMs, maxOutputTokens })
//   createModelClient({ provider, model, apiKey, fetch, timeoutMs, maxOutputTokens })
//     -> { provider, model,
//          selectTopics({ system, prompt, signal }) -> { primary, secondary },
//          writeLesson({ system, prompt, signal })  -> { mechanism, configuration, commands, documents } }
//   validateSelection(value), validateLesson(value)  shape validators (pure, throw ModelClientError)
//   SELECTION_FORMAT, LESSON_FORMAT                  { name, schema } sent to the provider
//   ModelClientError                                 typed error, see below
//   PROVIDER_KEY_ENV                                 provider -> key variable name
//
// `prompt` is required. `system` is optional. `fetch` and `signal` are
// injectable: tests pass a fake fetch, callers may pass an AbortSignal
// (cancel, or their own deadline). `timeoutMs` (default 60000) is an extra
// deadline on every call; both abort the request.
//
// Errors are always ModelClientError with a `code`:
//   config               bad env / options, nothing was sent
//   auth                 HTTP 401 / 403
//   rate_limit           HTTP 429 (`retryAfterSeconds` when the header is sane)
//   server               HTTP 5xx (including 529 overloaded) or a provider-side failed response
//   bad_request          any other HTTP 4xx (400, 402, 404, 413, 422, ...)
//   timeout              deadline hit (timeoutMs or an injected TimeoutError signal)
//   aborted              the caller's signal was aborted
//   network              fetch threw for another reason (DNS, refused, TLS, ...)
//   refusal              the model refused, or a content filter stopped it
//   truncated            output was cut off (max tokens / incomplete); raise maxOutputTokens
//   unreadable_response  empty body, non-JSON body, envelope without output, output text that is
//                        not a JSON object (markdown fences and trailing prose included)
//   invalid_output       valid JSON object, wrong shape (validateSelection / validateLesson)
// `retryable` is true for rate_limit (unless OpenAI says the credit or quota is spent), server, timeout,
// network. Errors also carry `provider`, `status`, `requestId` when known. They never carry
// the response body, the request headers or a `cause`.
//
// API key handling. The key lives in a closure and goes into exactly one
// request header. It is never put in a URL, a log, an error message or a
// property of the client. This module has no logging call sites at all. Text
// that comes from outside (provider error messages, fetch failures) is
// redacted before it reaches an error message, and fetch's own error text is
// dropped entirely (undici echoes header values in some messages). Keys that
// would make fetch throw (whitespace, newline, non-ASCII) are rejected up
// front without being shown. Redirects are refused so the key header is never
// replayed to another origin.
//
// Every call is sent without sampling parameters (no temperature / top_p /
// top_k): Anthropic rejects them with the 2026-10-21 version, and one portable
// request keeps the four providers comparable. The call is also sent with
// storage off where the API has such a switch.
//
// How "JSON only" is obtained, per provider. Checked against the official docs
// on 2026-11-04 (pages fetched that day; nothing here is from memory):
//
//   anthropic  POST https://api.anthropic.com/v1/messages
//     auth: x-api-key + anthropic-version: 2026-10-21. Body: model, max_tokens,
//     system, messages, output_config.format = { type: "json_schema", schema }.
//     Output: first content block of type "text". stop_reason "refusal" and
//     "max_tokens" are not usable output.
//     https://platform.claude.com/docs/en/api/messages
//     https://platform.claude.com/docs/en/build-with-claude/structured-outputs
//     https://platform.claude.com/docs/en/api/versioning
//     https://platform.claude.com/docs/en/api/errors
//     https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
//
//   openai  POST https://api.openai.com/v1/responses
//     auth: Authorization: Bearer. Body: model, instructions, input,
//     max_output_tokens, store: false, text.format = { type: "json_schema",
//     name, strict: true, schema } (all properties required,
//     additionalProperties false). Output: raw HTTP responses have no top-level
//     output_text; read output[] -> item "message" -> content[] "output_text"
//     (or "refusal"). status "incomplete" / "failed" are not usable.
//     https://developers.openai.com/api/docs/guides/structured-outputs
//     https://developers.openai.com/api/docs/guides/migrate-to-responses
//     https://developers.openai.com/api/docs/guides/error-codes
//     https://developers.openai.com/api/reference/resources/responses/methods/create
//
//   xai  POST https://api.x.ai/v1/responses
//     xAI is not a plain OpenAI clone. Its Chat Completions endpoint is marked
//     deprecated and the Responses API is the recommended one, so this uses
//     the Responses API with the same request and response shape as openai
//     above (Authorization: Bearer, text.format json_schema). The docs do not
//     describe the error body, so error parsing accepts both { error: "text" }
//     and { error: { message } }.
//     https://docs.x.ai/developers/model-capabilities/text/structured-outputs.md
//     https://docs.x.ai/developers/model-capabilities/text/comparison.md
//     https://docs.x.ai/developers/rest-api-reference/inference/responses.md
//     https://docs.x.ai/developers/debugging.md
//
//   google  POST https://generativelanguage.googleapis.com/v1beta/interactions
//     Not OpenAI compatible at the native endpoint (the /v1beta/openai/ layer
//     is still beta, not used). Uses the Interactions API, which Google
//     recommends over the legacy generateContent. auth: x-goog-api-key +
//     Api-Revision: 2026-05-20. Body: model, input, system_instruction,
//     generation_config.max_output_tokens, store: false, response_format =
//     { type: "text", mime_type: "application/json", schema }. Output:
//     steps[] -> step "model_output" -> content[] "text" (thought steps are
//     skipped). status "incomplete" / "failed" are not usable. minLength /
//     maxLength are stripped server side, so the schemas below avoid them.
//     https://aistudio.google.com/docs/structured-output
//     https://aistudio.google.com/docs/interactions-breaking-changes-may-2026.md
//     https://aistudio.google.com/docs/api-errors.md
//     https://aistudio.google.com/api-reference/interactions
//   (platform.openai.com and ai.google.dev redirect to the hosts above.)
//
// Providers guarantee the schema only when the output completes normally, so
// the text is always parsed and validated here again.

export const PROVIDER_KEY_ENV = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  google: "GEMINI_API_KEY"
});

const DEFAULT_TIMEOUT_MS = 60_000;
// Reasoning models count thinking tokens against this limit, so keep headroom.
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_MESSAGE_LENGTH = 400;

export class ModelClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ModelClientError";
    this.code = code;
    this.provider = details.provider;
    this.status = details.status;
    this.requestId = details.requestId;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.retryable = Boolean(details.retryable);
  }
}

// Schemas stay inside the subset all four providers accept: types, required,
// additionalProperties false, nullable through a type array. No length,
// numeric or pattern constraints; validateSelection / validateLesson do the
// real checking.
export const SELECTION_FORMAT = {
  name: "hal_selection",
  schema: {
    type: "object",
    properties: {
      primary: { type: ["string", "null"] },
      secondary: { type: ["string", "null"] }
    },
    required: ["primary", "secondary"],
    additionalProperties: false
  }
};

export const LESSON_FORMAT = {
  name: "hal_lesson",
  schema: {
    type: "object",
    properties: {
      mechanism: { type: "string" },
      configuration: { type: "string" },
      commands: { type: "array", items: { type: "string" } },
      documents: { type: "array", items: { type: "string" } }
    },
    required: ["mechanism", "configuration", "commands", "documents"],
    additionalProperties: false
  }
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function invalidOutput(what, problems) {
  return new ModelClientError(
    "invalid_output",
    `${what} has missing or malformed fields: ${problems.join(", ")}`
  );
}

// Call 1. `primary` is a topic id, or null when nothing in the catalog fits
// (the plan still writes a lesson in that case). `secondary` may be absent or
// null. Ids are only checked for shape here; T07 checks them against the catalog.
export function validateSelection(value) {
  if (!isObject(value)) {
    throw invalidOutput("selection", ["not a JSON object"]);
  }
  const problems = [];
  for (const key of Object.keys(value)) {
    if (key !== "primary" && key !== "secondary") problems.push(`${key} (unexpected)`);
  }
  if (!Object.hasOwn(value, "primary")) {
    problems.push("primary (missing)");
  } else if (value.primary !== null && !isNonEmptyString(value.primary)) {
    problems.push("primary (expected a non-empty string or null)");
  }
  if (Object.hasOwn(value, "secondary") && value.secondary !== null && !isNonEmptyString(value.secondary)) {
    problems.push("secondary (expected a non-empty string or null)");
  }
  if (problems.length > 0) throw invalidOutput("selection", problems);
  return {
    primary: value.primary === null ? null : value.primary.trim(),
    secondary: isNonEmptyString(value.secondary) ? value.secondary.trim() : null
  };
}

// Call 2. Exactly the four fields. `mechanism` must say something;
// `configuration` may be empty (a question with no matching topic has nothing
// to say about the lab); `commands` and `documents` are arrays of non-empty
// strings (documents are URLs, T07 keeps only those present in the topic
// headers) and may be empty.
export function validateLesson(value) {
  if (!isObject(value)) {
    throw invalidOutput("lesson", ["not a JSON object"]);
  }
  const problems = [];
  const allowed = new Set(["mechanism", "configuration", "commands", "documents"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) problems.push(`${key} (unexpected)`);
  }
  if (!Object.hasOwn(value, "mechanism")) {
    problems.push("mechanism (missing)");
  } else if (!isNonEmptyString(value.mechanism)) {
    problems.push("mechanism (expected a non-empty string)");
  }
  if (!Object.hasOwn(value, "configuration")) {
    problems.push("configuration (missing)");
  } else if (typeof value.configuration !== "string") {
    problems.push("configuration (expected a string)");
  }
  for (const field of ["commands", "documents"]) {
    if (!Object.hasOwn(value, field)) {
      problems.push(`${field} (missing)`);
    } else if (!Array.isArray(value[field]) || !value[field].every(isNonEmptyString)) {
      problems.push(`${field} (expected an array of non-empty strings)`);
    }
  }
  if (problems.length > 0) throw invalidOutput("lesson", problems);
  return {
    mechanism: value.mechanism,
    configuration: value.configuration,
    commands: value.commands.map((entry) => entry.trim()),
    documents: value.documents.map((entry) => entry.trim())
  };
}

// ---------------------------------------------------------------------------
// Provider adapters: how to ask, and where the text is in the answer.
// ---------------------------------------------------------------------------

function textOrFail(text, fail) {
  if (typeof text !== "string" || text.trim() === "") {
    throw fail("unreadable_response", "the response contains no output text");
  }
  return text;
}

function extractAnthropic(body, fail) {
  if (!isObject(body)) throw fail("unreadable_response", "the response is not a JSON object");
  if (body.stop_reason === "refusal") {
    throw fail("refusal", "the model refused to answer (stop_reason refusal)");
  }
  if (body.stop_reason === "max_tokens" || body.stop_reason === "model_context_window_exceeded") {
    throw fail("truncated", `the output was cut off (stop_reason ${body.stop_reason}); raise maxOutputTokens`);
  }
  if (!Array.isArray(body.content)) throw fail("unreadable_response", "the response has no content array");
  const block = body.content.find((entry) => isObject(entry) && entry.type === "text");
  return textOrFail(block?.text, fail);
}

// OpenAI and xAI share the Responses API shape.
function extractResponses(body, fail) {
  if (!isObject(body)) throw fail("unreadable_response", "the response is not a JSON object");
  if (body.status === "failed") {
    const detail = isObject(body.error) && typeof body.error.message === "string" ? `: ${body.error.message}` : "";
    throw fail("server", `the provider reported a failed response${detail}`);
  }
  if (body.status === "incomplete") {
    const reason = isObject(body.incomplete_details) ? body.incomplete_details.reason : undefined;
    if (reason === "content_filter") throw fail("refusal", "the output was stopped by a content filter");
    throw fail("truncated", `the response is incomplete (${reason ?? "unknown reason"}); raise maxOutputTokens`);
  }
  if (!Array.isArray(body.output)) throw fail("unreadable_response", "the response has no output array");
  for (const item of body.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isObject(part)) continue;
      if (part.type === "refusal") {
        throw fail("refusal", `the model refused to answer${typeof part.refusal === "string" ? `: ${part.refusal}` : ""}`);
      }
      if (part.type === "output_text") return textOrFail(part.text, fail);
    }
  }
  throw fail("unreadable_response", "the response has no output_text part");
}

function extractGoogle(body, fail) {
  if (!isObject(body)) throw fail("unreadable_response", "the response is not a JSON object");
  if (body.status === "failed") {
    const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
    const detail = isObject(first) && typeof first.message === "string" ? `: ${first.message}` : "";
    throw fail("server", `the provider reported a failed interaction${detail}`);
  }
  if (body.status === "incomplete") {
    throw fail("truncated", "the interaction is incomplete (probably max_output_tokens); raise maxOutputTokens");
  }
  if (body.status !== "completed") {
    throw fail("unreadable_response", `the interaction did not complete (status ${String(body.status)})`);
  }
  if (!Array.isArray(body.steps)) throw fail("unreadable_response", "the response has no steps array");
  for (const step of body.steps) {
    if (!isObject(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    const part = step.content.find((entry) => isObject(entry) && entry.type === "text");
    if (part) return textOrFail(part.text, fail);
  }
  throw fail("unreadable_response", "the response has no model_output text");
}

function responsesBody({ model, system, prompt, format, maxOutputTokens }) {
  return {
    model,
    ...(system ? { instructions: system } : {}),
    input: prompt,
    max_output_tokens: maxOutputTokens,
    store: false,
    text: { format: { type: "json_schema", name: format.name, strict: true, schema: format.schema } }
  };
}

const ADAPTERS = {
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    headers: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      "content-type": "application/json"
    }),
    body: ({ model, system, prompt, format, maxOutputTokens }) => ({
      model,
      max_tokens: maxOutputTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: format.schema } }
    }),
    extract: extractAnthropic
  },
  openai: {
    url: "https://api.openai.com/v1/responses",
    headers: (apiKey) => ({ authorization: `Bearer ${apiKey}`, "content-type": "application/json" }),
    body: responsesBody,
    extract: extractResponses
  },
  xai: {
    url: "https://api.x.ai/v1/responses",
    headers: (apiKey) => ({ authorization: `Bearer ${apiKey}`, "content-type": "application/json" }),
    body: responsesBody,
    extract: extractResponses
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    headers: (apiKey) => ({
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
      "api-revision": "2026-05-20"
    }),
    body: ({ model, system, prompt, format, maxOutputTokens }) => ({
      model,
      input: prompt,
      ...(system ? { system_instruction: system } : {}),
      generation_config: { max_output_tokens: maxOutputTokens },
      store: false,
      response_format: { type: "text", mime_type: "application/json", schema: format.schema }
    }),
    extract: extractGoogle
  }
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function configError(message, provider) {
  return new ModelClientError("config", message, { provider });
}

function positiveNumber(value, fallback, label, { integer = false } = {}) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw configError(`${label} must be a positive ${integer ? "integer" : "number"}`);
  }
  return value;
}

// Pull a human-readable message out of a provider error body. The four
// providers disagree on the shape and xAI does not document its own.
function providerMessage(body) {
  if (!isObject(body)) return "";
  if (typeof body.error === "string") return body.error;
  if (isObject(body.error) && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string") return body.message;
  return "";
}

export function createModelClient(options = {}) {
  const provider = options.provider;
  const adapter = Object.hasOwn(ADAPTERS, provider ?? "") ? ADAPTERS[provider] : undefined;
  if (!adapter) {
    throw configError(`provider must be one of ${Object.keys(ADAPTERS).join(", ")}`);
  }
  const keyEnv = PROVIDER_KEY_ENV[provider];
  const model = typeof options.model === "string" ? options.model.trim() : "";
  if (!/^[\w.:/-]+$/.test(model)) {
    throw configError("the model id must be a non-empty string without spaces", provider);
  }
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey === "") {
    throw configError(`${keyEnv} is not set or empty`, provider);
  }
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    // The value is deliberately not shown.
    throw configError(`${keyEnv} contains characters that cannot go in an HTTP header (space, line break or non-ASCII)`, provider);
  }
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const maxOutputTokens = positiveNumber(options.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, "maxOutputTokens", {
    integer: true
  });
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw configError("no fetch implementation available", provider);
  }
  const secrets = [apiKey, encodeURIComponent(apiKey)];

  // Redact first, then truncate, so a key cut by the limit can never show.
  function clean(text) {
    let out = String(text ?? "");
    for (const secret of secrets) out = out.split(secret).join("[redacted]");
    out = out.replace(/\s+/g, " ").trim();
    return out.length > MAX_MESSAGE_LENGTH ? `${out.slice(0, MAX_MESSAGE_LENGTH)}...` : out;
  }

  function fail(code, message, details = {}) {
    return new ModelClientError(code, clean(`${provider}: ${message}`), {
      provider,
      retryable: code === "server" || code === "timeout" || code === "network",
      ...details
    });
  }

  // Validators throw without a provider; the client adds it so every error from
  // a call names its provider.
  function checked(validate, output) {
    try {
      return validate(output);
    } catch (error) {
      if (error instanceof ModelClientError) throw fail(error.code, error.message);
      throw error;
    }
  }

  function requestId(headers) {
    const value = headers?.get?.("request-id") ?? headers?.get?.("x-request-id");
    return typeof value === "string" && value !== "" ? clean(value).slice(0, 100) : undefined;
  }

  function httpFailure(response, rawBody) {
    const status = response.status;
    let detail = "";
    let outOfCredit = false;
    try {
      const parsedBody = JSON.parse(rawBody);
      detail = providerMessage(parsedBody);
      // OpenAI also answers 429 when credit or quota is spent; its docs say
      // retrying that does not restore access. Only the codes named there are
      // matched, on the code fields and not on free text: Google's ordinary
      // transient 429 says "check quota" in its message.
      const error = isObject(parsedBody?.error) ? parsedBody.error : {};
      outOfCredit = [error.code, error.type].some(
        (value) => value === "insufficient_quota" || value === "credit_balance_exhausted"
      );
    } catch {
      // Not JSON (proxy page, plain text). Keep short plain text, skip markup.
      const text = String(rawBody ?? "").trim();
      detail = text !== "" && !text.startsWith("<") ? text : "";
    }
    const extra = detail ? ` Provider said: ${detail}` : "";
    const details = { status, requestId: requestId(response.headers) };
    if (status === 401 || status === 403) {
      return fail("auth", `authentication or permission failed (HTTP ${status}); check ${keyEnv}.${extra}`, details);
    }
    if (status === 429) {
      // Number(null) is 0, so an absent header must be checked before parsing.
      const raw = response.headers?.get?.("retry-after");
      const parsed = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      const retryAfterSeconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
      const wait = retryAfterSeconds === undefined ? "" : `, retry after ${retryAfterSeconds}s`;
      return fail("rate_limit", `rate limited (HTTP 429${wait}).${extra}`, {
        ...details,
        retryAfterSeconds,
        retryable: !outOfCredit
      });
    }
    if (status >= 500) {
      return fail("server", `provider server error (HTTP ${status}).${extra}`, details);
    }
    return fail("bad_request", `request rejected (HTTP ${status}).${extra}`, details);
  }

  // Never forwards the error text of fetch: undici can echo header values.
  function transportFailure(error, signals) {
    const { deadline, caller } = signals;
    if (deadline.aborted) {
      return fail("timeout", `no answer within ${timeoutMs} ms`);
    }
    if (caller?.aborted) {
      return caller.reason?.name === "TimeoutError"
        ? fail("timeout", "the caller's deadline passed before an answer arrived")
        : fail("aborted", "the request was aborted by the caller");
    }
    const code = typeof error?.cause?.code === "string" ? ` (${error.cause.code})` : "";
    return fail("network", `could not reach ${new URL(adapter.url).host}${code}`);
  }

  async function generateJson({ system = "", prompt, format, signal } = {}) {
    if (!isNonEmptyString(prompt)) throw new TypeError("generateJson needs a non-empty prompt");
    if (!isObject(format) || !isNonEmptyString(format.name) || !isObject(format.schema)) {
      throw new TypeError("generateJson needs a format { name, schema }");
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    const signals = { deadline, caller: signal };

    let response;
    let rawBody;
    try {
      response = await doFetch(adapter.url, {
        method: "POST",
        headers: adapter.headers(apiKey),
        body: JSON.stringify(adapter.body({ model, system, prompt, format, maxOutputTokens })),
        redirect: "error",
        signal: combined
      });
      if (!response || typeof response.text !== "function") {
        throw fail("unreadable_response", "fetch returned something that is not a response");
      }
      rawBody = await response.text();
    } catch (error) {
      throw error instanceof ModelClientError ? error : transportFailure(error, signals);
    }

    if (!response.ok) throw httpFailure(response, rawBody);

    let envelope;
    try {
      envelope = JSON.parse(rawBody);
    } catch {
      throw fail(
        "unreadable_response",
        rawBody.trim() === "" ? "the response body is empty" : "the response body is not valid JSON",
        { status: response.status, requestId: requestId(response.headers) }
      );
    }
    const text = adapter.extract(envelope, (code, message) =>
      fail(code, message, { status: response.status, requestId: requestId(response.headers) })
    );

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw fail("unreadable_response", "the model output is not valid JSON (no prose or markdown fences allowed)");
    }
    if (!isObject(parsed)) {
      throw fail("unreadable_response", "the model output is JSON but not an object");
    }
    return parsed;
  }

  return Object.freeze({
    provider,
    model,
    async selectTopics({ system, prompt, signal } = {}) {
      const output = await generateJson({ system, prompt, format: SELECTION_FORMAT, signal });
      return checked(validateSelection, output);
    },
    async writeLesson({ system, prompt, signal } = {}) {
      const output = await generateJson({ system, prompt, format: LESSON_FORMAT, signal });
      return checked(validateLesson, output);
    }
  });
}

export function createModelClientFromEnv({ env = process.env, ...options } = {}) {
  const provider = String(env.HAL_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "") {
    throw configError(`HAL_PROVIDER is not set; expected one of ${Object.keys(ADAPTERS).join(", ")}`);
  }
  if (!Object.hasOwn(ADAPTERS, provider)) {
    throw configError(`HAL_PROVIDER is not supported; expected one of ${Object.keys(ADAPTERS).join(", ")}`);
  }
  const model = String(env.HAL_MODEL ?? "").trim();
  if (model === "") {
    throw configError("HAL_MODEL is not set", provider);
  }
  return createModelClient({ ...options, provider, model, apiKey: env[PROVIDER_KEY_ENV[provider]] });
}
