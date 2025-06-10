import { PluginFactory } from "../index.js";

const defaultMessage = new TextEncoder().encode(" \b");

// Send data to server to avoid idle timeout
const heartbeat: PluginFactory<
  {
    interval?: number;
    message?: Uint8Array;
  } | void
> = (config) => (ctx) => {
  const { interval = 5_000, message = defaultMessage } = config ?? {};

  let timeout = setTimeout(sendHeartbeat, interval);

  function sendHeartbeat() {
    // console.log("sending heartbeat to ", options.host, ":", options.port);

    // :: Cyberlife game seems to have problem with my next command after the IAC NOP heartbeat
    // console.log("[heartbeat] sending NOP");
    // telnet.write(Uint8Array.from([Cmd.IAC, Cmd.NOP]));

    // :: This seems to work better for Cyberlife. but not sure it actually works to keep conn alive
    // console.log("[heartbeat] sending <space><backspace>");
    ctx.sendToServer(message);
    timeout = setTimeout(sendHeartbeat, interval);
  }

  return {
    name: "heartbeat",
    onClientMessage: () => {
      // console.log("Heartbeat plugin onClientMessage");
      clearTimeout(timeout);
      timeout = setTimeout(sendHeartbeat, interval);
      return { type: "continue" };
    },
    onClose: () => {
      console.log("Heartbeat plugin closing");
      clearTimeout(timeout);
    },
  };
};

export default heartbeat;
