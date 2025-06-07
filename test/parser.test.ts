import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Parser, Cmd, type Chunk } from "../src/parser.ts";

// Type predicate to check if chunk is a subnegotiation
function isSBChunk(
  chunk: Chunk | null,
): chunk is Extract<Chunk, { name: "SB" }> {
  return chunk?.type === "NEGOTIATION" && chunk.name === "SB";
}

describe("Parser subnegotiation handling", () => {
  test("parses simple subnegotiation without IAC in data", () => {
    const parser = new Parser();

    // IAC SB MCCP2 <data: 1 2 3> IAC SE
    parser.push(
      new Uint8Array([Cmd.IAC, Cmd.SB, Cmd.MCCP2, 1, 2, 3, Cmd.IAC, Cmd.SE]),
    );

    const chunk = parser.next();
    assert(isSBChunk(chunk), "Expected SB chunk");
    assert.equal(chunk.target, Cmd.MCCP2);
    assert.deepEqual(chunk.data, new Uint8Array([1, 2, 3]));
  });

  test("handles escaped IAC bytes in subnegotiation data", () => {
    const parser = new Parser();

    // IAC SB 86 <data: 1 2 255 3 4> IAC SE
    // Wire format needs IAC IAC for the 255 byte
    parser.push(
      new Uint8Array([
        Cmd.IAC,
        Cmd.SB,
        86,
        1,
        2,
        Cmd.IAC,
        Cmd.IAC,
        3,
        4,
        Cmd.IAC,
        Cmd.SE,
      ]),
    );

    const chunk = parser.next();
    assert(isSBChunk(chunk), "Expected SB chunk");
    assert.equal(chunk.target, 86);
    assert.deepEqual(chunk.data, new Uint8Array([1, 2, 255, 3, 4]));
  });

  test("handles multiple escaped IAC bytes", () => {
    const parser = new Parser();

    // Data should be: [255, 255, 100, 255]
    parser.push(
      new Uint8Array([
        Cmd.IAC,
        Cmd.SB,
        50,
        Cmd.IAC,
        Cmd.IAC, // First 255
        Cmd.IAC,
        Cmd.IAC, // Second 255
        100, // Regular byte
        Cmd.IAC,
        Cmd.IAC, // Third 255
        Cmd.IAC,
        Cmd.SE,
      ]),
    );

    const chunk = parser.next();
    assert(isSBChunk(chunk), "Expected SB chunk");
    assert.deepEqual(chunk.data, new Uint8Array([255, 255, 100, 255]));
  });

  test("returns null for incomplete subnegotiation", () => {
    const parser = new Parser();

    // Missing IAC SE terminator
    parser.push(new Uint8Array([Cmd.IAC, Cmd.SB, Cmd.MCCP2, 1, 2, 3]));

    const chunk = parser.next();
    assert.equal(chunk, null);

    // Now add the terminator
    parser.push(new Uint8Array([Cmd.IAC, Cmd.SE]));

    const completeChunk = parser.next();
    assert(isSBChunk(completeChunk), "Expected SB chunk");
    assert.deepEqual(completeChunk.data, new Uint8Array([1, 2, 3]));
  });

  test("handles incomplete escaped IAC at buffer boundary", () => {
    const parser = new Parser();

    // First part ends with IAC
    parser.push(new Uint8Array([Cmd.IAC, Cmd.SB, 100, 1, 2, Cmd.IAC]));

    let chunk = parser.next();
    assert.equal(chunk, null); // Incomplete - could be IAC IAC or IAC SE

    // Add second IAC (making it escaped IAC) and more data
    parser.push(new Uint8Array([Cmd.IAC, 3, 4, Cmd.IAC, Cmd.SE]));

    chunk = parser.next();
    assert(isSBChunk(chunk), "Expected SB chunk");
    assert.deepEqual(chunk.data, new Uint8Array([1, 2, 255, 3, 4]));
  });

  test("empty subnegotiation data", () => {
    const parser = new Parser();

    // IAC SB ECHO IAC SE (no data)
    parser.push(new Uint8Array([Cmd.IAC, Cmd.SB, Cmd.ECHO, Cmd.IAC, Cmd.SE]));

    const chunk = parser.next();
    assert(isSBChunk(chunk), "Expected SB chunk");
    assert.equal(chunk.target, Cmd.ECHO);
    assert.deepEqual(chunk.data, new Uint8Array([]));
  });

  test("preserves buffer for other commands after incomplete SB", () => {
    const parser = new Parser();

    // Incomplete SB followed by a complete WILL command
    parser.push(
      new Uint8Array([
        Cmd.IAC,
        Cmd.SB,
        100,
        1,
        2, // Incomplete SB
        Cmd.IAC,
        Cmd.WILL,
        Cmd.ECHO, // Complete WILL
      ]),
    );

    // First should return null (incomplete SB)
    let chunk = parser.next();
    assert.equal(chunk, null);

    // Buffer should still contain everything
    assert.equal(parser.buf.length, 8);

    // Now complete the SB
    parser.buf.splice(5, 0, Cmd.IAC, Cmd.SE); // Insert IAC SE after position 5

    // Should now parse the SB
    chunk = parser.next();
    assert(isSBChunk(chunk), "Expected SB chunk");
    assert.deepEqual(chunk.data, new Uint8Array([1, 2]));

    // And then parse the WILL
    chunk = parser.next();
    assert.equal(chunk?.type, "NEGOTIATION");
    assert.equal(chunk?.name, "WILL");
    assert.equal(chunk?.target, Cmd.ECHO);
  });
});
