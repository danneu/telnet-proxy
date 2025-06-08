import { PluginFactory, PluginReturn } from "../index.js";

// Send data to server to avoid idle timeout
const heartbeat: PluginFactory<{
  interval: number;
}> =
  ({ interval }) =>
  (ctx) => {
    let timeout = setTimeout(sendHeartbeat, interval);

    function sendHeartbeat() {
      // console.log("sending heartbeat to ", options.host, ":", options.port);

      // :: Cyberlife game seems to have problem with my next command after the IAC NOP heartbeat
      // console.log("[heartbeat] sending NOP");
      // telnet.write(Uint8Array.from([Cmd.IAC, Cmd.NOP]));

      // :: This seems to work better for Cyberlife. but not sure it actually works to keep conn alive
      console.log("[heartbeat] sending <space><backspace>");
      ctx.sendToServer(Buffer.from(" \b"));
      timeout = setTimeout(sendHeartbeat, interval);
    }

    const ret: PluginReturn = {
      name: "heartbeat",
      onClientMessage: () => {
        console.log("Heartbeat plugin onClientMessage");
        clearTimeout(timeout);
        timeout = setTimeout(sendHeartbeat, interval);
        return { type: "continue" };
      },
      onClose: () => {
        console.log("Heartbeat plugin closing");
        clearTimeout(timeout);
      },
    };
    return ret;
  };

export default heartbeat;
