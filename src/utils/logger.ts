const crt = {
    neon: (t: string) => `\x1b[38;5;48m${t}\x1b[0m`,   // яркий неон зелёный
    green: (t: string) => `\x1b[38;5;40m${t}\x1b[0m`,   // чистый зелёный
    dimGreen: (t: string) => `\x1b[38;5;22m${t}\x1b[0m`, // глубокий тёмно-зелёный
    gray: (t: string) => `\x1b[38;5;244m${t}\x1b[0m`,  // мягкий серый
    bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

const TAGS = {
    info: "[INFO]",
    warn: "[WARN]",
    error: "[ERR]",
};

// ─────────────────────────────────────────────────────────────
// PREFIX: [HH:MM:SS] >> [INFO]
// ─────────────────────────────────────────────────────────────
const prefix = (tag: string) => {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");

    return (
        crt.gray(`[${h}:${m}:${s}]`) +
        " " +
        crt.neon(">>") +
        " " +
        crt.dimGreen(tag)
    );
};

// ─────────────────────────────────────────────────────────────
// TS PRETTY FORMATTER WITH BLOCK DETECTION
// ─────────────────────────────────────────────────────────────
const formatCodePretty = (code: string): string => {
    let out: string[] = [];
    let current = "";
    let indent = 0;

    let inString = false;
    let stringChar: '"' | "'" | "`" | null = null;

    const pushLine = () => {
        if (current.trim().length > 0) {
            out.push("    ".repeat(indent) + current.trim());
        }
        current = "";
    };

    const increase = () => indent++;
    const decrease = () => (indent = Math.max(0, indent - 1));

    for (let i = 0; i < code.length; i++) {
        const ch = code[i];

        // STRING HANDLING
        if (!inString && (ch === '"' || ch === "'" || ch === "`")) {
            inString = true;
            stringChar = ch as any;
            current += ch;
            continue;
        }
        if (inString) {
            current += ch;
            if (ch === stringChar) {
                inString = false;
                stringChar = null;
            }
            continue;
        }

        // START BLOCK "{"
        if (ch === "{") {
            // detect empty block: "{   }"
            let j = i + 1;
            let isEmpty = true;
            while (j < code.length) {
                if (code[j] === "}") break;
                if (!/\s/.test(code[j])) { isEmpty = false; break; }
                j++;
            }

            if (isEmpty && code[j] === "}") {
                current += "{}";
                i = j; // skip until '}'
                continue;
            }

            current += "{";
            pushLine();
            increase();
            continue;
        }

        // END BLOCK "}"
        if (ch === "}") {
            pushLine();
            decrease();

            // merge sequences: "}", "})", "});"
            let seq = "}";
            let j = i + 1;

            while (j < code.length && /[\s\)\;]+/.test(code[j])) {
                if (code[j] === ")") seq += ")";
                if (code[j] === ";") seq += ";";
                j++;
            }

            i = j - 1;
            out.push("    ".repeat(indent) + seq);
            current = "";
            continue;
        }

        // START ARRAY "["
        if (ch === "[") {
            let j = i + 1;
            let isEmpty = true;
            while (j < code.length) {
                if (code[j] === "]") break;
                if (!/\s/.test(code[j])) { isEmpty = false; break; }
                j++;
            }
            if (isEmpty && code[j] === "]") {
                current += "[]";
                i = j;
                continue;
            }

            current += "[";
            pushLine();
            increase();
            continue;
        }

        // END ARRAY "]"
        if (ch === "]") {
            pushLine();
            decrease();
            out.push("    ".repeat(indent) + "]");
            current = "";
            continue;
        }

        // COMMA → newline
        if (ch === ",") {
            current += ",";
            pushLine();
            continue;
        }

        // SEMICOLON → newline
        if (ch === ";") {
            current += ";";
            pushLine();
            continue;
        }

        current += ch;
    }

    if (current.trim().length > 0) {
        out.push("    ".repeat(indent) + current.trim());
    }

    // Syntax highlighting
    return out
        .map(line =>
            line
                .replace(
                    /\b(const|let|var|console)\b/g,
                    m => crt.neon(m)
                )
                .replace(/\bapi\.[a-zA-Z0-9_]+/g, m => crt.green(m))
        )
        .join("\n");
};

// ─────────────────────────────────────────────────────────────
// CODE BLOCK PRINTER
// ─────────────────────────────────────────────────────────────
const printCodeBlock = (code: string): string => {
    const body = formatCodePretty(code);
    const width = Math.min(100, Math.max(...body.split("\n").map(l => l.length)) + 4);

    const title = " ts ";
    const filler = "─".repeat(width - title.length - 2);
    const top = `┌${filler}${title}┐`;
    const bottom = "└" + "─".repeat(width - 2) + "┘";

    return [
        crt.dimGreen(top),
        ...body.split("\n").map(line => "  " + crt.gray(line)),
        crt.dimGreen(bottom)
    ].join("\n");
};

export const log = {
    info: (msg: string, ...args: any[]) =>
        console.log(`${prefix(TAGS.info)} ${crt.green(msg)}`, ...args),

    warn: (msg: string, ...args: any[]) =>
        console.warn(`${prefix(TAGS.warn)} ${crt.green(msg)}`, ...args),

    error: (msg: string, ...args: any[]) =>
        console.error(`${prefix(TAGS.error)} ${crt.green(msg)}`, ...args),

    section: (title: string) => {
        const label = `[ ${title.toUpperCase()} ]`;
        const line = "-".repeat(label.length);

        console.log("");
        console.log(crt.dimGreen(`+${line}+`));
        console.log(crt.neon("|") + crt.bold(crt.green(label)) + crt.neon("|"));
        console.log(crt.dimGreen(`+${line}+`));
    },

    // ─────────────────────────────
    // JSON + SPECIAL CASE FOR { code }
    // ─────────────────────────────
    json(label: string, input: unknown) {
        console.log(`${prefix(TAGS.info)} ${crt.neon(label)}:`);

        if (typeof input === "string") {
            console.log(input.split("\n").map(l => "  " + crt.gray(l)).join("\n"));
            return;
        }

        // { code: "..." }
        if (
            input &&
            typeof input === "object" &&
            !Array.isArray(input) &&
            "code" in input &&
            typeof input.code === "string" &&
            Object.keys(input).length === 1
        ) {
            console.log(printCodeBlock((input).code));
            return;
        }

        const raw = JSON.stringify(input, null, 2)
            .split("\n")
            .map(l => "  " + crt.dimGreen(l))
            .join("\n");

        console.log(raw);
    }
};