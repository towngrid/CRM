import test from "node:test";
import assert from "node:assert/strict";
import { isOutreachSendingEnabled } from "./appConfig";
import { sendSequenceEmail } from "./sendgrid";

function withSwitch(value: string | undefined, fn: () => unknown) {
  const old = process.env.ENABLE_OUTREACH_SENDING;
  if (value === undefined) delete process.env.ENABLE_OUTREACH_SENDING;
  else process.env.ENABLE_OUTREACH_SENDING = value;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.ENABLE_OUTREACH_SENDING;
    else process.env.ENABLE_OUTREACH_SENDING = old;
  }
}

test("outreach sending is off unless the switch is exactly on", () => {
  for (const value of [undefined, "", "off", "OFF", "true", "1", "yes"]) {
    withSwitch(value, () => assert.equal(isOutreachSendingEnabled(), false, `value ${value}`));
  }
  withSwitch("on", () => assert.equal(isOutreachSendingEnabled(), true));
  withSwitch(" On ", () => assert.equal(isOutreachSendingEnabled(), true));
});

test("sequence emails are blocked before anything is sent while the switch is off", async () => {
  const old = process.env.ENABLE_OUTREACH_SENDING;
  process.env.ENABLE_OUTREACH_SENDING = "off";
  try {
    const result = await sendSequenceEmail({
      contact: { id: "c1", email: "someone@example.com" } as any,
      salesperson: { id: "u1", email: "seller@example.com" } as any,
      sequence: { subject: "Hi", body: "Hello" } as any,
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Outreach sending is off/);
  } finally {
    if (old === undefined) delete process.env.ENABLE_OUTREACH_SENDING;
    else process.env.ENABLE_OUTREACH_SENDING = old;
  }
});
