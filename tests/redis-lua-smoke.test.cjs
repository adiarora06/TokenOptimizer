const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const net = require("node:net");

const { REDIS_SCRIPTS } = require("../shared-request-guard.cjs");

const target = process.env.TOKEN_OPTIMIZER_REDIS_SMOKE_URL;
if (!target) {
  console.log("Redis Lua smoke tests skipped (set TOKEN_OPTIMIZER_REDIS_SMOKE_URL to a local Redis 7 instance)");
  process.exit(0);
}

const url = new URL(target);
if (url.protocol !== "redis:") throw new Error("Redis smoke URL must use redis://");
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  throw new Error("Redis Lua smoke tests are intentionally restricted to a local disposable instance");
}

class IncompleteReply extends Error {}

function lineEnd(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end === -1) throw new IncompleteReply();
  return end;
}

function parseReply(buffer, offset = 0) {
  if (offset >= buffer.length) throw new IncompleteReply();
  const type = String.fromCharCode(buffer[offset]);
  const start = offset + 1;
  if (["+", "-", ":"].includes(type)) {
    const end = lineEnd(buffer, start);
    const text = buffer.subarray(start, end).toString("utf8");
    if (type === "-") throw new Error(`Redis command failed: ${text}`);
    return { value: type === ":" ? Number(text) : text, offset: end + 2 };
  }
  if (type === "$") {
    const end = lineEnd(buffer, start);
    const size = Number(buffer.subarray(start, end).toString("utf8"));
    if (size === -1) return { value: null, offset: end + 2 };
    const valueStart = end + 2;
    const valueEnd = valueStart + size;
    if (buffer.length < valueEnd + 2) throw new IncompleteReply();
    return { value: buffer.subarray(valueStart, valueEnd).toString("utf8"), offset: valueEnd + 2 };
  }
  if (type === "*") {
    const end = lineEnd(buffer, start);
    const count = Number(buffer.subarray(start, end).toString("utf8"));
    if (count === -1) return { value: null, offset: end + 2 };
    const values = [];
    let cursor = end + 2;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseReply(buffer, cursor);
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  throw new Error(`Unsupported Redis reply type: ${type}`);
}

function encodeCommand(parts) {
  const buffers = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const value = Buffer.from(String(part), "utf8");
    buffers.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(buffers);
}

function command(parts) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 6379) });
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Redis smoke command timed out"));
    }, 5_000);
    socket.on("connect", () => socket.write(encodeCommand(parts)));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseReply(buffer);
        clearTimeout(timeout);
        socket.end();
        resolve(parsed.value);
      } catch (error) {
        if (!(error instanceof IncompleteReply)) {
          clearTimeout(timeout);
          socket.destroy();
          reject(error);
        }
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function evaluate(script, keys, args) {
  return command(["EVAL", script, keys.length, ...keys, ...args]);
}

async function run() {
  const serverInfo = await command(["INFO", "server"]);
  const version = /^redis_version:([^\r\n]+)/m.exec(serverInfo)?.[1];
  assert.ok(version, "Redis server version was not reported");
  assert.ok(Number(version.split(".")[0]) >= 7, `Redis 7+ is required; received ${version}`);

  const id = crypto.randomBytes(10).toString("hex");
  const tag = `{tokopt-smoke-${id}}`;
  const keys = {
    rate: `smoke:${tag}:rate`,
    rateIndex: `smoke:${tag}:rate-index`,
    concurrency: `smoke:${tag}:concurrency`,
    budget: `smoke:${tag}:budget`,
    reservation: `smoke:${tag}:reservation`,
    idempotency: `smoke:${tag}:idempotency`,
    idempotencyTombstone: `smoke:${tag}:idempotency-tombstone`,
    idempotencyIndex: `smoke:${tag}:idempotency-index`
  };
  const cleanup = Object.values(keys);

  try {
    const rate = await evaluate(REDIS_SCRIPTS.rate, [keys.rate, keys.rateIndex], [1_000, 1, 10]);
    assert.equal(rate[0], 1);
    assert.equal((await evaluate(REDIS_SCRIPTS.rate, [keys.rate, keys.rateIndex], [1_000, 1, 10]))[0], 0);

    const owner = `owner-${id}`;
    assert.equal((await evaluate(REDIS_SCRIPTS.concurrencyAcquire, [keys.concurrency], [1, 5_000, owner]))[0], 1);
    assert.equal((await evaluate(REDIS_SCRIPTS.concurrencyAcquire, [keys.concurrency], [1, 5_000, owner]))[0], 2);
    assert.equal(await evaluate(REDIS_SCRIPTS.concurrencyRenew, [keys.concurrency], [5_000, owner]), 1);
    assert.equal(await evaluate(REDIS_SCRIPTS.concurrencyRelease, [keys.concurrency], [owner]), 1);

    const budgetTime = await evaluate(REDIS_SCRIPTS.budgetTime, [], []);
    const day = Number(budgetTime[0]);
    const resetAt = Number(budgetTime[1]);
    const reserved = await evaluate(
      REDIS_SCRIPTS.budgetReserve,
      [keys.budget, keys.reservation],
      [1, 50, 2, 100, resetAt + 86_400_000, day]
    );
    assert.equal(reserved[0], 1);
    assert.equal((await evaluate(
      REDIS_SCRIPTS.budgetReserve,
      [keys.budget, keys.reservation],
      [1, 50, 2, 100, resetAt + 86_400_000, day]
    ))[0], 2);
    assert.equal((await evaluate(REDIS_SCRIPTS.budgetSettle, [keys.budget, keys.reservation], [30]))[0], 1);
    assert.equal((await evaluate(REDIS_SCRIPTS.budgetSettle, [keys.budget, keys.reservation], [30]))[0], 2);

    const fingerprint = `fingerprint-${id}`;
    assert.equal((await evaluate(
      REDIS_SCRIPTS.idempotencyClaim,
      [keys.idempotency, keys.idempotencyIndex],
      [fingerprint, owner, 10_000, 10]
    ))[0], "started");
    assert.equal((await evaluate(
      REDIS_SCRIPTS.idempotencyClaim,
      [keys.idempotency, keys.idempotencyIndex],
      [fingerprint, owner, 10_000, 10]
    ))[0], "started");
    assert.equal(await evaluate(
      REDIS_SCRIPTS.idempotencyRenew,
      [keys.idempotency, keys.idempotencyIndex],
      [owner, 10_000]
    ), 1);
    assert.equal(await evaluate(
      REDIS_SCRIPTS.idempotencyComplete,
      [keys.idempotency, keys.idempotencyIndex],
      [owner, "encrypted-result", 10_000, "completed"]
    ), 1);
    assert.equal(await evaluate(
      REDIS_SCRIPTS.idempotencyComplete,
      [keys.idempotency, keys.idempotencyIndex],
      [owner, "encrypted-result", 10_000, "completed"]
    ), 2);
    assert.deepEqual(await evaluate(
      REDIS_SCRIPTS.idempotencyClaim,
      [keys.idempotency, keys.idempotencyIndex],
      [fingerprint, "other-owner", 10_000, 10]
    ), ["completed", "encrypted-result"]);

    const tombstoneOwner = `tombstone-${id}`;
    assert.equal((await evaluate(
      REDIS_SCRIPTS.idempotencyClaim,
      [keys.idempotencyTombstone, keys.idempotencyIndex],
      [`tombstone-fingerprint-${id}`, tombstoneOwner, 10_000, 10]
    ))[0], "started");
    assert.equal(await evaluate(
      REDIS_SCRIPTS.idempotencyComplete,
      [keys.idempotencyTombstone, keys.idempotencyIndex],
      [tombstoneOwner, "", 10_000, "tombstone"]
    ), 1);
    assert.equal((await evaluate(
      REDIS_SCRIPTS.idempotencyClaim,
      [keys.idempotencyTombstone, keys.idempotencyIndex],
      [`tombstone-fingerprint-${id}`, "other-owner", 10_000, 10]
    ))[0], "tombstone");

    console.log("Redis Lua smoke tests passed against a real Redis instance");
  } finally {
    await command(["DEL", ...cleanup]).catch(() => {});
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
