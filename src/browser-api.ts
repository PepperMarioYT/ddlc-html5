namespace WebVN {
  export interface BrowserServices {
    pause(seconds?: number): Promise<void>;
    choose(prompt: string, options: string[], presentation?: ChoicePresentation): Promise<number>;
    render(command: Instruction, value: Value): Promise<void>;
    check(): void;
  }

  const sessionStorageFallback = new Map<string, string>();

  export function clearGameProgress(): void {
    const key = "webvn:" + location.pathname;
    removeBrowserKey(key);
    sessionStorageFallback.delete(key);
  }

  export function browserScope(program: Program, player: string, host: BrowserServices, run?: GameRun): PythonScope {
    const storageKey = "webvn:" + location.pathname;
    const packaged = new Map(program.fileNames.map((name) => [name, program.files[name] ?? ""]));
    const userFiles = new Map(program.fileNames.filter((name) => name.endsWith(".chr"))
      .map((name) => ["characters/" + name, packaged.get(name)!]));
    let persistent: Record<string, Value> = {};
    try {
      let data = run?.state || sessionStorageFallback.get(storageKey);
      try { data ??= localStorage.getItem(storageKey) ?? undefined; } catch { /* In-memory mode. */ }
      const saved = JSON.parse(data ?? "{}");
      persistent = saved.persistent ?? {};
      for (const [path, contents] of Object.entries(saved.files ?? {})) {
        if (typeof contents === "string") userFiles.set(path, contents);
      }
      for (const path of saved.deleted ?? []) userFiles.delete(path);
    } catch { /* Local storage may be disabled for file URLs. */ }

    const snapshot = () => JSON.stringify({
      persistent, files: Object.fromEntries(userFiles),
      deleted: program.fileNames.filter((name) => name.endsWith(".chr")).map((name) => "characters/" + name)
        .filter((path) => !userFiles.has(path)),
    });
    if (run && !run.state) run.state = snapshot();
    const save = () => {
      if (run?.replaying) return;
      const data = snapshot();
      sessionStorageFallback.set(storageKey, data);
      try { localStorage.setItem(storageKey, data); } catch { /* In-memory mode. */ }
    };

    const normalize = (path: string) => path.replace(/\\/g, "/").replace(/^(?:\.\.\/|\.\/|\/)+/, "");
    function openFile(path: string, mode = "r", archive = false): Value {
      const key = normalize(path);
      if (mode.includes("w")) return { write(contents: string) { userFiles.set(key, contents); save(); }, close() {} };
      const contents = userFiles.get(key) ?? (archive ? packaged.get(key) : undefined);
      if (contents === undefined) throw new Error(`Virtual file missing: ${path}`);
      return { read: () => contents, close() {}, *[Symbol.iterator]() { yield* contents.split(/\r?\n/); } };
    }

    const randomValue = () => run?.random() ?? Math.random();
    const random = {
      random: randomValue,
      randint: (start: number, stop: number) => start + Math.floor(randomValue() * (stop - start + 1)),
      choice: (items: Value[]) => {
        if (!items.length) throw new Error("random.choice: empty sequence");
        return items[Math.floor(randomValue() * items.length)];
      },
    };
    const modules = {
      random, math: Math,
      singleton: { SingleInstance: () => ({}) },
      subprocess: { check_output: () => "" },
      os: { remove: (path: string) => { if (!userFiles.delete(normalize(path))) throw new Error(`Missing file: ${path}`); save(); }, environ: new Map() },
      datetime: { datetime: { now: () => new PythonDateTime(run?.now() ?? Date.now()) } },
    };
    const displaySurface = {
      get_width: () => 1280, get_height: () => 720, get_size: () => [1280, 720],
      fill() {}, blit() {}, subsurface: () => displaySurface,
    };
    const scope = new PythonScope(Object.create(null), undefined, new Set(), modules);
    const activeTracks = new Map<string, string>();
    let prompt = "";
    let buttons: { text: string; value: Value }[] = [];
    const ui = {
      text: (text: string) => { prompt = text; },
      vbox() {},
      close() {},
      saybehavior() {},
      textbutton: scope.callable(([text], opts) => buttons.push({ text, value: opts.clicked })),
      returns: (value: Value) => value,
      interact: async () => {
        const options = buttons;
        const message = prompt;
        buttons = [];
        prompt = "";
        if (!options.length) return host.pause();
        const index = await host.choose(message, options.map(({ text }) => text), "poem");
        return options[index].value;
      },
    };
    const render = (op: string, name?: string, value?: Value, fields: Partial<Instruction> = {}) =>
      host.render({ at: "browser API", op, name, ...fields }, value);
    const character = (dynamic: boolean) => scope.callable(([name], options) => ({
      name, dynamic, display_args: {}, what_args: {},
      add_history: (_kind: Value, who: string, what: string) => (scope.values._history_list ??= []).push({ who, what }),
      prefix: options.what_prefix, suffix: options.what_suffix,
    }));
    const dynamicExec = (source: string) => {
      const update = /^([a-zA-Z_]\w*)\s*\+=\s*(\d+)$/.exec(source);
      if (update) {
        scope.set(update[1], scope.binary("+", scope.get(update[1]), Number(update[2])));
        return;
      }
      const item = /^([a-zA-Z_]\w*)\[([a-zA-Z_]\w*)\]\s*=\s*(\d+)$/.exec(source);
      if (item) {
        scope.put(scope.get(item[1]), scope.get(item[2]), Number(item[3]));
        return;
      }
      throw new Error(`Unsupported dynamic Python assignment: ${source}`);
    };

    scope.values.__setTrack = (channel: string, track: Value) => {
      if (typeof track === "string") activeTracks.set(channel, track.replace(/^<[^>]+>/, ""));
      else activeTracks.delete(channel);
    };
    Object.assign(scope.values, {
      __tick: host.check, player, persistent, main_menu: true, config: {
        basedir: "", developer: false, skipping: false, keymap: { game_menu: ["mouseup_3"], hide_windows: [], dismiss: ["K_RETURN", "K_SPACE"] },
      }, style: { normal: {} }, preferences: {}, audio: {}, gui: { init() {} },
      build: { classify() {}, archive() {}, documentation() {} },
      _window_hide() {}, process_list: [], currentuser: "", truecenter: "truecenter",
      renpy: {
        random, ui, game: { preferences: {} }, file: (path: string) => openFile(path, "r", true),
        pause: (time?: number) => host.pause(time),
        jump: (label: string) => { throw new Transfer(label); },
        jump_out_of_context: (label: string) => { throw new Transfer(label); },
        list_saved_games: () => saveSlots(), unlink_save: (slot: string) => { if (!run?.replaying) writeSlot(slot); },
        save_persistent: save,
        full_restart: () => { save(); throw new EndSession(); },
        utter_restart: () => { save(); throw new EndSession(); },
        quit: () => { save(); throw new EndSession(); },
        block_rollback() {},
        display: {
          behavior: { clear_keymap_cache() {} },
          draw: { screenshot: () => displaySurface, set_mouse_pos() {} },
        },
        Render: () => ({
          blit() {},
          canvas: () => ({ get_surface: () => displaySurface }),
        }),
        get_physical_size: () => [1280, 720],
        register_shader() {},
        variant: () => false,
        loadsave: { location: { locations: [], unlink_persistent: () => {
          for (const key of Object.keys(persistent)) delete persistent[key];
          save();
        } } },
        get_mouse_pos: () => [0, 0],
        scene: () => render("scene"),
        show: scope.callable(([name], options) => render("show", name, options.zorder, {
          tag: options.tag, layer: options.layer, positions: options.at_list,
        })),
        hide: (name: string) => render("hide", name),
        play: (track: string) => render("audio", undefined, track, { action: "play", channel: "sound" }),
        music: {
          register_channel() {},
          get_pos: () => 0,
          get_playing: (channel = "music") => activeTracks.get(channel) ?? null,
          play: scope.callable(([track], opts) => render("audio", undefined, track, { action: "play", channel: opts.channel ?? "music" })),
          stop: scope.callable((_args, opts) => render("audio", undefined, null, { action: "stop", channel: opts.channel ?? "music" })),
        },
        call_screen: scope.callable(([name, ...args], options) => scope.call(scope.get(name), args, options)),
        display_menu: scope.callable(async ([items], options) => {
          const entries: [string, Value][] = items ?? options.items;
          if (options.interact === false) return null;
          const index = await host.choose("", entries.map(([text]) => text));
          return entries[index][1];
        }),
        windows: false, linux: false, macintosh: false,
        Displayable: scope.makeClass(null, {}),
      },
      ui, Character: character(false), DynamicCharacter: character(true),
      set: (items: Value[] = []) => {
        const members = new Set(items);
        return Object.assign(members, { intersection: (other: Value[]) => other.filter((item) => members.has(item)) });
      },
      map: async (callback: Value, items: Value[]) => Promise.all(items.map((item) => scope.call(callback, [item], {}))),
      list: (value: Iterable<Value>) => Array.from(value ?? []),
      len: (value: Value) => value.length ?? Object.keys(value).length,
      range: (first: number, last?: number, step = 1) => {
        const start = last === undefined ? 0 : first;
        const stop = last ?? first;
        if (step === 0) throw new Error("range step cannot be zero");
        return Array.from({ length: Math.max(0, Math.ceil((stop - start) / step)) }, (_, i) => start + i * step);
      },
      float: Number, int: (value: Value) => Math.trunc(Number(value)), str: String,
      min: Math.min, max: Math.max,
      all: (values: Value[]) => values.every((value) => scope.truth(value)),
      enumerate: (values: Value[]) => values.map((value, index) => [index, value]),
      sorted: scope.callable(async ([values], opts) => {
        const items = values[Symbol.iterator] ? [...values] : Object.keys(values);
        const pairs = await Promise.all(items.map(async (item) => [item, opts.key ? await scope.call(opts.key, [item], {}) : item]));
        return pairs.sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(([item]) => item);
      }),
      __screen_args: scope.callable((args, options) => ({ args, options })),
      Solid: (color: string) => ({ color }),
      Text: scope.callable(([text], options) => ({ text, style: options.style })),
      Return: (value: Value = null) => value,
      Quit: () => null,
      dialog: scope.callable(async ([message], options) => {
        await host.choose(message ?? options.message, ["OK"], "confirm");
        return options.ok_action;
      }),
      confirm: async (message: string, yes: Value, no: Value) =>
        await host.choose(message, ["Yes", "No"], "confirm") === 0 ? yes : no,
      open: openFile, globals: () => scope.values,
      eval: (name: string) => {
        if (!/^[a-zA-Z_]\w*$/.test(name)) throw new Error(`Unsupported dynamic Python expression: ${name}`);
        return scope.get(name);
      },
      exec: dynamicExec,
      _: (text: string) => text,
      object: scope.makeClass(null, {}),
      Borders: (...insets: number[]) => ({ insets }),
      MultipleTransition: (steps: Value[]) => ({ transition: "multiple", steps }),
      ImageDissolve: (_image: string, seconds: number) => ({ transition: "dissolve", seconds }),
      Dissolve: (seconds: number) => ({ transition: "dissolve", seconds }),
      Pause: (seconds: number) => ({ transition: "pause", seconds }),
    });
    for (const name of Object.keys(program.transforms)) scope.set(name, name);
    for (const name of program.styles) scope.values.style[name] ??= {};
    scope.values.__gameFiles = {
      list: () => program.fileNames.filter((name) => name.endsWith(".chr")).map((name) =>
        ({ name, present: userFiles.has("characters/" + name) })),
      set: (name: string, present: boolean) => {
        if (!packaged.has(name) || !name.endsWith(".chr")) return;
        if (present) userFiles.set("characters/" + name, packaged.get(name)!);
        else userFiles.delete("characters/" + name);
        save();
      },
    };
    return scope;
  }
}
