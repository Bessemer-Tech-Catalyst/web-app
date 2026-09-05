import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_EXPR,
  credentialsBriefing,
  redactPassword,
} from "./credentials.ts";

test("a double-quoted password becomes an environment read", () => {
  const { code, count, residual } = redactPassword(
    'await page.getByLabel("Password").fill("lovelace");',
    "lovelace",
  );
  assert.equal(code, `await page.getByLabel("Password").fill(${PASSWORD_EXPR});`);
  assert.equal(count, 1);
  assert.equal(residual, false);
});

test("single quotes and backticks are rewritten too, and every occurrence counts", () => {
  const { code, count } = redactPassword(
    "fill('hunter2'); fill(`hunter2`); fill(\"hunter2\");",
    "hunter2",
  );
  assert.equal(count, 3);
  assert.ok(!code.includes("hunter2"));
});

test("a password buried in a longer literal is left alone and flagged, not spliced", () => {
  const { code, count, residual } = redactPassword(
    'await page.fill("#p", "prefix-lovelace-suffix");',
    "lovelace",
  );
  assert.equal(count, 0);
  assert.equal(residual, true, "the caller has to be told the literal survived");
  assert.ok(code.includes("prefix-lovelace-suffix"), "the rewrite must not corrupt the string");
});

test("a test that never mentions the password is returned untouched", () => {
  const src = 'await expect(page.getByRole("heading")).toHaveText("Sign in");';
  const { code, count, residual } = redactPassword(src, "lovelace");
  assert.equal(code, src);
  assert.equal(count, 0);
  assert.equal(residual, false);
});

test("an empty password is a no-op rather than a regex that matches everything", () => {
  const src = 'await page.click("button");';
  assert.deepEqual(redactPassword(src, ""), { code: src, count: 0, residual: false });
});

test("a password containing regex metacharacters is matched literally", () => {
  const { count } = redactPassword('fill("a.b*c$");', "a.b*c$");
  assert.equal(count, 1);
});

test("the briefing names the username and tells the agent where the password goes", () => {
  const lines = credentialsBriefing({ username: "ada@shoplite.test", password: "lovelace" }).join("\n");
  assert.match(lines, /ada@shoplite\.test/);
  assert.match(lines, /lovelace/, "the agent needs the value to type it into the live page");
  assert.ok(lines.includes(PASSWORD_EXPR), "and it needs to know what to write instead");
});

test("with no credentials the briefing tells the agent to quarantine rather than invent", () => {
  const lines = credentialsBriefing(undefined).join("\n");
  assert.match(lines, /quarantine/i);
});
