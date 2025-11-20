#!/usr/bin/env node
const fs = require("fs");

function readMessage() {
    const header = Buffer.alloc(4);
    const bytes = fs.readSync(0, header, 0, 4);
    if (bytes <= 0) return null;

    const length = header.readUInt32LE(0);
    const data = Buffer.alloc(length);
    fs.readSync(0, data, 0, length);
    return JSON.parse(data.toString());
}

function writeMessage(msg) {
    const jsonBuf = Buffer.from(JSON.stringify(msg));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(jsonBuf.length, 0);
    fs.writeSync(1, header);
    fs.writeSync(1, jsonBuf);
}

// -----------------------------------------------------

let electronState = {
    allowlist: [],
    blacklist: [],
    sessionOn: false
};

while (true) {
    const msg = readMessage();
    if (!msg) continue;

    if (msg.type === "GET_FILTERS") {
        writeMessage({ type: "FILTERS", payload: electronState });
    }

    if (msg.type === "SET_FILTERS") {
        electronState = msg.payload;
        writeMessage({ ok: true });
    }

    if (msg.type === "PING") {
        writeMessage({ type: "PONG" });
    }
}
