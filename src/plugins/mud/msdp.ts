import { PluginFactory } from "../../index.js";
import { TELNET } from "../../telnet/index.js";

// FIXME: Untested, unused

// MSDP specific commands
const MSDP_VAR = 1;
const MSDP_VAL = 2;
const MSDP_TABLE_OPEN = 3;
const MSDP_TABLE_CLOSE = 4;
const MSDP_ARRAY_OPEN = 5;
const MSDP_ARRAY_CLOSE = 6;

type MSDPValue = string | number | boolean | MSDPTable | MSDPArray;
type MSDPTable = { [key: string]: MSDPValue };
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MSDPArray extends Array<MSDPValue> {} // Get around circular dep error

interface MSDPConfig {
  negotiate: "accept" | "reject";
  // Callback when MSDP variables are received
  onVariable?: (name: string, value: MSDPValue) => void;
  // Variables to report automatically
  autoReport?: string[];
  // Client info to send to server
  clientName?: string;
  clientVersion?: string;
}

const msdp: PluginFactory<MSDPConfig> = (config) => (ctx) => {
  const {
    negotiate,
    onVariable,
    autoReport = [],
    clientName = "github.com/danneu/solid-mud-client",
    clientVersion = "0.0.1",
  } = config;

  let msdpEnabled = false;

  // Helper to send MSDP commands
  const sendMSDPCommand = (varName: string, value: string | string[]) => {
    const bytes: number[] = [TELNET.IAC, TELNET.SB, TELNET.MSDP, MSDP_VAR];

    // Add variable name
    for (const char of varName) {
      bytes.push(char.charCodeAt(0));
    }

    bytes.push(MSDP_VAL);

    // Handle array of values (for commands like REPORT)
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (i > 0) bytes.push(MSDP_VAL);
        for (const char of value[i]) {
          bytes.push(char.charCodeAt(0));
        }
      }
    } else {
      // Single value
      for (const char of value) {
        bytes.push(char.charCodeAt(0));
      }
    }

    bytes.push(TELNET.IAC, TELNET.SE);
    ctx.sendToServer(Uint8Array.from(bytes));
  };

  // Handle initial MSDP handshake completion
  const onMSDPEnabled = () => {
    msdpEnabled = true;
    console.log("[MSDP] Enabled, requesting commands list");

    // Request list of available commands
    sendMSDPCommand("LIST", "COMMANDS");

    // Send client information
    if (clientName) {
      sendMSDPCommand("CLIENT_NAME", clientName);
    }
    if (clientVersion) {
      sendMSDPCommand("CLIENT_VERSION", clientVersion);
    }
  };

  // Handle received MSDP variable
  const handleMSDPVariable = (name: string, value: MSDPValue) => {
    console.log("[MSDP] Received variable:", name, "=", value);

    // Handle specific variables
    switch (name) {
      case "COMMANDS":
        // Server sent list of supported commands
        if (Array.isArray(value)) {
          console.log("[MSDP] Server supports commands:", value);
          // Request reportable variables if LIST is supported
          if (value.includes("LIST")) {
            sendMSDPCommand("LIST", "REPORTABLE_VARIABLES");
          }
        }
        break;

      case "REPORTABLE_VARIABLES":
        // Server sent list of reportable variables
        if (Array.isArray(value)) {
          console.log("[MSDP] Server can report:", value);
          // Auto-report requested variables
          const toReport = autoReport.filter((v) => value.includes(v));
          if (toReport.length > 0) {
            sendMSDPCommand("REPORT", toReport);
          }
        }
        break;
    }

    // Call user callback
    if (onVariable) {
      onVariable(name, value);
    }
  };

  return {
    name: "msdp",

    onServerChunk: (chunk) => {
      // Handle WILL MSDP negotiation
      if (
        chunk.type === "negotiation" &&
        chunk.verb === TELNET.WILL &&
        chunk.target === TELNET.MSDP
      ) {
        if (negotiate === "accept") {
          console.log("[MSDP] Server offers MSDP, accepting");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.DO, TELNET.MSDP]),
          );
          onMSDPEnabled();
        } else {
          console.log("[MSDP] Server offers MSDP, refusing");
          ctx.sendToServer(
            Uint8Array.from([TELNET.IAC, TELNET.DONT, TELNET.MSDP]),
          );
        }
        return { type: "handled" };
      }

      // Handle MSDP subnegotiation
      if (chunk.type === "subnegotiation" && chunk.target === TELNET.MSDP) {
        // Parse MSDP data from the subnegotiation
        const parsed = parseMSDPData(chunk.data);
        if (parsed) {
          handleMSDPVariable(parsed.name, parsed.value);
        }

        return { type: "handled" };
      }

      return { type: "continue" };
    },

    // Expose methods for manual control
    api: {
      sendCommand: sendMSDPCommand,

      report: (variables: string[]) => {
        if (msdpEnabled) {
          sendMSDPCommand("REPORT", variables);
        }
      },

      unreport: (variables: string[]) => {
        if (msdpEnabled) {
          sendMSDPCommand("UNREPORT", variables);
        }
      },

      send: (variables: string[]) => {
        if (msdpEnabled) {
          sendMSDPCommand("SEND", variables);
        }
      },

      list: (what: string) => {
        if (msdpEnabled) {
          sendMSDPCommand("LIST", what);
        }
      },

      reset: (what: string) => {
        if (msdpEnabled) {
          sendMSDPCommand("RESET", what);
        }
      },
    },
  };
};

