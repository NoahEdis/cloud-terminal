import { createTerminalServer } from "./server.js";

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "localhost";

const server = createTerminalServer({ port, host });
server.start();
