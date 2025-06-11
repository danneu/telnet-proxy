import { Duplex, Transform } from "stream";
import { Plugin } from "./index.js";
import { ParserStream } from "./telnet/index.js";

// Pipeline Manager - Safely modify a stream pipeline while data is flowing
//
// Manages dynamic insertion/removal of transforms between a telnet socket and parser.
// Critical for protocols like MCCP2 that start compression mid-stream.
//
// The Challenge:
// When MCCP2 compression starts, the parser has already buffered some compressed bytes.
// We must insert a decompressor and replay those bytes through it.
//
// The Solution:
// 1. Pause the socket (stops new data from being read from OS buffer)
// 2. Drain buffered data from the parser
// 3. Rebuild the pipeline with new transforms
// 4. Replay the drained data through the new pipeline
// 5. Resume the socket (begins reading from OS buffer)
//
// MCCP2 Example Flow:
// 1. Parser processes: IAC SB MCCP2 IAC SE (uncompressed subnegotiation)
// 2. Parser's buffer may contain: [compressed_byte_1, compressed_byte_2, ...]
// 3. MCCP2 plugin calls add() to insert zlib decompressor
// 4. We must replay buffered compressed data through the new decompressor
//
// All operations are executed atommimcally to prevent overlapping pause/resume cycles.

export type PipelineManager = ReturnType<typeof createPipelineManager>;

export type PipelineAPI = {
  add(owner: Plugin["name"], transform: Transform): void;
  remove(owner: Plugin["name"]): boolean;
};

export function createPipelineManager(
  source: Duplex,
  sink: ParserStream,
  onTransformError: (owner: Plugin["name"], error: Error) => void,
): PipelineAPI {
  const transforms = new Map<Plugin["name"], Transform>();
  let pipelineOperationInProgress = false;
  const pendingOperations: (() => void)[] = [];

  rebuildPipeline();

  // Execute operations atomically to avoid overlapping pause/resume cycles
  function executeWithLock(operation: () => void) {
    if (pipelineOperationInProgress) {
      pendingOperations.push(operation);
      return;
    }

    pipelineOperationInProgress = true;
    try {
      operation();
    } finally {
      pipelineOperationInProgress = false;
      processQueue();
    }
  }

  function processQueue() {
    if (pendingOperations.length === 0 || pipelineOperationInProgress) {
      return;
    }
    // Process all operations as one atomic batch
    pipelineOperationInProgress = true;
    try {
      while (pendingOperations.length > 0) {
        const next = pendingOperations.shift();
        if (next) next();
      }
    } finally {
      pipelineOperationInProgress = false;
    }
  }

  function add(owner: Plugin["name"], transform: Transform) {
    executeWithLock(() => {
      console.log(`[Pipeline] Adding '${owner}' transform factory`);
      if (transforms.has(owner)) {
        console.error(
          `[Pipeline] Plugin '${owner}' tried to add transform, but it already exists`,
        );
        return;
      }

      transform.on("error", (e) => {
        console.error(`[Pipeline] Transform '${owner}' error`, e);
        onTransformError(owner, e);
      });

      source.pause();
      const buffered = sink.drain();

      transforms.set(owner, transform);
      rebuildPipeline();

      // replay drained data back into the source first
      // - it will be processed before any new socket data
      if (buffered.length > 0) source.push(buffered);
      source.resume();
    });
  }

  function remove(owner: Plugin["name"]): boolean {
    let result = false;
    executeWithLock(() => {
      console.log(`[Pipeline] Removing '${owner}' transform factory`);
      const transform = transforms.get(owner);
      if (!transform) {
        // Let plugin call this multiple times so they can easily
        // use it in a cleanup fn that they call in multiple places
        return;
      }

      source.pause();
      const buffered = sink.drain();

      transform.end(); // flush any remaining data (and emit 'finish')
      transform.unpipe();
      transform.destroy();
      transforms.delete(owner);
      rebuildPipeline();

      // replay drained data back into the source first
      // - it will be processed before any new socket data
      if (buffered.length > 0) source.push(buffered);
      source.resume();
      result = true;
    });
    return result;
  }

  function rebuildPipeline() {
    // Unpipe everything so we can rewire them
    source.unpipe();
    for (const transform of transforms.values()) {
      transform.unpipe();
    }

    // Rebuild pipeline
    let current: NodeJS.ReadableStream = source;
    for (const transform of transforms.values()) {
      current = current.pipe(transform);
    }
    current.pipe(sink);

    console.log(`[Pipeline] Rebuilt: ${printPipeline()}`);
  }

  function printPipeline(): string {
    const transformNames = Array.from(transforms.keys());
    return transformNames.length === 0
      ? "source -> sink"
      : "source -> " + transformNames.join(" -> ") + " -> sink";
  }

  return { add, remove };
}
