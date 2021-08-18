import { AutojoinRoomsMixin, MatrixClient, MatrixEvent, RichReply, SimpleFsStorageProvider, TextualMessageEventContent } from "matrix-bot-sdk";
import { Database, open as openDatabase } from "sqlite";

const sqlite3 = require("sqlite3");
require("dotenv").config();

const HOMESERVER: string = "https://matrix.org";
const ACCESS_TOKEN: string = process.env["WORKCLOCK_ACCESS_TOKEN"]!;

interface TimeEvent {
    uid: string;
    type: "in" | "out";
    time: number;
}

const storage = new SimpleFsStorageProvider("work-clock.json");
const client = new MatrixClient(HOMESERVER, ACCESS_TOKEN, storage);
AutojoinRoomsMixin.setupOnClient(client);

client.on("room.message", handleCommand);

function htmlify(plain: string): string {
    return plain
        .replace(/  \n/g, "<br>") // Newlines => <br>
        .replace(/```([\s\S]*)```/g, "<code>$1</code>") // ```code``` blocks => <code></code>
        .replace(/`([^`]*)`/g, "<code>$1</code>") // `code` blocks => <code></code>
        .replace(/\[(?<name>.*)\]\((?<target>.*)\)/g, '<a href="$<target>">$<name></a>');
}

async function punchIn(uid: string): Promise<string> {
    const ev = await db.get<TimeEvent>("SELECT * FROM timestamps WHERE uid = ? ORDER BY time DESC", uid);
    if (ev?.type === "in") {
        // You already punched in!
        return "You already punched in. Punch out first or use `!clear`.";
    }

    const stamp = Date.now();

    await db.run("INSERT INTO timestamps (uid, type, time) VALUES (?, 'in', ?)", uid, stamp);

    return "Punched in! Have fun at work!";
}

async function punchOut(uid: string): Promise<string> {
    const ev = await db.get<TimeEvent>("SELECT * FROM timestamps WHERE uid = ? ORDER BY time DESC", uid);
    if (ev?.type !== "in") {
        // You already punched in!
        return "You havent punched in yet. Use `!in` to punch in before using this command again.";
    }

    const stamp = Date.now();

    await db.run("INSERT INTO timestamps (uid, type, time) VALUES (?, 'out', ?)", uid, stamp);

    return "Punched out! Have fun at home!";
}

async function list(uid: string): Promise<string> {
    // Make sure we have punched out
    const ev = await db.get<TimeEvent>("SELECT * FROM timestamps WHERE uid = ? ORDER BY time DESC", uid);
    if (ev?.type === "in") {
        // You already punched in!
        return "You haven't punched out yet. Punch out before using `!list`";
    }
    const evs = await db.all<TimeEvent[]>("SELECT * FROM timestamps WHERE uid = ? ORDER BY time ASC", uid);
    const outs: TimeEvent[] = [];
    const ins: TimeEvent[] = [];

    for (let i = 0; i < evs.length; ++i) {
        if (i % 2 === 0) {
            ins.push(evs[i]);
        } else {
            outs.push(evs[i]);
        }
    }

    const zipped: TimeEvent[][] = ins.map((in_, idx) => [in_, outs[idx]]);
    return zipped.map(pair => {
        const inTime = pair[0];
        const outTime = pair[1];

        const diff = Math.round((outTime.time - inTime.time) / 1000);
        const hrs = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);

        const hrsFmt = hrs.toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping: false});
        const minFmt = minutes.toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping: false})
        const day = new Date(inTime.time).toISOString().split("T", 1)[0];

        return `${hrsFmt}:${minFmt} Spent on ${day}`
    }).reduce((acc, next) => {
        return acc + "  \n" + next; 
    }, "List of hours:  \n");
}

async function clear(username: string): Promise<string> {
    await db.run("DELETE FROM timestamps WHERE uid = ?", username);
    return "All hours cleared";
}

async function handleCommand(roomId: string, event: MatrixEvent<TextualMessageEventContent>) {
    if (!event.content) return;
    if (event.content.msgtype !== "m.text") return;
    if (event.sender === await client.getUserId()) return;

    const body: string = event.content.body;
    if (!body) return;

    const cmd = body.split(" ", 1)[0];
    //const cmdArgs = body.split(" ").slice(1);
    switch (cmd) {
        case "!help":
            const HELP_TEXT = "Help  \n" +
            "`!help` - Show this message  \n" +
            "`!in` - Punch in  \n" +
            "`!out` - Punch out  \n" +
            "`!list` - List hours worked  \n" +
            "`!clear` - Delete all hours worked  \n" +
            "\n" +
            "[Source Code available here under the GPLv3 license](https://github.com/Kozova1/matrix-WorkClock.git)";
            client.sendMessage(roomId, RichReply.createFor(
                roomId,
                event,
                HELP_TEXT,
                htmlify(HELP_TEXT),
            ));
            break;
        case "!clear": {
            const result = await clear(event.sender);
            client.sendMessage(roomId, RichReply.createFor(
                roomId,
                event,
                result,
                htmlify(result),
            ));
        
            break;
        }
        case "!in": {
            const result = await punchIn(event.sender);

            client.sendMessage(roomId, RichReply.createFor(
                roomId,
                event,
                result,
                htmlify(result),
            ));

            break;
        }
        case "!out": {
            const result = await punchOut(event.sender);

            client.sendMessage(roomId, RichReply.createFor(
                roomId,
                event,
                result,
                htmlify(result),
            ));

            break;
        }
        case "!list": {

            // SEEMS TO HAVE A BUG, TODO: FIX THIS
            const result = await list(event.sender);

            client.sendMessage(roomId, RichReply.createFor(
                roomId,
                event,
                result,
                htmlify(result),
            ));

            break;
        }
        default:
            client.sendMessage(roomId, RichReply.createFor(
                roomId,
                event,
                `Unknown command ${cmd}. For help use \`!help\``,
                `Unknown command ${cmd}. For help use <code>!help</code>`
            ));
    }
}

let db: Database;

(async () => {
    db = await openDatabase({
        filename: "clock.db",
        driver: sqlite3.Database
    });
    console.log("Database connection open");
    await client.start();
    console.log("Bot started");
})();