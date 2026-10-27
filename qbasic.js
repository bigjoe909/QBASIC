(function () {
    "use strict";

    const maxSteps = 2000;
    const maxOutputLength = 12000;

    function removeComment(line) {
        let inString = false;
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            if (character === '"') {
                if (inString && line[index + 1] === '"') {
                    index += 1;
                } else {
                    inString = !inString;
                }
            } else if (character === "'" && !inString) {
                return line.slice(0, index);
            }
        }
        return line;
    }

    function cleanLines(source) {
        return source.split(/\r?\n/).map((line) => {
            const cleaned = removeComment(line).trim();
            return /^REM(?:\s|$)/i.test(cleaned) ? "" : cleaned;
        });
    }

    function tokenize(source) {
        const tokens = [];
        let index = 0;
        while (index < source.length) {
            const character = source[index];
            if (/\s/.test(character)) {
                index += 1;
                continue;
            }
            if (character === '"') {
                let value = "";
                index += 1;
                while (index < source.length) {
                    if (source[index] === '"') {
                        if (source[index + 1] === '"') {
                            value += '"';
                            index += 2;
                            continue;
                        }
                        break;
                    }
                    value += source[index];
                    index += 1;
                }
                if (source[index] !== '"') {
                    throw new Error("A string is missing its closing quotation mark.");
                }
                index += 1;
                tokens.push({ type: "string", value });
                continue;
            }
            const number = source.slice(index).match(/^\d+(?:\.\d+)?/);
            if (number) {
                tokens.push({ type: "number", value: Number(number[0]) });
                index += number[0].length;
                continue;
            }
            const identifier = source.slice(index).match(/^[A-Za-z][A-Za-z0-9]*\$?/);
            if (identifier) {
                tokens.push({ type: "identifier", value: identifier[0] });
                index += identifier[0].length;
                continue;
            }
            const operator = source.slice(index).match(/^(?:<=|>=|<>|[()+*/^=<>-])/);
            if (operator) {
                tokens.push({ type: "operator", value: operator[0] });
                index += operator[0].length;
                continue;
            }
            throw new Error(`Unexpected character: ${character}`);
        }
        return tokens;
    }

    function evaluate(source, variables) {
        const tokens = tokenize(source);
        let position = 0;
        const peek = () => tokens[position];
        const take = () => tokens[position++];
        const match = (value) => {
            if (peek() && peek().value === value) {
                position += 1;
                return true;
            }
            return false;
        };

        function primary() {
            const token = take();
            if (!token) {
                throw new Error("Expected a value.");
            }
            if (token.type === "number" || token.type === "string") {
                return token.value;
            }
            if (token.type === "identifier") {
                const key = token.value.toLowerCase();
                return variables.has(key) ? variables.get(key) : (key.endsWith("$") ? "" : 0);
            }
            if (token.value === "(") {
                const value = comparison();
                if (!match(")")) {
                    throw new Error("A closing parenthesis is missing.");
                }
                return value;
            }
            throw new Error(`Unexpected token: ${token.value}`);
        }

        function unary() {
            if (match("-")) {
                return -Number(unary());
            }
            if (match("+")) {
                return Number(unary());
            }
            return primary();
        }

        function power() {
            const left = unary();
            if (match("^")) {
                return Number(left) ** Number(power());
            }
            return left;
        }

        function product() {
            let value = power();
            while (peek() && (peek().value === "*" || peek().value === "/")) {
                const operator = take().value;
                const right = Number(power());
                if (operator === "/" && right === 0) {
                    throw new Error("Division by zero is not allowed.");
                }
                value = operator === "*" ? Number(value) * right : Number(value) / right;
            }
            return value;
        }

        function sum() {
            let value = product();
            while (peek() && (peek().value === "+" || peek().value === "-")) {
                const operator = take().value;
                const right = product();
                if (operator === "+" && (typeof value === "string" || typeof right === "string")) {
                    value = String(value) + String(right);
                } else {
                    value = operator === "+" ? Number(value) + Number(right) : Number(value) - Number(right);
                }
            }
            return value;
        }

        function comparison() {
            const left = sum();
            if (!peek() || !["=", "<>", "<", "<=", ">", ">="].includes(peek().value)) {
                return left;
            }
            const operator = take().value;
            const right = sum();
            const bothNumbers = typeof left === "number" && typeof right === "number";
            const first = bothNumbers ? left : String(left).toLowerCase();
            const second = bothNumbers ? right : String(right).toLowerCase();
            switch (operator) {
                case "=": return first === second;
                case "<>": return first !== second;
                case "<": return first < second;
                case "<=": return first <= second;
                case ">": return first > second;
                case ">=": return first >= second;
                default: return false;
            }
        }

        const result = comparison();
        if (position !== tokens.length) {
            throw new Error(`Unexpected token: ${tokens[position].value}`);
        }
        return result;
    }

    function splitOutsideStrings(source, separators) {
        const parts = [];
        let current = "";
        let inString = false;
        let depth = 0;
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index];
            if (character === '"') {
                if (inString && source[index + 1] === '"') {
                    current += '""';
                    index += 1;
                    continue;
                }
                inString = !inString;
            }
            if (!inString) {
                if (character === "(") depth += 1;
                if (character === ")") depth -= 1;
                if (depth === 0 && separators.includes(character)) {
                    parts.push({ value: current.trim(), separator: character });
                    current = "";
                    continue;
                }
            }
            current += character;
        }
        parts.push({ value: current.trim(), separator: "" });
        return parts;
    }

    function buildIfPairs(lines) {
        const stack = [];
        const pairs = new Map();
        const elseToEnd = new Map();
        lines.forEach((line, index) => {
            if (/^IF\s+.+\s+THEN$/i.test(line)) {
                stack.push({ start: index, elseIndex: -1 });
            } else if (/^ELSE$/i.test(line)) {
                if (!stack.length || stack[stack.length - 1].elseIndex !== -1) {
                    throw new Error(`ELSE without a matching IF on line ${index + 1}.`);
                }
                stack[stack.length - 1].elseIndex = index;
            } else if (/^END\s+IF$/i.test(line)) {
                const frame = stack.pop();
                if (!frame) {
                    throw new Error(`END IF without a matching IF on line ${index + 1}.`);
                }
                pairs.set(frame.start, { elseIndex: frame.elseIndex, endIndex: index });
                if (frame.elseIndex !== -1) {
                    elseToEnd.set(frame.elseIndex, index);
                }
            }
        });
        if (stack.length) {
            throw new Error("An IF block is missing END IF.");
        }
        return { pairs, elseToEnd };
    }

    function findMatchingNext(lines, start) {
        let depth = 0;
        for (let index = start + 1; index < lines.length; index += 1) {
            if (/^FOR\b/i.test(lines[index])) depth += 1;
            if (/^NEXT(?:\s+[A-Za-z][A-Za-z0-9]*\$?)?$/i.test(lines[index])) {
                if (depth === 0) return index;
                depth -= 1;
            }
        }
        throw new Error(`FOR without a matching NEXT on line ${start + 1}.`);
    }

    function run(source, inputValue) {
        const lines = cleanLines(source);
        const variables = new Map();
        const output = { text: "" };
        const loops = [];
        const { pairs: ifPairs, elseToEnd } = buildIfPairs(lines);
        let lineIndex = 0;
        let steps = 0;

        function write(text) {
            output.text += text;
            if (output.text.length > maxOutputLength) {
                throw new Error("Output limit reached. Try a shorter program or loop.");
            }
        }

        function loopContinues(value, end, step) {
            return step > 0 ? value <= end : value >= end;
        }

        while (lineIndex < lines.length) {
            steps += 1;
            if (steps > maxSteps) {
                throw new Error("Step limit reached. Check that your loop has a stopping point.");
            }
            const line = lines[lineIndex];
            if (!line) {
                lineIndex += 1;
                continue;
            }
            if (/^CLS$/i.test(line)) {
                output.text = "";
                lineIndex += 1;
                continue;
            }
            if (/^END$/i.test(line)) break;

            const print = line.match(/^PRINT(?:\s+(.*))?$/i);
            if (print) {
                if (!print[1]) {
                    write("\n");
                } else {
                    const pieces = splitOutsideStrings(print[1], [";", ","]);
                    let rendered = "";
                    pieces.forEach((piece) => {
                        if (piece.value) rendered += String(evaluate(piece.value, variables));
                        if (piece.separator === ",") rendered += "\t";
                    });
                    write(`${rendered}\n`);
                }
                lineIndex += 1;
                continue;
            }

            const input = line.match(/^INPUT\s+(.+)$/i);
            if (input) {
                const pieces = splitOutsideStrings(input[1], [";", ","]);
                let variableName;
                let prompt = "";
                if (pieces.length === 1) {
                    variableName = pieces[0].value;
                } else if (pieces.length === 2) {
                    prompt = String(evaluate(pieces[0].value, variables));
                    variableName = pieces[1].value;
                } else {
                    throw new Error(`Unsupported INPUT format on line ${lineIndex + 1}.`);
                }
                if (!/^[A-Za-z][A-Za-z0-9]*\$?$/.test(variableName)) {
                    throw new Error(`Invalid INPUT variable on line ${lineIndex + 1}.`);
                }
                variables.set(variableName.toLowerCase(), variableName.endsWith("$") ? inputValue : Number(inputValue));
                write(`${prompt}${inputValue}\n`);
                lineIndex += 1;
                continue;
            }

            const conditional = line.match(/^IF\s+(.+)\s+THEN$/i);
            if (conditional) {
                const pair = ifPairs.get(lineIndex);
                if (!pair) throw new Error(`Invalid IF block on line ${lineIndex + 1}.`);
                if (Boolean(evaluate(conditional[1], variables))) {
                    lineIndex += 1;
                } else {
                    lineIndex = pair.elseIndex === -1 ? pair.endIndex + 1 : pair.elseIndex + 1;
                }
                continue;
            }
            if (/^ELSE$/i.test(line)) {
                lineIndex = (elseToEnd.get(lineIndex) ?? lineIndex) + 1;
                continue;
            }
            if (/^END\s+IF$/i.test(line)) {
                lineIndex += 1;
                continue;
            }

            const forLoop = line.match(/^FOR\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i);
            if (forLoop) {
                const variable = forLoop[1].toLowerCase();
                const startValue = Number(evaluate(forLoop[2], variables));
                const endValue = Number(evaluate(forLoop[3], variables));
                const stepValue = forLoop[4] ? Number(evaluate(forLoop[4], variables)) : 1;
                if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || !Number.isFinite(stepValue) || stepValue === 0) {
                    throw new Error(`Invalid FOR range on line ${lineIndex + 1}.`);
                }
                variables.set(variable, startValue);
                if (!loopContinues(startValue, endValue, stepValue)) {
                    lineIndex = findMatchingNext(lines, lineIndex) + 1;
                } else {
                    loops.push({ variable, endValue, stepValue, forIndex: lineIndex });
                    lineIndex += 1;
                }
                continue;
            }
            const nextLoop = line.match(/^NEXT(?:\s+([A-Za-z][A-Za-z0-9]*))?$/i);
            if (nextLoop) {
                const frame = loops[loops.length - 1];
                if (!frame) throw new Error(`NEXT without a matching FOR on line ${lineIndex + 1}.`);
                if (nextLoop[1] && nextLoop[1].toLowerCase() !== frame.variable) {
                    throw new Error(`NEXT variable does not match FOR on line ${lineIndex + 1}.`);
                }
                const value = Number(variables.get(frame.variable)) + frame.stepValue;
                variables.set(frame.variable, value);
                if (loopContinues(value, frame.endValue, frame.stepValue)) {
                    lineIndex = frame.forIndex + 1;
                } else {
                    loops.pop();
                    lineIndex += 1;
                }
                continue;
            }

            const assignment = line.match(/^(?:LET\s+)?([A-Za-z][A-Za-z0-9]*\$?)\s*=\s*(.+)$/i);
            if (assignment) {
                variables.set(assignment[1].toLowerCase(), evaluate(assignment[2], variables));
                lineIndex += 1;
                continue;
            }
            throw new Error(`Unsupported statement on line ${lineIndex + 1}: ${line}`);
        }
        return output.text;
    }

    const storageKey = "qbasic-course-completed-v1";
    let completed = new Set();
    try {
        completed = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
    } catch (error) {
        completed = new Set();
    }

    function updateProgress() {
        const total = document.querySelectorAll("[data-playground]").length;
        const count = completed.size;
        document.querySelector("#progress-count").textContent = `${count} of ${total}`;
        const progress = document.querySelector(".progress-track");
        progress.setAttribute("aria-valuemax", String(total));
        progress.setAttribute("aria-valuenow", String(count));
        document.querySelector(".progress-fill").style.width = `${total ? (count / total) * 100 : 0}%`;
        document.querySelectorAll(".lesson-nav a").forEach((link) => {
            const id = link.getAttribute("href").slice(8).replace("lesson-", "");
            link.classList.toggle("is-complete", completed.has(id));
        });
        try {
            localStorage.setItem(storageKey, JSON.stringify(Array.from(completed)));
        } catch (error) {
            // Progress remains available for the current page view.
        }
    }

    document.querySelectorAll("[data-playground]").forEach((playground) => {
        const editor = playground.querySelector(".code-editor");
        const inputControl = playground.querySelector(".input-control");
        const input = playground.querySelector(".program-input");
        const output = playground.querySelector(".program-output");
        const status = playground.querySelector(".run-status");
        const updateInputVisibility = () => {
            inputControl.hidden = !/^\s*INPUT\b/im.test(editor.value);
        };
        const runCode = () => {
            try {
                output.textContent = run(editor.value, input.value);
                if (!output.textContent) output.textContent = "(Program finished with no output.)";
                status.textContent = "Complete";
                status.dataset.state = "success";
                completed.add(playground.dataset.lessonId);
                updateProgress();
            } catch (error) {
                output.textContent = error.message;
                status.textContent = "Check code";
                status.dataset.state = "error";
            }
        };
        playground.querySelector(".run-button").addEventListener("click", runCode);
        playground.querySelector(".reset-button").addEventListener("click", () => {
            editor.value = editor.dataset.default.replace(/&#10;/g, "\n").replace(/&quot;/g, '"').replace(/&gt;/g, ">");
            output.textContent = "Run the program to see its output.";
            status.textContent = "Ready";
            status.dataset.state = "ready";
            updateInputVisibility();
        });
        editor.addEventListener("input", updateInputVisibility);
        editor.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runCode();
        });
        updateInputVisibility();
    });

    updateProgress();
})();