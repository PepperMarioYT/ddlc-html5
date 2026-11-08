namespace WebVN {
  // Compiled Python values remain dynamic at the boundary with the game script.
  export type Value = any;
  export type PythonCode = (scope: PythonScope) => Promise<Value>;
  type Call = (args: Value[], kwargs: Record<string, Value>) => Value;
  const pythonCall = Symbol("Python call");

  export class Transfer {
    constructor(readonly label: string) {}
  }

  export class EndSession {}
  export class PythonDateTime { constructor(readonly time: number) {} }

  export class PythonScope {
    constructor(
      readonly values: Record<string, Value> = Object.create(null),
      private readonly parent?: PythonScope,
      private readonly globals = new Set<string>(),
      private readonly modules: Record<string, Value> = {},
    ) {}

    get(name: string): Value {
      if (Object.hasOwn(this.values, name)) return this.values[name];
      if (this.parent) return this.parent.get(name);
      if (this.values.audio && Object.hasOwn(this.values.audio, name)) return this.values.audio[name];
      throw new Error(`Unknown Python name: ${name}`);
    }

    set(name: string, value: Value): void {
      if (this.globals.has(name) && this.parent) this.root().set(name, value);
      else this.values[name] = value;
    }

    unset(name: string): void { delete this.values[name]; }
    root(): PythonScope { return this.parent?.root() ?? this; }
    tick(): void { this.get("__tick")(); }
    unsupported(location: string): never { throw new Error(`Unsupported Python at ${location}`); }
    catchError(error: unknown): void { if (error instanceof Transfer || error instanceof EndSession || (error instanceof Error && error.name === "AbortError")) throw error; }

    importModule(name: string, alias: string): void {
      const module = this.root().modules[name];
      if (!module) throw new Error(`Unsupported Python module: ${name}`);
      this.set(alias, module);
    }

    attr(value: Value, key: string): Value {
      if (value == null) throw new Error(`Cannot read Python attribute ${key}`);
      if (Array.isArray(value)) {
        if (key === "append") return (item: Value) => { value.push(item); };
        if (key === "remove") return (item: Value) => {
          const index = value.indexOf(item);
          if (index < 0) throw new Error("list.remove: item missing");
          value.splice(index, 1);
        };
        if (key === "insert") return (index: number, item: Value) => { value.splice(index, 0, item); };
        if (key === "pop") return (index = -1) => value.splice(index, 1)[0];
        if (key === "sort") return () => { value.sort((a, b) => a < b ? -1 : a > b ? 1 : 0); };
      }
      if (typeof value === "string") {
        if (key === "strip") return () => value.trim();
        if (key === "lower") return () => value.toLowerCase();
        if (key === "capitalize") return () => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
        if (key === "join") return (items: Value[]) => items.join(value);
        if (key === "replace") return (from: string, to: string) => value.split(from).join(to);
      }
      if (key in Object(value)) {
        const member = value[key];
        return typeof member === "function" && !member[pythonCall] ? member.bind(value) : member;
      }
      if (key === "get" && typeof value === "object") return (name: string, fallback = null) => value[name] ?? fallback;
      if (value === this.root().values.persistent) return null;
      throw new Error(`Unknown Python attribute: ${key}`);
    }

    item(value: Value, index: Value): Value {
      const key = typeof index === "number" && index < 0 && (Array.isArray(value) || typeof value === "string")
        ? value.length + index : index;
      if (value == null || !(key in Object(value))) throw new Error(`Python index missing: ${String(index)}`);
      return value[key];
    }

    put(value: Value, index: Value, item: Value): void {
      if (Array.isArray(value) && typeof index === "number" && index < 0) index += value.length;
      value[index] = item;
    }

    remove(value: Value, index: Value): void {
      if (Array.isArray(value)) value.splice(index, 1);
      else delete value[index];
    }

    slice(value: Value, start: number | null, end: number | null): Value {
      return value.slice(start ?? 0, end ?? undefined);
    }

    replaceSlice(value: Value[], start: number | null, end: number | null, items: Value[]): void {
      const index = start === null ? 0 : start < 0 ? Math.max(0, value.length + start) : Math.min(value.length, start);
      const stop = end === null ? value.length : end < 0 ? value.length + end : Math.min(value.length, end);
      value.splice(index, Math.max(0, stop - index), ...items);
    }

    close(resource: Value): void { resource.close?.(); }

    truth(value: Value): boolean {
      if (Array.isArray(value)) return value.length > 0;
      if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.keys(value).length > 0;
      return Boolean(value);
    }

    binary(op: string, left: Value, right: Value): Value {
      switch (op) {
        case "+": return Array.isArray(left) && Array.isArray(right) ? left.concat(right) : left + right;
        case "-":
          if (left instanceof PythonDateTime && right instanceof PythonDateTime) {
            return { total_seconds: () => (left.time - right.time) / 1000 };
          }
          return left - right;
        case "*":
          if (typeof left === "string" && Number.isInteger(right)) return left.repeat(Math.max(0, right));
          if (typeof right === "string" && Number.isInteger(left)) return right.repeat(Math.max(0, left));
          if (Array.isArray(left) && Number.isInteger(right)) return Array.from({ length: Math.max(0, right) }, () => left).flat();
          return left * right;
        case "/": return left / right;
        case "//": return Math.floor(left / right);
        case "**": return left ** right;
        case "%":
          if (typeof left === "string") {
            const items = Array.isArray(right) ? [...right] : [right];
            return left.replace(/%%|%[sdif]/g, (part) => part === "%%" ? "%" : String(items.shift()));
          }
          return ((left % right) + right) % right;
        default: throw new Error(`Unsupported Python operator ${op}`);
      }
    }

    async compare(ops: string[], operands: (() => Promise<Value>)[]): Promise<boolean> {
      let left = await operands[0]();
      for (const [index, op] of ops.entries()) {
        const right = await operands[index + 1]();
        const equal = (a: Value, b: Value): boolean => Array.isArray(a) && Array.isArray(b)
          ? a.length === b.length && a.every((value, i) => equal(value, b[i])) : a === b;
        const contains = () => typeof right === "string" || Array.isArray(right) ? right.includes(left) : Object.hasOwn(right, left);
        const matches = op === "==" ? equal(left, right) : op === "!=" ? !equal(left, right)
          : op === "is" ? left === right : op === "is not" ? left !== right
          : op === "<" ? left < right : op === "<=" ? left <= right
          : op === ">" ? left > right : op === ">=" ? left >= right
          : op === "in" ? contains() : !contains();
        if (!matches) return false;
        left = right;
      }
      return true;
    }

    async boolean(and: boolean, operands: (() => Promise<Value>)[]): Promise<Value> {
      let value;
      for (const operand of operands) {
        value = await operand();
        if (this.truth(value) !== and) return value;
      }
      return value;
    }

    async generate(items: Iterable<Value>, callback: (p: PythonScope, item: Value) => Promise<Value[]>): Promise<Value[]> {
      const scope = new PythonScope(Object.create(null), this);
      const output = [];
      for (const item of items) output.push(...await callback(scope, item));
      return output;
    }

    callable(invoke: Call): Value { return { [pythonCall]: invoke }; }

    async call(fn: Value, args: Value[], kwargs: Record<string, Value>): Promise<Value> {
      if (fn?.[pythonCall]) return (await fn[pythonCall](args, kwargs)) ?? null;
      if (typeof fn !== "function") throw new Error("Python value is not callable");
      return (await fn(...args, ...(Object.keys(kwargs).length ? [kwargs] : []))) ?? null;
    }

    functionOf(names: string[], defaults: Value[], globals: string[], extra: string | null, body: PythonCode): Value {
      return this.callable(async (args, kwargs) => {
        const scope = new PythonScope(Object.create(null), this, new Set(globals));
        const rest = { ...kwargs };
        for (const [index, name] of names.entries()) {
          const defaultIndex = index - names.length + defaults.length;
          if (index < args.length) scope.set(name, args[index]);
          else if (Object.hasOwn(kwargs, name)) scope.set(name, kwargs[name]);
          else if (defaultIndex >= 0) scope.set(name, defaults[defaultIndex]);
          else throw new Error(`Missing Python argument: ${name}`);
          delete rest[name];
        }
        if (extra) scope.set(extra, rest);
        return body(scope);
      });
    }

    makeClass(base: Value, methods: Record<string, Value>): Value {
      const inherited = { ...base?.methods, ...methods };
      const factory = this.callable(async (args, kwargs) => {
        const instance: Record<string, Value> = {};
        for (const [name, method] of Object.entries(inherited)) {
          instance[name] = this.callable((pos, named) => this.call(method, [instance, ...pos], named));
        }
        if (instance.__init__) await this.call(instance.__init__, args, kwargs);
        return instance;
      });
      factory.methods = inherited;
      return factory;
    }
  }
}
