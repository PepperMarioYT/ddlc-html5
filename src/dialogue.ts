namespace WebVN {
  interface TextRun {
    node: Text;
    remainder: Text;
    graphemes: string[];
    start: number;
    interval: number;
    visible: number;
  }

  export interface DialogueReveal {
    duration: number;
    draw(elapsed: number): void;
  }

  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

  export function makeDialogue(line: HTMLElement, text: string, speed: number): DialogueReveal {
    const runs: TextRun[] = [];
    const fragment = document.createDocumentFragment();
    const stack: (DocumentFragment | HTMLElement)[] = [fragment];
    const speeds = [speed];
    let cursor = 0;

    for (const token of text.split(/(\{[^{}]+\})/g)) {
      if (!token) continue;
      const parent = stack.at(-1)!;
      const tag = /^\{(\/?)([a-z]+)(?:=(.*))?\}$/.exec(token);
      if (tag) {
        const [, close, name, argument] = tag;
        if (name === "i" || name === "color") {
          if (close) {
            if (stack.length > 1) stack.pop();
          } else {
            const element = document.createElement(name === "i" ? "em" : "span");
            if (name === "color" && /^#[\da-f]{3,8}$/i.test(argument ?? "")) element.style.color = argument;
            parent.append(element);
            stack.push(element);
          }
          continue;
        }
        if (name === "cps") {
          if (close) {
            if (speeds.length > 1) speeds.pop();
          } else {
            const multiplier = argument?.startsWith("*");
            const value = Number(multiplier ? argument.slice(1) : argument);
            if (Number.isFinite(value) && value >= 0) speeds.push(multiplier ? speeds.at(-1)! * value : value);
          }
          continue;
        }
        if (name === "w" || name === "p") {
          const seconds = Number(argument);
          if (Number.isFinite(seconds) && seconds > 0) cursor += seconds * 1000;
          continue;
        }
        if (name === "fast") {
          cursor = 0;
          for (const run of runs) { run.start = 0; run.interval = 0; }
          continue;
        }
        if (name === "nw") continue;
        if (name === "space") {
          const pixels = Number(argument);
          if (Number.isFinite(pixels) && pixels >= 0) {
            const space = document.createElement("span");
            space.className = "dialogue-space";
            space.style.width = String(pixels / 12.8) + "cqw";
            parent.append(space);
          }
          continue;
        }
      }
      const graphemes = segmenter ? [...segmenter.segment(token)].map(({ segment }) => segment) : Array.from(token);
      const currentSpeed = speeds.at(-1)!;
      const interval = currentSpeed > 0 ? 1000 / currentSpeed : 0;
      const node = document.createTextNode("");
      const remainder = document.createTextNode(token);
      const reserve = document.createElement("span");
      reserve.className = "dialogue-reserve";
      reserve.append(remainder);
      parent.append(node, reserve);
      runs.push({ node, remainder, graphemes, start: cursor, interval, visible: 0 });
      cursor += interval * graphemes.length;
    }
    line.replaceChildren(fragment);
    return {
      duration: cursor,
      draw(elapsed) {
        for (const run of runs) {
          const count = elapsed < run.start ? 0 : run.interval > 0
            ? Math.min(run.graphemes.length, Math.floor((elapsed - run.start) / run.interval))
            : run.graphemes.length;
          if (count === run.visible) continue;
          run.visible = count;
          run.node.data = run.graphemes.slice(0, count).join("");
          run.remainder.data = run.graphemes.slice(count).join("");
        }
      },
    };
  }

  export interface DialogueSettings {
    speed?: number;
    autoDelay?: number;
    skipUnseen?: boolean;
    skipAfterChoices?: boolean;
  }

  const key = "webvn-dialogue:" + location.pathname;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  export const dialogueSettings: DialogueSettings = {};
  export const readDialogue = new Set<string>();
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "{}");
    Object.assign(dialogueSettings, data.settings);
    if (Array.isArray(data.read)) for (const id of data.read) if (typeof id === "string") readDialogue.add(id);
  } catch { /* In-memory settings. */ }

  function flush(): void {
    if (!dirty) return;
    clearTimeout(pending);
    pending = undefined;
    dirty = false;
    try {
      localStorage.setItem(key, JSON.stringify({ settings: dialogueSettings, read: [...readDialogue] }));
    } catch { /* In-memory settings. */ }
  }

  export function saveDialogueSettings(): void {
    dirty = true;
    pending ??= setTimeout(() => { pending = undefined; flush(); }, 300);
  }

  export function clearDialogueSettings(): void {
    removeBrowserKey(key);
    dirty = false;
    clearTimeout(pending);
    pending = undefined;
    readDialogue.clear();
  }

  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
}
