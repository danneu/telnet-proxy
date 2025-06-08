// plugin-types.ts
import { Transform, Duplex } from "stream";
import { Chunk } from "../parser.js";

export type PluginContext = {
  // Send data to the telnet server
  sendToServer(data: Uint8Array): void;

  // Send text to the websocket client
  sendToClient(text: string): void;

  // Get/set connection options
  options: Record<string, any>;

  // Pipeline management
  pipeline: {
    // Add a transform to the pipeline, returns removal function
    add(transform: Transform | Duplex): () => void;

    // Check if a transform is in the pipeline
    has(transform: Transform | Duplex): boolean;

    // Get current pipeline state (for debugging)
    inspect(): string[];
  };
};

type ClientMessageResult =
  // Plugin handled the message so no other plugins should
  | { type: "handled" }
  | { type: "continue" }
  | { type: "transform"; data: Uint8Array };

export type PluginReturn = {
  name: string;

  // Called when plugin is initialized
  init?(context: PluginContext): void;

  // Called for each chunk from server
  // Return true to indicate chunk was handled (stop processing)
  onServerChunk?(chunk: Chunk, context: PluginContext): boolean | void;

  // Called for each message from client
  // Return null to consume, Uint8Array to transform, void to pass through
  onClientMessage?(
    data: Uint8Array,
    context: PluginContext,
  ): ClientMessageResult;

  // Called when connection closes
  onClose?(): void;
};

export type Plugin<T> = (config: T) => (ctx: PluginContext) => PluginReturn;
