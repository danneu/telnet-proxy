import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createChunk, createParser } from "../src/telnet/parser.js";
import { TELNET } from "../src/telnet/index.js";

describe("Parser - Buffer Edge Cases", () => {
  test("handles data exactly at buffer boundary", () => {
    const parser = createParser({ maxBufferSize: 10 });

    // Fill buffer exactly
    parser.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    assert.equal(parser.bufferedLength(), 10);

    // Should throw on next byte
    assert.throws(() => parser.push(new Uint8Array([11])), {
      name: "ParserError",
      code: "BUFFER_OVERFLOW",
    });
  });

  test("compaction allows reusing buffer space", () => {
    const parser = createParser({ maxBufferSize: 10 });

    // Fill half the buffer
    parser.push(new Uint8Array([1, 2, 3, 4, 5]));

    // Consume it
    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([1, 2, 3, 4, 5])));

    assert.equal(parser.bufferedLength(), 0);

    // Should be able to fill entire buffer again
    parser.push(new Uint8Array([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    assert.equal(parser.bufferedLength(), 10);
  });

  test("partial consumption triggers compaction correctly", () => {
    const parser = createParser({ maxBufferSize: 10 });

    // Push: "ABC" + IAC + DO + ECHO
    parser.push(
      new Uint8Array([65, 66, 67, TELNET.IAC, TELNET.DO, TELNET.ECHO]),
    );

    // Consume text (3 bytes)
    let chunk = parser.next();
    assert.deepEqual(chunk, {
      type: "text",
      data: new Uint8Array([65, 66, 67]),
    });
    assert.equal(parser.bufferedLength(), 3); // IAC DO ECHO remains

    // Now push 7 more bytes - should trigger compaction
    parser.push(new Uint8Array([68, 69, 70, 71, 72, 73, 74])); // "DEFGHIJ"
    assert.equal(parser.bufferedLength(), 10);

    // Verify we can still parse the negotiation
    chunk = parser.next();
    assert.deepEqual(chunk, {
      type: "negotiation",
      verb: TELNET.DO,
      target: TELNET.ECHO,
    });
  });

  test("incomplete telnet sequence at buffer boundary", () => {
    const parser = createParser({ maxBufferSize: 10 });

    // Fill buffer with 8 bytes + incomplete IAC sequence
    parser.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, TELNET.IAC]));
    assert.equal(parser.bufferedLength(), 9);

    // Consume text
    const chunk = parser.next();
    assert.deepEqual(chunk, {
      type: "text",
      data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    assert.equal(parser.bufferedLength(), 1); // Just IAC remains

    // Complete the sequence - should trigger compaction
    parser.push(new Uint8Array([TELNET.NOP, 9, 10, 11, 12, 13, 14, 15]));
    assert.equal(parser.bufferedLength(), 9);
  });

  test("subnegotiation spanning multiple pushes with compaction", () => {
    const parser = createParser({ maxBufferSize: 20 });

    // Start subnegotiation
    parser.push(
      new Uint8Array([
        1,
        2,
        3,
        4,
        5, // text
        TELNET.IAC,
        TELNET.SB,
        TELNET.WINDOW_SIZE,
        1,
        2,
        3,
        4,
        5, // subneg data (incomplete)
      ]),
    );

    // Consume text to make room
    const chunk = parser.next();
    assert.deepEqual(chunk, {
      type: "text",
      data: new Uint8Array([1, 2, 3, 4, 5]),
    });

    // Continue subnegotiation - triggers compaction
    parser.push(new Uint8Array([6, 7, 8, 9, 10, TELNET.IAC, TELNET.SE]));

    // Should get complete subnegotiation
    const subChunk = parser.next();
    assert.deepEqual(
      subChunk,
      createChunk.subnegotiation(
        TELNET.WINDOW_SIZE,
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ),
    );
  });

  test("exactly maxBufferSize after compaction", () => {
    const parser = createParser({ maxBufferSize: 10 });

    // Push and consume to move bufPos
    parser.push(new Uint8Array([1, 2, 3]));
    parser.next(); // consume it

    // Push exactly 10 bytes - should trigger compaction and fit perfectly
    parser.push(new Uint8Array([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    assert.equal(parser.bufferedLength(), 10);
  });

  test("single push exceeding maxBufferSize", () => {
    const parser = createParser({ maxBufferSize: 10 });

    assert.throws(() => parser.push(new Uint8Array(11)), {
      name: "ParserError",
      code: "BUFFER_OVERFLOW",
    });
  });

  test("buffer state after overflow error", () => {
    const parser = createParser({ maxBufferSize: 10 });

    parser.push(new Uint8Array([1, 2, 3, 4, 5]));

    // This should throw
    assert.throws(() => parser.push(new Uint8Array([6, 7, 8, 9, 10, 11])), {
      name: "ParserError",
      code: "BUFFER_OVERFLOW",
    });

    // Buffer should be unchanged
    assert.equal(parser.bufferedLength(), 5);

    // Should still be able to consume existing data
    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([1, 2, 3, 4, 5])));
  });

  test("alternating push and consume at buffer limits", () => {
    const parser = createParser({ maxBufferSize: 5 });

    // Fill, consume partial, fill again - stress test compaction
    for (let i = 0; i < 10; i++) {
      parser.push(new Uint8Array([TELNET.IAC, TELNET.NOP, 65 + i])); // 3 bytes

      // Consume command
      let chunk = parser.next();
      assert.deepEqual(chunk, createChunk.command(TELNET.NOP));

      // Consume text
      chunk = parser.next();
      assert.deepEqual(chunk, createChunk.text(new Uint8Array([65 + i])));

      assert.equal(parser.bufferedLength(), 0);
    }
  });

  test("drain() after partial consumption", () => {
    const parser = createParser({ maxBufferSize: 10 });

    parser.push(new Uint8Array([1, 2, 3, TELNET.IAC, TELNET.NOP]));

    // Consume text only
    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([1, 2, 3])));

    // Drain should return the remaining command
    const drained = parser.drain();
    assert.deepEqual(drained, new Uint8Array([TELNET.IAC, TELNET.NOP]));
    assert.equal(parser.bufferedLength(), 0);
  });
});
