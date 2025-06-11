import { Transform } from "stream";
import { createParser, ParserConfig } from "./parser.js";

export type ParserStream = Transform & {
  drain: () => Uint8Array;
};

export function createParserStream(config: ParserConfig = {}): ParserStream {
  const parser = createParser(config);
  const stream = new Transform({
    objectMode: true,
    // TODO: Custom flush?
    // flush() {},
    transform(data, _, done) {
      try {
        parser.push(data);
        let chunk;
        while ((chunk = parser.next())) {
          this.push(chunk);
        }
        done();
      } catch (e) {
        done(e as Error);
      }
    },
    /*
    const stream = new Transform({
  transform(chunk, encoding, callback) {
    // Process each chunk
    callback();
  },
  flush(callback) {
    // Called ONCE at the very end
    // This is where you handle any buffered/incomplete data
    callback();
  }
});

// flush is called in these scenarios:

// 1. When source stream ends
sourceStream.pipe(stream); // flush called when sourceStream ends

// 2. When explicitly ending
stream.write(data);
stream.end(); // flush called here

// 3. When piping and source ends
readableStream
  .pipe(stream)
  .pipe(writableStream); // flush called when readableStream ends
    */
    flush(done) {
      // TODO: Ask about this
      console.log("parserStream flush");

      // Handle any remaining data in buffer
      const remaining = parser.drain();
      if (remaining.length > 0) {
        this.emit(
          "warning",
          `Unparsed data at end of stream: ${remaining.length} bytes`,
        );
      }
      done();
    },
  }) as ParserStream;

  stream.drain = () => parser.drain();

  return stream;
}
