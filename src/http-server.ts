import * as http from "http";
import * as ws from "ws";

export function createHttpServer(server: ws.WebSocketServer): http.Server {
  return http.createServer((req, res) => {
    const info = {
      uptime: Math.floor(process.uptime()),
      connectedClients: server.clients.size,
    };

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
    } else if (req.url === "/") {
      const acceptsHtml = req.headers.accept?.includes("text/html");

      if (acceptsHtml) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Telnet Proxy</title>
</head>
<body>
  <h1>Telnet Proxy running</h1>
  <p>More info: <a href="https://github.com/danneu/telnet-proxy">https://github.com/danneu/telnet-proxy</a></p>
  <ul>
    <li>Uptime: ${info.uptime} seconds</li>
    <li>Connected clients: ${info.connectedClients}</li>
  </ul>
</body>
</html>`);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(info));
      }
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
}