export default msdp;

// Parse MSDP subnegotiation data
function parseMSDPData(
  data: Uint8Array,
): { name: string; value: MSDPValue } | null {
  const arr = Array.from(data);
  let i = 0;

  // Expect MSDP_VAR
  if (arr[i] !== MSDP_VAR) return null;
  i++;

  // Read variable name
  let varName = "";
  while (i < arr.length && arr[i] !== MSDP_VAL) {
    varName += String.fromCharCode(arr[i]);
    i++;
  }

  // Skip MSDP_VAL
  if (arr[i] !== MSDP_VAL) return null;
  i++;

  // Parse value
  const value = parseMSDPValue(arr, i);

  return { name: varName, value: value.value };
}

// Parse an MSDP value (string, table, or array)
function parseMSDPValue(
  data: number[],
  start: number,
): { value: MSDPValue; nextIndex: number } {
  let i = start;

  if (i >= data.length) {
    return { value: "", nextIndex: i };
  }

  // Check for table
  if (data[i] === MSDP_TABLE_OPEN) {
    i++;
    const table: MSDPTable = {};

    while (i < data.length && data[i] !== MSDP_TABLE_CLOSE) {
      // Expect MSDP_VAR
      if (data[i] !== MSDP_VAR) break;
      i++;

      // Read key
      let key = "";
      while (i < data.length && data[i] !== MSDP_VAL) {
        key += String.fromCharCode(data[i]);
        i++;
      }

      // Skip MSDP_VAL
      if (data[i] !== MSDP_VAL) break;
      i++;

      // Parse value
      const result = parseMSDPValue(data, i);
      table[key] = result.value;
      i = result.nextIndex;
    }

    // Skip MSDP_TABLE_CLOSE
    if (i < data.length && data[i] === MSDP_TABLE_CLOSE) i++;

    return { value: table, nextIndex: i };
  }

  // Check for array
  if (data[i] === MSDP_ARRAY_OPEN) {
    i++;
    const array: MSDPArray = [];

    while (i < data.length && data[i] !== MSDP_ARRAY_CLOSE) {
      // Expect MSDP_VAL
      if (data[i] !== MSDP_VAL) break;
      i++;

      // Parse value
      const result = parseMSDPValue(data, i);
      array.push(result.value);
      i = result.nextIndex;
    }

    // Skip MSDP_ARRAY_CLOSE
    if (i < data.length && data[i] === MSDP_ARRAY_CLOSE) i++;

    return { value: array, nextIndex: i };
  }

  // Parse simple string value
  let value = "";
  while (
    i < data.length &&
    data[i] !== MSDP_VAR &&
    data[i] !== MSDP_VAL &&
    data[i] !== MSDP_TABLE_CLOSE &&
    data[i] !== MSDP_ARRAY_CLOSE &&
    data[i] !== TELNET.IAC
  ) {
    value += String.fromCharCode(data[i]);
    i++;
  }

  return { value, nextIndex: i };
}
