import { Duplex, Transform } from "stream";
import { ParserStream } from "./parser.js";
import { Plugin } from "./index.js";

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
  rebuildPipeline();

  function add(owner: Plugin["name"], transform: Transform) {
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

    if (buffered.length > 0) source.push(buffered);
    source.resume();
  }

  function remove(owner: Plugin["name"]): boolean {
    console.log(`[Pipeline] Removing '${owner}' transform factory`);
    const transform = transforms.get(owner);
    if (!transform) {
      // Let plugin call this multiple times so they can easily
      // use it in a cleanup fn that they call in multiple places
      return false;
    }

    source.pause();
    const buffered = sink.drain();

    transform.unpipe();
    transform.destroy();
    transforms.delete(owner);
    rebuildPipeline();

    if (buffered.length > 0) source.push(buffered);
    source.resume();
    return true;
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
