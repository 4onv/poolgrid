export const MAX_JSON_BYTES = 1024 * 1024;

/** JSON with duplicate-key rejection and bounded nesting. */
export function parseJson(text) {
  if (typeof text !== "string") throw new TypeError("JSON input must be text");
  if (
    text.length > MAX_JSON_BYTES ||
    new TextEncoder().encode(text).length > MAX_JSON_BYTES
  )
    throw new RangeError("JSON exceeds 1 MiB");
  let at = 0;
  function fail(message) {
    throw new SyntaxError(`${message} at character ${at + 1}`);
  }
  function space() {
    while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++;
  }
  function quoted() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === "\\") {
        at += 2;
        continue;
      }
      if (text[at++] === '"') {
        try {
          return JSON.parse(text.slice(start, at));
        } catch {
          fail("Invalid JSON string");
        }
      }
    }
    fail("Unterminated JSON string");
  }
  function value(depth) {
    if (depth > 24) fail("JSON nesting exceeds 24 levels");
    space();
    if (text[at] === '"') return quoted();
    if (text[at] === "{") {
      at++;
      const result = Object.create(null);
      const keys = new Set();
      space();
      if (text[at] === "}") {
        at++;
        return result;
      }
      while (at < text.length) {
        space();
        if (text[at] !== '"') fail("Expected an object key");
        const key = quoted();
        if (keys.has(key)) fail("Duplicate object key");
        keys.add(key);
        space();
        if (text[at++] !== ":") fail("Expected a colon");
        result[key] = value(depth + 1);
        space();
        if (text[at] === "}") {
          at++;
          return result;
        }
        if (text[at++] !== ",") fail("Expected a comma");
      }
      fail("Unterminated object");
    }
    if (text[at] === "[") {
      at++;
      const result = [];
      space();
      if (text[at] === "]") {
        at++;
        return result;
      }
      while (at < text.length) {
        result.push(value(depth + 1));
        space();
        if (text[at] === "]") {
          at++;
          return result;
        }
        if (text[at++] !== ",") fail("Expected a comma");
      }
      fail("Unterminated array");
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(at),
      );
    if (!token) fail("Expected a JSON value");
    at += token[0].length;
    const result = JSON.parse(token[0]);
    if (typeof result === "number" && !Number.isFinite(result))
      fail("Non-finite number");
    return result;
  }
  const result = value(0);
  space();
  if (at !== text.length) fail("Unexpected trailing data");
  return result;
}
