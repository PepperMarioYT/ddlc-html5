namespace WebVN {
  export interface Instruction {
    op: string;
    at: string;
    name?: string | null;
    who?: string | null;
    text?: string;
    interact?: boolean;
    target?: string;
    tag?: string | null;
    layer?: string | null;
    order?: number | null;
    expression?: number | null;
    positions?: string[];
    behind?: string[];
    args?: [string | null, number][];
    branches?: [number, Instruction[]][];
    choices?: { text: string; condition: number; body: Instruction[] | null }[];
    code?: number;
    action?: string;
    channel?: string;
    audioOptions?: { fadein?: number; fadeout?: number; loop?: boolean; ifChanged?: boolean };
  }

  export interface ScreenNode {
    kind: string;
    style?: string | number | null;
    args?: number[];
    bindings?: [string | null, number][];
    content?: ScreenNode;
    variable?: string;
    expression?: number;
    children?: ScreenNode[];
    branches?: [number | null, ScreenNode][];
    properties?: Record<string, number>;
    target?: string;
    code?: number;
  }

  export interface Program {
    entry: string;
    bootstrap: Instruction[];
    beforeStart: Instruction[];
    styles: string[];
    screens: Record<string, ScreenNode[]>;
    startup: {
      consent: { background: string; acceptedBackground: string; warnings: string[]; statement: string; accept: string };
      intro: { end: number };
      splash_warning: { end: number; message: number };
    };
    titleAtl: Record<string, TitleAnimation>;
    titleMusic: { ghost?: number; ghostCondition?: number };
    imageColors: Record<string, string>;
    imageLayouts: Record<string, Record<string, number>>;
    styleProperties: Record<string, Record<string, number>>;
    labels: Record<string, { body: Instruction[]; params: [string, number | null][] }>;
    images: Record<string, string[]>;
    transforms: Record<string, {
      params: Record<string, string>;
      properties: Record<string, string>;
      alias: [string, number[]] | null;
      vertical: [number, number][];
    }>;
    initializers: [string, string, string | null, number][];
    files: Record<string, string>;
    fileNames: string[];
    audioRoot: string;
    assets: Record<string, string>;
  }

  export type ChoicePresentation = "story" | "poem" | "confirm";

  export interface Host {
    say(speaker: string, text: string, interact: boolean, id?: string, abortable?: boolean): Promise<void>;
    choose(prompt: string, choices: string[], presentation?: ChoicePresentation): Promise<number>;
    render(command: Instruction, value: Value): Promise<void>;
    check(): void;
  }

  class ReturnValue {
    constructor(readonly value: Value) {}
  }

  export class Runtime {
    constructor(readonly program: Program, readonly scope: PythonScope,
                private readonly functions: readonly PythonCode[], private readonly host: Host) {}

    async evaluate(id?: number | null): Promise<Value> {
      if (id == null) return null;
      return this.functions[id](this.scope);
    }

    async initialize(): Promise<string[]> {
      const issues = [];
      for (const [location, kind, target, id] of this.program.initializers) {
        this.host.check();
        try {
          if (target === null) {
            await this.evaluate(id);
            continue;
          }
          const path = target.split(".");
          const key = path.pop()!;
          let object = this.scope.values;
          for (const segment of path) object = object[segment] ??= Object.create(null);
          if (kind === "Default" && Object.hasOwn(object, key)) continue;
          object[key] = await this.evaluate(id);
        } catch (error) {
          this.host.check();
          issues.push(`${location}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await this.execute(this.program.bootstrap);
      return issues;
    }

    async beforeStart(): Promise<void> { await this.execute(this.program.beforeStart); }

    async interpolate(text: string): Promise<string> {
      const parts = text.split(/(\[\[|\[(?:[A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*(?:!t)?\])/g);
      return parts.map((part, i) => {
        if (!(i % 2)) return part;
        if (part === "[[") return "[";
        const [name, ...path] = part.slice(1, -1).replace(/!t$/, "").split(".");
        return String(path.reduce((object, key) => this.scope.attr(object, key), this.scope.get(name)));
      }).join("");
    }

    async run(entry = this.program.entry, args: Value[] = [], named: Record<string, Value> = {}): Promise<Value> {
      let label = entry;
      const restored = new Map<string, { exists: boolean; value: Value }>();
      try {
        while (true) {
          this.host.check();
          const target = this.program.labels[label];
          if (!target) throw new Error(`Unknown Ren’Py label: ${label}`);
          for (const [index, [name, fallback]] of target.params.entries()) {
            if (!restored.has(name)) {
              restored.set(name, { exists: Object.hasOwn(this.scope.values, name), value: this.scope.values[name] });
            }
            if (index < args.length) this.scope.set(name, args[index]);
            else if (Object.hasOwn(named, name)) this.scope.set(name, named[name]);
            else if (fallback != null) this.scope.set(name, await this.evaluate(fallback));
            else throw new Error(`Missing argument ${name} for ${label}`);
          }
          try {
            await this.execute(target.body);
            return null;
          } catch (error) {
            if (error instanceof ReturnValue) return error.value;
            if (!(error instanceof Transfer)) throw error;
            label = error.label;
            args = [];
            named = {};
          }
        }
      } finally {
        for (const [name, old] of restored) {
          if (old.exists) this.scope.set(name, old.value);
          else this.scope.unset(name);
        }
      }
    }

    private async execute(body: Instruction[]): Promise<void> {
      for (const instruction of body) {
        this.host.check();
        try {
          switch (instruction.op) {
            case "say": {
              const character = instruction.who ? this.scope.get(instruction.who) : this.scope.values.narrator;
              const name = character?.dynamic ? this.scope.get(character.name) : character?.name;
              const text = await this.interpolate(instruction.text ?? "");
              const history = this.scope.values._history_list ??= [];
              history.push({ who: name, what: text });
              if (history.length > 250) history.shift();
              if (character?.display_args?.callback) await this.scope.call(character.display_args.callback, ["show"], {});
              await this.host.say(name ?? "", (character?.prefix ?? "") + text + (character?.suffix ?? ""), instruction.interact !== false, instruction.at, character?.what_args?.slow_abortable !== false);
              break;
            }
            case "python":
              await this.evaluate(instruction.code);
              break;
            case "call-screen":
              this.scope.set("_return", await this.evaluate(instruction.expression));
              break;
            case "return":
              throw new ReturnValue(await this.evaluate(instruction.expression));
            case "jump":
              throw new Transfer(instruction.expression != null ? await this.evaluate(instruction.expression) : instruction.target);
            case "call": {
              const args = [];
              const named: Record<string, Value> = {};
              for (const [key, code] of instruction.args ?? []) {
                const value = await this.evaluate(code);
                if (key === null) args.push(value);
                else named[key] = value;
              }
              const target = instruction.expression != null ? await this.evaluate(instruction.expression) : instruction.target;
              this.scope.set("_return", await this.run(target, args, named));
              break;
            }
            case "if":
              for (const [condition, branch] of instruction.branches ?? []) {
                if (this.scope.truth(await this.evaluate(condition))) {
                  await this.execute(branch);
                  break;
                }
              }
              break;
            case "menu": {
              let prompt = "";
              const choices: { text: string; body: Instruction[] }[] = [];
              for (const choice of instruction.choices ?? []) {
                if (!this.scope.truth(await this.evaluate(choice.condition))) continue;
                const text = await this.interpolate(choice.text);
                if (choice.body === null) prompt = text;
                else choices.push({ text, body: choice.body });
              }
              if (choices.length) {
                const selected = await this.host.choose(prompt, choices.map((choice) => choice.text));
                await this.execute(choices[selected].body);
              }
              break;
            }
            case "unsupported":
              throw new Error(`Unsupported Ren’Py statement: ${instruction.name}`);
            default: {
              const value = await this.evaluate(instruction.expression ?? instruction.order);
              if (instruction.op === "audio") {
                this.scope.get("__setTrack")(instruction.channel, value);
              }
              await this.host.render(instruction, value);
            }
          }
        } catch (error) {
          if (error instanceof Transfer || error instanceof ReturnValue || error instanceof EndSession) throw error;
          this.host.check();
          throw new Error(`${instruction.at}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      }
    }
  }
}
