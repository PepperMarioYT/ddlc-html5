namespace WebVN {
  const startButton = document.querySelector<HTMLButtonElement>("#start-ddlc")!;
  const startup = document.querySelector<HTMLElement>("#startup")!;
  const startupContent = document.querySelector<HTMLElement>("#startup-content")!;
  const filesReset = document.querySelector<HTMLButtonElement>("#files-open-reset")!;
  const resetDialog = document.querySelector<HTMLDialogElement>("#reset-dialog")!;
  const resetForm = document.querySelector<HTMLFormElement>("#reset-form")!;
  const resetInput = document.querySelector<HTMLInputElement>("#reset-text")!;
  const resetSubmit = document.querySelector<HTMLButtonElement>("#reset-submit")!;
  const resetCancel = document.querySelector<HTMLButtonElement>("#reset-cancel")!;
  const resetError = document.querySelector<HTMLElement>("#reset-error")!;
  const title = document.querySelector<HTMLElement>(".title-screen")!;
  const opening = document.querySelector<HTMLElement>("#opening")!;
  const priorBackdrop = document.querySelector<HTMLElement>("#prior-backdrop")!;
  const backdrop = document.querySelector<HTMLElement>("#backdrop")!;
  const skipIndicator = document.querySelector<HTMLElement>("#skip-indicator")!;
  const screenEffects = document.querySelector<HTMLElement>("#screen-effects")!;
  const spriteLayer = document.querySelector<HTMLElement>("#sprites")!;
  const speaker = document.querySelector<HTMLElement>("#speaker")!;
  const announcement = document.querySelector<HTMLElement>("#dialogue-announcement")!;
  const line = document.querySelector<HTMLElement>("#line")!;
  const advance = document.querySelector<HTMLButtonElement>("#advance")!;
  const reading = document.querySelector<HTMLElement>("#reading")!;
  const choicePanel = document.querySelector<HTMLElement>("#choice-panel")!;
  const choicePrompt = document.querySelector<HTMLElement>("#choice-prompt")!;
  const choices = document.querySelector<HTMLElement>("#choices")!;
  const titleArt = document.querySelector<HTMLElement>("#title-art")!;
  const titleNavigation = document.querySelector<HTMLElement>("#title-navigation")!;
  const quickNavigation = document.querySelector<HTMLElement>("#quick-navigation")!;
  const menuDialog = document.querySelector<HTMLDialogElement>("#menu-dialog")!;
  const menuHeading = document.querySelector<HTMLElement>("#menu-heading")!;
  const menuNavigation = document.querySelector<HTMLElement>("#menu-navigation")!;
  const menuContent = document.querySelector<HTMLElement>("#menu-content")!;
  const nameLabel = document.querySelector<HTMLLabelElement>('[for="player-name"]')!;
  const back = document.querySelector<HTMLButtonElement>("#back")!;
  const error = document.querySelector<HTMLElement>("#load-error")!;
  const nameDialog = document.querySelector<HTMLDialogElement>("#name-dialog")!;
  const fileDialog = document.querySelector<HTMLDialogElement>("#game-files")!;
  const fileList = document.querySelector<HTMLUListElement>("#file-list")!;
  const openFiles = document.querySelector<HTMLButtonElement>("#open-files")!;
  const nameInput = document.querySelector<HTMLInputElement>("#player-name")!;

  const sprites = new Map<string, { element: HTMLDivElement; order: number; image?: string }>();
  const audio = new Map<string, HTMLAudioElement>();
  const activeAudio = new Map<string, string>();
  const volumeRamps = new Map<HTMLAudioElement, number>();
  let session: AbortController | undefined;
  let activeScope: PythonScope | undefined;
  let nextBeat: (() => void) | undefined;
  let modeChanged: (() => void) | undefined;
  let textSpeed = dialogueSettings.speed;
  let pauseText = "";
  let currentRuntime: Runtime | undefined;
  let currentRun: GameRun | undefined;
  const levels = new Map<string, number>([["music", 1], ["sound", 1], ["voice", 1]]);
  let muted = false;
  let autoDelay = dialogueSettings.autoDelay ?? 1.8;
  let skipUnseen = dialogueSettings.skipUnseen ?? false;
  let skipAfterChoices = dialogueSettings.skipAfterChoices ?? false;
  let skipping = false;
  let canSkipLine = false;
  let currentLineId: string | undefined;
  let controlSkip = false;


  function channelVolume(channel: string): number {
    return muted ? 0 : levels.get(channel.startsWith("music") ? "music" : channel) ?? 1;
  }

  function applyLevels(): void {
    for (const [channel, player] of audio) ramp(player, channelVolume(channel), 0);
  }
  let auto = false;
  let pendingEntry: string | undefined;
  let titleRefresh = 0;
  let titleTrack: string | undefined;
  let startupMusicAllowed = false;
  let audioUnlocked = false;
  let primedTitleAudio: HTMLAudioElement | undefined;
  let savePage = 1;

  function refreshSkipControl(): void {
    const button = quickNavigation.querySelector<HTMLButtonElement>('[data-menu-action="skip"]');
    const available = skipping || (canSkipLine && choicePanel.hidden);
    button?.setAttribute("aria-pressed", String(skipping));
    button?.setAttribute("aria-disabled", String(!available));
    if (button) button.title = available ? "" : "Enable Unseen Text in Settings to skip new dialogue.";
  }

  function setSkip(enabled: boolean): void {
    skipping = enabled;
    skipIndicator.hidden = !enabled;
    if (activeScope) activeScope.values.config.skipping = enabled;
    refreshSkipControl();
    modeChanged?.();
  }

  function display(text: string, speed = 0): DialogueReveal {
    // Match the dialogue keys from existing browser saves.
    pauseText = text.replace(/\{(?:nw|fast|w(?:=[\d.]+)?)\}/g, "").replace(/\{\/?i\}/g, "");
    const reveal = makeDialogue(line, text, speed);
    announcement.textContent = line.textContent;
    return reveal;
  }

  function findImage(name: string): string | undefined {
    if (game.images[name]) return name;
    const words = name.split(" ");
    while (words.length > 1) {
      words.pop();
      const candidate = words.join(" ");
      if (game.images[candidate]) return candidate;
    }
  }

  function assetPath(name: string): string | undefined {
    return game.assets[name] ?? game.assets["images/" + name];
  }

  function renderSprite(command: Instruction, order: Value, expression?: Value): void {
    const name = typeof expression === "string" ? expression : command.name ?? "";
    const tag = command.tag ?? (name.split(" ")[0] || command.at);
    if (!tag) return;
    const key = (command.layer ?? "master") + ":" + tag;
    if (command.op === "hide") {
      sprites.get(key)?.element.remove();
      sprites.delete(key);
      return;
    }

    let sprite = sprites.get(key);
    const imageName = findImage(name);
    const path = typeof expression === "string" ? assetPath(expression) : undefined;
    const text = typeof expression?.text === "string" ? expression.text : undefined;
    const color = typeof expression?.color === "string" ? expression.color : undefined;
    if (!sprite && !imageName && !path && text === undefined && !color) return;
    if (!sprite) {
      const element = document.createElement("div");
      element.className = "sprite";
      element.style.left = "50%";
      spriteLayer.append(element);
      sprite = { element, order: 0 };
      sprites.set(key, sprite);
    }
    const { element } = sprite;
    if (imageName && imageName !== sprite.image) {
      sprite.image = imageName;
      element.replaceChildren(...game.images[imageName].map((path) => {
        const image = new Image();
        image.alt = "";
        image.src = path;
        return image;
      }));
    }
    if (path) {
      const image = new Image();
      image.src = path;
      image.alt = "";
      element.replaceChildren(image);
    } else if (text !== undefined) {
      element.classList.add("sprite-text");
      element.textContent = text;
    } else if (color) {
      element.classList.add("sprite-solid");
      element.style.backgroundColor = color.startsWith("#") ? color : "#" + color;
    }
    const position = command.positions?.at(-1);
    if (position) {
      const transform = game.transforms[position];
      const base = transform?.alias ? game.transforms[transform.alias[0]] : transform;
      const values = Object.fromEntries(Object.entries(base?.params ?? {}).map(([name, value], index) =>
        [name, transform?.alias?.[1][index] ?? Number(value)]));
      const numeric = (value: string) => value.split("*").reduce((total, part) => total * (values[part] ?? Number(part)), 1);
      const horizontal = numeric(base?.properties.xcenter ?? base?.properties.xpos ?? "");
      if (horizontal) element.style.left = `${horizontal < 1 ? horizontal * 100 : horizontal / 12.8}%`;
      const vertical = numeric(base?.properties.ypos ?? "");
      if (vertical) element.style.bottom = `${(1 - vertical) * 100}%`;
      const zoom = numeric(base?.properties.zoom ?? "");
      if (zoom) element.style.width = `${75 * zoom}%`;
      element.classList.remove("focus");
    }
    if (typeof order === "number") sprite.order = order;
    const front = sprites.get((command.layer ?? "master") + ":" + command.behind?.[0]);
    element.style.zIndex = String(front ? Math.min(sprite.order, front.order - 1) : sprite.order);
    if (sprite.image && game.images[sprite.image][0].includes("/gui/poemgame/")) {
      element.classList.add("poem-sticker");
      const align = Number(game.transforms[position ?? ""]?.properties.yalign);
      if (Number.isFinite(align)) {
        element.style.top = String(align * 100) + "%";
        element.style.bottom = "auto";
        element.style.transform = "translate(-50%, -" + String(align * 100) + "%)";
      }
      const image = element.querySelector("img");
      if (image) {
        const size = () => { element.style.width = String(image.naturalWidth / 12.8) + "%"; };
        if (image.complete) size();
        else image.addEventListener("load", size, { once: true });
      }
      if (name.endsWith(" hop") && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const steps = game.transforms.sticker_hop?.vertical ?? [];
        const duration = steps.reduce((sum, [seconds]) => sum + seconds, 0);
        if (duration > 0) {
          let elapsed = 0;
          const frames = [{ offset: 0, translate: "0 0" }];
          for (const [seconds, offset] of steps) {
            elapsed += seconds;
            frames.push({ offset: elapsed / duration, translate: "0 " + String(offset / 12.8) + "cqw" });
          }
          element.animate(frames, duration * 1000);
        }
      }
    }
  }

  function ramp(player: HTMLAudioElement, target: number, seconds: number, done?: () => void): void {
    const old = volumeRamps.get(player);
    if (old !== undefined) cancelAnimationFrame(old);
    const start = performance.now();
    const initial = player.volume;
    function frame(now: number): void {
      const fraction = seconds > 0 ? Math.min(1, (now - start) / (seconds * 1000)) : 1;
      player.volume = initial + (target - initial) * fraction;
      if (fraction < 1) volumeRamps.set(player, requestAnimationFrame(frame));
      else { volumeRamps.delete(player); done?.(); }
    }
    frame(start);
  }

  function renderAudio(command: Instruction, value: Value): void {
    const channel = command.channel ?? "music";
    const previous = audio.get(channel);
    const options = command.audioOptions;
    if (command.action === "stop") {
      if (previous) ramp(previous, 0, options?.fadeout ?? 0, () => previous.pause());
      activeAudio.delete(channel);
      audio.delete(channel);
      return;
    }
    const tracks = (Array.isArray(value) ? value : [value]).filter((track): track is string => typeof track === "string");
    if (!tracks.length) return;
    const first = tracks[0];
    if (options?.ifChanged && activeAudio.get(channel) === first) return;

    function playTrack(index: number): void {
      const track = tracks[index];
      const source = /^(?:<([^>]+)>)?(.*)$/.exec(track)!;
      const start = Number(/\bfrom\s+([\d.]+)/.exec(source[1] ?? "")?.[1] ?? 0);
      const loopStart = Number(/\bloop\s+([\d.]+)/.exec(source[1] ?? "")?.[1] ?? 0);
      const player = command.at === "title" ? primedTitleAudio ?? new Audio() : new Audio();
      player.src = game.audioRoot + source[2];
      audio.set(channel, player);
      activeAudio.set(channel, track);
      const shouldLoop = options?.loop ?? channel.startsWith("music");
      player.loop = shouldLoop && loopStart === 0 && index === tracks.length - 1;
      player.volume = options?.fadein ? 0 : channelVolume(channel);
      if (options?.fadein) ramp(player, channelVolume(channel), options.fadein);
      if (start) player.addEventListener("loadedmetadata", () => { player.currentTime = start; }, { once: true });
      player.onended = () => {
        if (audio.get(channel) !== player) return;
        if (index + 1 < tracks.length) playTrack(index + 1);
        else if (shouldLoop && loopStart) {
          player.currentTime = loopStart;
          void player.play().catch(() => {});
        }
      };
      void player.play().catch(() => {});
    }

    if (command.action === "queue" && previous && !previous.paused) {
      previous.loop = false;
      previous.addEventListener("ended", () => {
        if (audio.get(channel) !== previous) return;
        previous.pause();
        playTrack(0);
      }, { once: true });
    } else {
      if (previous) ramp(previous, 0, options?.fadeout ?? 0, () => previous.pause());
      playTrack(0);
    }
  }

  function returnToTitle(): void {
    session?.abort();
    if (menuDialog.open) menuDialog.close();
    if (fileDialog.open) fileDialog.close();
    session = undefined;
    activeScope = undefined;
    currentRuntime = undefined;
    currentRun = undefined;
    auto = false;
    setSkip(false);
    controlSkip = false;
    canSkipLine = false;
    currentLineId = undefined;
    quickNavigation.hidden = true;
    nextBeat = undefined;
    modeChanged = undefined;
    audio.forEach((player) => player.pause());
    audio.clear();
    activeAudio.clear();
    volumeRamps.forEach((frame, player) => { cancelAnimationFrame(frame); player.pause(); });
    volumeRamps.clear();
    opening.hidden = true;
    title.hidden = false;
    titleNavigation.replaceChildren();
    openFiles.disabled = true;
    void updateTitle().then(() => { if (!title.hidden) titleNavigation.querySelector("button")?.focus(); });
  }

  function browserHost(signal: AbortSignal, run?: GameRun): Host & BrowserServices {
    const check = () => signal.throwIfAborted();
    const replayAudio = new Map<string, [Instruction, Value]>();
    let previousBackground: { image: string; color: string } | undefined;
    let transition: Animation | undefined;
    function wait<T>(register: (resolve: (value: T) => void) => (() => void)): Promise<T> {
      check();
      return new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(signal.reason); };
        const cleanup = register((value) => {
          signal.removeEventListener("abort", abort);
          cleanup();
          resolve(value);
        });
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    function replayInput(kind: "pause" | "choice", key: string) {
      const wasReplaying = run?.replaying;
      const input = run?.beforeInput(kind, key, (name, present) => activeScope?.get("__gameFiles").set(name, present));
      if (input && input.kind !== "file" && input.skipping !== undefined) setSkip(input.skipping);
      if (wasReplaying && !run?.replaying) {
        activeScope?.values.renpy.save_persistent();
        for (const [command, value] of replayAudio.values()) renderAudio(command, value);
        replayAudio.clear();
      }
      return input;
    }

    function waitForLine(reveal?: DialogueReveal, seconds?: number, automatic = false, abortable = true): Promise<void> {
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      return wait<void>((resolve) => {
        let frame: number | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let elapsed = 0;
        let previous = performance.now();
        let revealed = !reveal || reveal.duration <= 0 || reducedMotion;
        const modalOpen = () => menuDialog.open || fileDialog.open || resetDialog.open;
        const paint = () => reveal?.draw(Infinity);
        function schedule(): void {
          clearTimeout(timer);
          if (!revealed) return;
          const delay = automatic ? 0 : seconds ?? (skipping && canSkipLine ? 0.06 : auto ? autoDelay : undefined);
          if (delay === undefined) return;
          const finish = () => {
            if (modalOpen()) timer = setTimeout(finish, 150);
            else resolve();
          };
          timer = setTimeout(finish, delay * 1000);
        }
        function finishReveal(): void {
          if (frame !== undefined) cancelAnimationFrame(frame);
          revealed = true;
          paint();
          advance.hidden = automatic;
          schedule();
        }
        function tick(now: number): void {
          if (!modalOpen()) elapsed += Math.max(0, now - previous);
          previous = now;
          if (!reveal || elapsed >= reveal.duration) finishReveal();
          else {
            reveal.draw(elapsed);
            frame = requestAnimationFrame(tick);
          }
        }
        nextBeat = () => {
          if (modalOpen()) return;
          if (!revealed) {
            if (abortable) finishReveal();
          } else resolve();
        };
        modeChanged = () => {
          if (skipping && canSkipLine && !revealed) finishReveal();
          else schedule();
        };
        advance.hidden = !revealed || automatic;
        if (revealed || (skipping && canSkipLine)) finishReveal();
        else frame = requestAnimationFrame(tick);
        return () => {
          clearTimeout(timer);
          if (frame !== undefined) cancelAnimationFrame(frame);
          nextBeat = undefined;
          modeChanged = undefined;
        };
      });
    }

    async function pause(seconds?: number, reveal?: DialogueReveal, abortable = true): Promise<void> {
      if (seconds !== undefined && seconds <= 0) return;
      const key = JSON.stringify(["pause", speaker.textContent, pauseText, seconds]);
      if (replayInput("pause", key)) {
        reveal?.draw(Infinity);
        return;
      }
      await waitForLine(reveal, seconds, false, abortable);
      run?.record({ kind: "pause", key, skipping });
    }
    return {
      check, pause,
      async say(name, text, interact, id, abortable = true) {
        check();
        choicePanel.hidden = true;
        const style = currentRuntime?.scope.values.style;
        opening.classList.toggle("monika-dialogue", Boolean(style?.default_monika && style.say_dialogue === style.default_monika));
        speaker.hidden = !name;
        speaker.textContent = name;
        const lineId = id ?? JSON.stringify([name, text]);
        currentLineId = lineId;
        const canSkip = Boolean(currentRuntime?.scope.values.config.allow_skipping);
        canSkipLine = canSkip && (skipUnseen || readDialogue.has(lineId));
        if (!canSkipLine && !run?.replaying) setSkip(false);
        const defaultSpeed = Number(currentRuntime?.scope.values.preferences.text_cps ?? 50);
        const styleSpeed = style?.default_monika && style.say_dialogue === style.default_monika && currentRuntime
          ? Number(await currentRuntime.evaluate(game.styleProperties.default_monika?.slow_cps)) : 0;
        const noWait = text.includes("{nw}");
        const reveal = display(text, styleSpeed || (textSpeed ?? defaultSpeed));
        if (currentRuntime) await updateQuickMenu(currentRuntime);
        refreshSkipControl();
        if (interact && !noWait) await pause(undefined, reveal, abortable);
        else if (interact && !run?.replaying) await waitForLine(reveal, undefined, true, abortable);
        else reveal.draw(Infinity);
        if (!run?.replaying && !readDialogue.has(lineId)) {
          readDialogue.add(lineId);
          saveDialogueSettings();
        }
      },
      async choose(prompt, options, presentation = "story") {
        check();
        const key = JSON.stringify(["choice", prompt, options]);
        const recorded = replayInput("choice", key);
        if (recorded?.kind === "choice") return recorded.index;
        if (!skipAfterChoices) setSkip(false);
        speaker.hidden = true;
        display(prompt);
        advance.hidden = true;
        opening.dataset.choice = presentation;
        choicePanel.hidden = false;
        refreshSkipControl();
        choicePrompt.textContent = prompt;
        choicePrompt.hidden = !prompt;
        const index = await wait<number>((resolve) => {
          choices.replaceChildren(...options.map((text, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "menu-button";
            button.textContent = text;
            button.addEventListener("click", () => resolve(index), { once: true });
            return button;
          }));
          choicePanel.focus();
          return () => {
            choices.replaceChildren();
            choicePanel.hidden = true;
            refreshSkipControl();
            delete opening.dataset.choice;
            advance.hidden = false;
          };
        });
        run?.record({ kind: "choice", key, index, skipping });
        return index;
      },
      async render(command, value) {
        check();
        switch (command.op) {
          case "scene": {
            const name = typeof value === "string" ? value : command.name ?? "";
            const path = game.images[name]?.[0] ?? assetPath(name);
            if (!command.layer || command.layer === "master") {
              transition?.cancel();
              priorBackdrop.hidden = true;
              previousBackground = { image: backdrop.style.backgroundImage, color: backdrop.style.backgroundColor };
              backdrop.style.backgroundImage = path ? `url("${path}")` : "none";
              const color = value?.color;
              backdrop.style.backgroundColor = typeof color === "string" ? (color.startsWith("#") ? color : "#" + color) : name === "white" ? "white" : "#111";
            }
            const layer = (command.layer ?? "master") + ":";
            for (const [key, sprite] of sprites) {
              if (!key.startsWith(layer)) continue;
              sprite.element.remove();
              sprites.delete(key);
            }
            break;
          }
          case "show":
          case "hide":
            renderSprite(command, command.expression != null ? undefined : value, command.expression != null ? value : undefined);
            break;
          case "with":
            if (!matchMedia("(prefers-reduced-motion: reduce)").matches && previousBackground) {
              priorBackdrop.style.backgroundImage = previousBackground.image;
              priorBackdrop.style.backgroundColor = previousBackground.color;
              priorBackdrop.hidden = false;
              previousBackground = undefined;
              const frames = command.name?.startsWith("wipe")
                ? [{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0)" }]
                : [{ opacity: 0 }, { opacity: 1 }];
              transition?.cancel();
              const animation = backdrop.animate(frames, { duration: 330, easing: "ease-out" });
              transition = animation;
              void animation.finished.then(() => {
                if (transition === animation) priorBackdrop.hidden = true;
              }, () => {});
            }
            break;
          case "audio":
            if (run?.replaying) replayAudio.set(command.channel ?? "music", [command, value]);
            else renderAudio(command, value);
            break;
          case "pause":
            await pause(command.name ? Number(command.name) : undefined);
            break;
          case "screen":
            if (command.name === "tear" || command.name === "invert") {
              opening.classList.toggle("effect-" + command.name, command.action !== "hide");
            } else if (command.name === "fake_skip_indicator") {
              screenEffects.textContent = command.action === "hide" ? "" : "Skipping";
            } else if (command.name === "quick_menu") {
              quickNavigation.hidden = command.action === "hide";
            } else if (command.name === "poem") {
              const poem = value?.args?.[0];
              reading.hidden = command.action === "hide" || !poem;
              if (poem) {
                const paper = value.options?.paper ?? "paper";
                const paperPath = game.images[paper]?.[0];
                reading.style.backgroundImage = paperPath ? 'url("' + paperPath + '")' : "";
                reading.dataset.author = poem.yuri_3 ? "yuri-alt" : poem.author;
                reading.scrollTop = 0;
                const heading = document.createElement("h2");
                heading.textContent = poem.title;
                const contents = document.createElement("p");
                contents.textContent = poem.text;
                reading.replaceChildren(heading, contents);
              }
            }
            break;
          case "layer":
          case "window":
            break;
        }
      },
    };
  }

  async function play(player: string, entry?: string, save?: SavedGame): Promise<void> {
    if (session) returnToTitle();
    if (titleTrack && activeAudio.get("music") === titleTrack) renderAudio({ at: "title", op: "audio", channel: "music", action: "stop" }, null);
    const run = new GameRun(player, save);
    currentRun = run;
    const controller = new AbortController();
    session = controller;
    const host = browserHost(controller.signal, run);
    const scope = browserScope(game, player, host, run);
    activeScope = scope;
    const runtime = new Runtime(game, scope, gameCode, host);
    currentRuntime = runtime;
    error.hidden = true;
    title.hidden = true;
    opening.hidden = false;
    choicePanel.hidden = true;
    delete opening.dataset.choice;
    quickNavigation.replaceChildren();
    reading.hidden = true;
    spriteLayer.replaceChildren();
    sprites.clear();
    screenEffects.textContent = "";
    opening.classList.remove("effect-tear", "effect-invert");
    priorBackdrop.hidden = true;
    backdrop.style.backgroundImage = "none";
    speaker.hidden = true;
    display("");
    opening.focus();
    try {
      const issues = await runtime.initialize();
      if (issues.length) console.warn("Ren’Py initialization compatibility gaps", issues);
      const gui = scope.values.gui;
      const sizes: Record<string, string> = {
        "textbox-height": "textbox_height", "line-x": "text_xpos", "line-y": "text_ypos",
        "line-width": "text_width", "line-size": "text_size", "name-x": "name_xpos",
        "name-y": "name_ypos", "name-width": "namebox_width", "name-height": "namebox_height",
        "name-size": "name_text_size", "choice-width": "choice_button_width", "choice-gap": "choice_spacing",
      };
      for (const [variable, property] of Object.entries(sizes)) {
        if (typeof gui[property] === "number") opening.style.setProperty("--" + variable, String(gui[property] / 12.8) + "cqw");
      }
      if (typeof gui.textbox_yalign === "number") opening.style.setProperty("--textbox-align", String(gui.textbox_yalign));
      scope.set("main_menu", false);
      scope.values.persistent.playername = player;
      scope.values.renpy.save_persistent();
      const autoload = scope.values.persistent.autoload;
      run.entry = entry ?? (typeof autoload === "string" && game.labels[autoload] ? autoload : game.entry);
      if (run.entry === game.entry) await runtime.beforeStart();
      await runtime.run(run.entry);
      if (run.replaying) throw new Error("The saved dialogue could not be reached.");
      host.check();
      returnToTitle();
    } catch (problem) {
      if (controller.signal.aborted) return;
      returnToTitle();
      if (problem instanceof EndSession) return;
      error.textContent = problem instanceof Error ? problem.message : String(problem);
      error.hidden = false;
    }
  }

  interface MenuAction {
    kind: string;
    target?: string;
    message?: string;
    argument?: string;
  }

  async function visitScreen(runtime: Runtime, node: ScreenNode, visit: (node: ScreenNode) => Promise<void>): Promise<void> {
    if (node.kind === "SLIf") {
      for (const [condition, branch] of node.branches ?? []) {
        if (condition !== null && !runtime.scope.truth(await runtime.evaluate(condition))) continue;
        await visitScreen(runtime, branch, visit);
        break;
      }
      return;
    }
    if (node.kind === "SLUse" && node.target) {
      const screen = game.screens[node.target]?.[0];
      if (screen) await visitScreen(runtime, screen, visit);
      return;
    }
    if (node.kind === "SLDisplayable") await visit(node);
    for (const child of node.children ?? []) await visitScreen(runtime, child, visit);
  }

  function menuScope(runtime: Runtime): void {
    const { scope } = runtime;
    const action = (kind: string) => (target?: string): MenuAction => ({ kind, target });
    Object.assign(scope.values, {
      _in_replay: false,
      Start: action("start"), ShowMenu: action("menu"), Help: action("help"),
      Quit: action("quit"), Skip: action("skip"),
      Preference: (target: string, argument?: string): MenuAction => ({ kind: "preference", target, argument }),
      Play: (channel: string, track: string): MenuAction => ({ kind: "play", target: channel, argument: track }),
      VariableInputValue: () => null,
      MainMenu: action("title"), NullAction: action("disabled"), EndReplay: action("disabled"),
      Hide: action("hide"), Function: () => null, SensitiveIf: (value: boolean) => value,
      If: scope.callable(([test], options) => scope.truth(test) ? options.true : options.false),
      Show: scope.callable((_args, options) => ({ kind: "show", target: options.screen, message: options.message })),
    });
    scope.values.renpy.get_screen = () => null;
    scope.values.config.sample_sound ??= scope.values.gui.activate_sound;
    scope.values.config.sample_voice ??= null;
  }

  function titleImage(container: HTMLElement, name: string, startTime: number): void {
    const animation = game.titleAtl[name];
    if (animation?.particles) {
      const path = assetPath(animation.particles.asset);
      if (path) titleParticles(container, path, animation, startTime);
      return;
    }
    const path = game.images[name]?.[0];
    const fill = game.imageColors[animation?.displayable ?? name];
    const layout = game.imageLayouts[name];
    let layer: HTMLElement;
    if (path) {
      const image = new Image();
      image.alt = "";
      layer = image;
      image.style.visibility = "hidden";
      image.addEventListener("load", () => {
        image.style.width = `${image.naturalWidth / 12.8}%`;
        image.style.visibility = "visible";
      }, { once: true });
      if (layout?.xcenter != null && layout.ycenter != null) {
        image.style.left = `${layout.xcenter / 12.8}%`;
        image.style.top = `${layout.ycenter / 7.2}%`;
        image.classList.add("title-centered");
      }
      image.src = path;
    } else if (fill) {
      layer = document.createElement("div");
      layer.classList.add("title-fill");
      layer.style.backgroundColor = fill;
    } else return;

    layer.classList.add("title-layer", "title-atl");
    if (layout?.zoom != null) layer.style.setProperty("--atl-scale", String(layout.zoom));
    container.append(layer);
    if (animation) animateTitleLayer(layer, animation, startTime);
  }

  function startTitleAudio(): void {
    if (!audioUnlocked || (title.hidden && !startupMusicAllowed) || !titleTrack || activeAudio.get("music") === titleTrack) return;
    renderAudio({ at: "title", op: "audio", channel: "music", action: "play" }, titleTrack);
  }

  async function screenHeading(runtime: Runtime, screen: string): Promise<string> {
    const first = game.screens[screen]?.[0]?.children?.find((node) => node.kind === "SLUse");
    const caption = first?.bindings?.find(([key]) => key === null);
    return caption ? String(await runtime.evaluate(caption[1])) : screen;
  }

  function openMenu(heading: string, ...children: Node[]): void {
    menuDialog.classList.remove("ddlc-menu");
    menuNavigation.hidden = true;
    menuHeading.textContent = heading;
    menuContent.replaceChildren(...children);
    if (!menuDialog.open) menuDialog.showModal();
  }

  async function openGameMenu(runtime: Runtime, heading: string, ...children: Node[]): Promise<void> {
    const sidebar = document.createDocumentFragment();
    menuScope(runtime);
    await visitScreen(runtime, game.screens.navigation[0], async (node) => {
      const button = await navigationButton(runtime, node);
      if (button) {
        button.removeAttribute("id");
        if (button.textContent === heading) button.setAttribute("aria-current", "page");
        sidebar.append(button);
      }
    });
    menuHeading.textContent = heading;
    menuContent.replaceChildren(...children);
    menuContent.scrollTop = 0;
    menuNavigation.replaceChildren(sidebar);
    menuNavigation.hidden = false;
    menuDialog.classList.add("ddlc-menu");
    if (!menuDialog.open) menuDialog.showModal();
  }

  function paragraph(text: string): HTMLParagraphElement {
    const item = document.createElement("p");
    item.textContent = text;
    return item;
  }

  async function showMenu(runtime: Runtime, screen: string): Promise<void> {
    const heading = await screenHeading(runtime, screen);
    menuDialog.dataset.screen = screen;
    if (screen === "history") {
      const history: { who?: string; what: string }[] = runtime.scope.values._history_list ?? [];
      await openGameMenu(runtime, heading, ...history.map(({ who, what }) => paragraph(who ? `${who}  ${what}` : what)));
    } else if (screen === "preferences") {
      const controls = document.createElement("div");
      controls.className = "preferences";
      runtime.scope.values.renpy.variant = (name: string) => name === "pc";
      const settings = game.screens.preferences[0].children?.find((node) => node.kind === "SLUse")?.content;
      let caption = "";
      if (settings) await visitScreen(runtime, settings, async (node) => {
        if (node.style === "label" && node.args?.length) {
          caption = String(await runtime.evaluate(node.args[0]));
          if (caption === "Display" || caption === "Skip") {
            const label = document.createElement("h3");
            label.textContent = caption;
            controls.append(label);
          }
        } else if (node.properties?.value != null && node.style !== "input") {
          const speedControl = caption === "Text Speed";
          const value: MenuAction = speedControl ? { kind: "speed" } : await runtime.evaluate(node.properties.value);
          const channel = value.target?.split(" ")[0] ?? "";
          const level = levels.get(channel);
          if (!speedControl && value.target !== "auto-forward time" && level === undefined) return;
          const label = document.createElement("label");
          label.textContent = caption;
          const slider = document.createElement("input");
          slider.type = "range";
          slider.min = speedControl ? "0" : level === undefined ? "0.2" : "0";
          slider.max = speedControl ? "200" : level === undefined ? "8" : "1";
          slider.step = speedControl ? "5" : "0.01";
          slider.value = String(speedControl ? textSpeed ?? runtime.scope.values.preferences.text_cps : level ?? autoDelay);
          if (speedControl) slider.setAttribute("aria-valuetext", slider.value === "0" ? "Instant" : slider.value + " characters per second");
          slider.addEventListener("input", () => {
            if (speedControl) {
              textSpeed = dialogueSettings.speed = Number(slider.value);
              slider.setAttribute("aria-valuetext", textSpeed === 0 ? "Instant" : textSpeed + " characters per second");
              saveDialogueSettings();
            } else if (level === undefined) {
              autoDelay = dialogueSettings.autoDelay = Number(slider.value);
              saveDialogueSettings();
            }
            else {
              levels.set(channel, Number(slider.value));
              applyLevels();
            }
          });
          label.append(slider);
          controls.append(label);
        } else if (node.properties?.action != null && node.args?.length) {
          const action: MenuAction = await runtime.evaluate(node.properties.action);
          if (action.target === "rollback side" || (action.kind === "play" && !action.argument)) return;
          const button = await navigationButton(runtime, node);
          if (!button) return;
          if (action.target === "display") {
            button.classList.add("radio-option");
            const update = () => button.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement) === (action.argument === "fullscreen")));
            update();
            button.addEventListener("click", () => { setTimeout(update, 100); });
          }
          if (action.target === "skip" || action.target === "after choices" || action.target === "all mute") {
            button.classList.add("check-option");
            const active = () => action.target === "skip" ? skipUnseen : action.target === "after choices" ? skipAfterChoices : muted;
            button.setAttribute("aria-pressed", String(active()));
            button.addEventListener("click", () => button.setAttribute("aria-pressed", String(active())));
          }
          controls.append(button);
        }
      });
      const reset = document.createElement("button");
      reset.id = "open-reset";
      reset.type = "button";
      reset.className = "menu-button";
      reset.textContent = "Clear local storage…";
      reset.addEventListener("click", openReset);
      await openGameMenu(runtime, heading, controls, reset);
    } else if (screen === "save" || screen === "load") {
      const buttons = document.createElement("div");
      buttons.className = "save-slots";
      const gui = runtime.scope.values.gui;
      buttons.style.setProperty("--slot-columns", String(gui.file_slot_cols ?? 3));
      const count = Math.min(24, Math.max(1, (gui.file_slot_cols ?? 3) * (gui.file_slot_rows ?? 2)));
      for (let index = 1; index <= count; index++) {
        const slot = savePage === 1 ? String(index) : `${savePage}-${index}`;
        const save = savedGame(slot);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "menu-button";
        button.textContent = save ? `${index}. ${save.player} · ${new Date(save.savedAt).toLocaleString()}` : `${index}. Empty`;
        button.disabled = screen === "load" ? !save : !currentRun?.checkpoint();
        button.addEventListener("click", () => {
          if (screen === "load" && save) {
            menuDialog.close();
            void play(save.player, save.entry, save);
          } else {
            const checkpoint = currentRun?.checkpoint();
            if (!checkpoint || (save && !window.confirm("Overwrite this browser save?"))) return;
            writeSlot(slot, checkpoint);
            void showMenu(runtime, screen);
          }
        });
        const item = document.createElement("div");
        item.append(button);
        if (save) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "menu-button";
          remove.textContent = "Delete";
          remove.setAttribute("aria-label", `Delete save in slot ${index}`);
          remove.addEventListener("click", () => {
            if (!window.confirm("Delete this browser save?")) return;
            writeSlot(slot);
            void showMenu(runtime, screen);
          });
          item.append(remove);
        }
        buttons.append(item);
      }
      const pages = document.createElement("nav");
      pages.className = "save-pages";
      pages.setAttribute("aria-label", "Save pages");
      const slotScreen = game.screens.file_slots[0].children?.find((node) => node.kind === "SLUse")?.content;
      let pageNumbers: number[] = [];
      if (slotScreen) {
        const findPageLoop = (node: ScreenNode): ScreenNode | undefined => node.kind === "SLFor" && node.variable === "page"
          ? node : node.children?.map(findPageLoop).find((child) => child !== undefined);
        const loop = findPageLoop(slotScreen);
        if (loop) pageNumbers = await runtime.evaluate(loop.expression);
      }
      for (const number of pageNumbers) {
        const page = document.createElement("button");
        page.type = "button";
        page.className = "menu-button";
        page.textContent = String(number);
        if (number === savePage) page.setAttribute("aria-current", "page");
        page.addEventListener("click", () => {
          savePage = number;
          void showMenu(runtime, screen);
        });
        pages.append(page);
      }
      await openGameMenu(runtime, heading, buttons, pages);
    }
  }

  async function useMenuAction(runtime: Runtime, action: MenuAction): Promise<void> {
    switch (action.kind) {
      case "start": {
        if (menuDialog.open) menuDialog.close();
        const savedPlayer = runtime.scope.values.persistent.playername;
        if (savedPlayer) await play(savedPlayer, action.target);
        else requestName(action.target);
        break;
      }
      case "show":
        if (action.target === "name_input") requestName(undefined, action.message);
        break;
      case "menu":
        if (action.target) await showMenu(runtime, action.target);
        break;
      case "help": {
        const help = document.createElement("a");
        help.href = "original/" + (action.target ?? "README.html");
        help.target = "_blank";
        help.rel = "noopener";
        help.click();
        break;
      }
      case "title":
        if (menuDialog.open) menuDialog.close();
        returnToTitle();
        break;
      case "quit":
        if (session) returnToTitle();
        else openMenu("Quit", paragraph("Close this tab to quit the game."));
        break;
      case "skip":
        if (skipping) setSkip(false);
        else if (runtime.scope.values.config.allow_skipping && canSkipLine && choicePanel.hidden) {
          auto = false;
          quickNavigation.querySelector('[data-menu-action="auto-forward"]')?.setAttribute("aria-pressed", "false");
          setSkip(true);
        }
        break;
      case "play":
        if (action.target && action.argument) renderAudio({ at: "preferences", op: "audio", channel: action.target }, action.argument);
        break;
      case "preference":
        if (action.target === "auto-forward") {
          auto = !auto;
          if (auto) setSkip(false);
          modeChanged?.();
          quickNavigation.querySelector('[data-menu-action="auto-forward"]')?.setAttribute("aria-pressed", String(auto));
        } else if (action.target === "all mute") {
          muted = !muted;
          applyLevels();
        } else if (action.target === "skip") {
          skipUnseen = dialogueSettings.skipUnseen = !skipUnseen;
          canSkipLine = Boolean(activeScope?.values.config.allow_skipping)
            && (skipUnseen || (currentLineId !== undefined && readDialogue.has(currentLineId)));
          if (!canSkipLine) setSkip(false);
          refreshSkipControl();
          saveDialogueSettings();
        } else if (action.target === "after choices") {
          skipAfterChoices = dialogueSettings.skipAfterChoices = !skipAfterChoices;
          saveDialogueSettings();
        } else if (action.target === "display") {
          if (action.argument === "fullscreen") await document.documentElement.requestFullscreen?.().catch(() => {});
          else if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => {});
        }
        break;
    }
  }

  function requestName(entry?: string, prompt?: string): void {
    pendingEntry = entry;
    nameLabel.textContent = prompt ?? "Enter your name";
    nameDialog.returnValue = "";
    nameDialog.showModal();
  }

  async function navigationButton(runtime: Runtime, node: ScreenNode): Promise<HTMLButtonElement | undefined> {
    if (!node.args?.length || node.properties?.action == null) return;
    const text = await runtime.evaluate(node.args[0]);
    if (typeof text !== "string" || text.startsWith("K_")) return;
    const value = await runtime.evaluate(node.properties.action);
    const action: MenuAction | undefined = Array.isArray(value) ? value.find((entry) => entry?.kind) : value;
    if (!action?.kind) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "navigation-button";
    button.textContent = text;
    if (action.kind === "skip" || action.target === "auto-forward") {
      button.dataset.menuAction = action.kind === "skip" ? "skip" : "auto-forward";
      button.setAttribute("aria-pressed", "false");
    }
    button.disabled = action.kind === "disabled" || (Array.isArray(value) && value.includes(false));
    if (action.kind === "start" || action.target === "name_input") button.id = "new-game";
    if (runtime.scope.values.main_menu) {
      const style = game.styleProperties.navigation_button;
      const hover = await runtime.evaluate(style?.hover_sound);
      const select = await runtime.evaluate(style?.activate_sound);
      const sound = (track: Value) => {
        if (audioUnlocked && typeof track === "string") {
          renderAudio({ at: "navigation", op: "audio", channel: "sound", action: "play" }, track);
        }
      };
      button.addEventListener("pointerenter", () => sound(hover));
      button.addEventListener("click", () => sound(select));
    }
    button.addEventListener("click", () => {
      void useMenuAction(runtime, action).catch((problem: unknown) => {
        openMenu("Menu error", paragraph(problem instanceof Error ? problem.message : String(problem)));
      });
    });
    return button;
  }

  async function updateQuickMenu(runtime: Runtime): Promise<void> {
    const visible = runtime.scope.values.quick_menu && runtime === currentRuntime;
    quickNavigation.hidden = !visible;
    if (!visible || quickNavigation.childElementCount) return;
    menuScope(runtime);
    await visitScreen(runtime, game.screens.quick_menu[0], async (node) => {
      const button = await navigationButton(runtime, node);
      if (button) quickNavigation.append(button);
    });
  }

  async function updateTitle(): Promise<void> {
    const refresh = ++titleRefresh;
    const host = browserHost(new AbortController().signal);
    const scope = browserScope(game, "", host);
    const runtime = new Runtime(game, scope, gameCode, host);
    try {
      await runtime.initialize();
      menuScope(runtime);
      scope.values.renpy.variant = (name: string) => name === "pc";
      const persistent = scope.values.persistent;
      const ghost = runtime.scope.truth(await runtime.evaluate(game.titleMusic.ghostCondition));
      const ghostChanged = ghost !== Boolean(persistent.ghost_menu);
      if (ghostChanged) {
        persistent.ghost_menu = ghost;
        if (ghost) persistent.seen_ghost_menu = true;
      }
      const art = document.createElement("div");
      const timelineTime = document.timeline.currentTime;
      const startTime = typeof timelineTime === "number" ? timelineTime : performance.now();
      const navigation = document.createElement("div");
      const navigationLayout: Record<string, string> = {};
      const navigationStyle = game.styleProperties.navigation_button_text;
      const color = await runtime.evaluate(navigationStyle?.color);
      const outline = await runtime.evaluate(navigationStyle?.outlines);
      const hoverOutline = await runtime.evaluate(navigationStyle?.hover_outlines);
      await visitScreen(runtime, game.screens.main_menu[0], async (node) => {
        if (node.style === "vbox" && node.properties?.style_prefix != null
            && await runtime.evaluate(node.properties.style_prefix) === "navigation") {
          const x = Number(await runtime.evaluate(node.properties.xpos));
          const y = Number(await runtime.evaluate(node.properties.yalign));
          const gap = Number(await runtime.evaluate(node.properties.spacing));
          navigationLayout.left = String(x / 12.8) + "%";
          navigationLayout.top = String(y * 100) + "%";
          navigationLayout.transform = "translateY(-" + String(y * 100) + "%)";
          navigationLayout.gap = String(gap / 12.8) + "cqw";
        }
        if (node.properties?.action != null) {
          const button = await navigationButton(runtime, node);
          if (button) navigation.append(button);
        } else if (node.style === "frame") {
          const background = game.styleProperties.main_menu_frame?.background;
          const name = await runtime.evaluate(background);
          if (typeof name === "string") titleImage(art, name, startTime);
        } else if (node.args?.length && node.style !== "text") {
          const name = await runtime.evaluate(node.args[0]);
          if (typeof name === "string") titleImage(art, name, startTime);
        }
      });
      if (!navigation.querySelector("#new-game") && scope.values.persistent.autoload) {
        const resume = document.createElement("button");
        resume.id = "new-game";
        resume.type = "button";
        resume.className = "navigation-button";
        resume.textContent = "Resume";
        resume.addEventListener("click", () => { void useMenuAction(runtime, { kind: "start" }); });
        navigation.append(resume);
      }
      const track = persistent.ghost_menu && game.titleMusic.ghost != null
        ? await runtime.evaluate(game.titleMusic.ghost) : scope.values.config.main_menu_music;
      if (refresh !== titleRefresh) return;
      if (ghostChanged) scope.values.renpy.save_persistent();
      titleTrack = track;
      titleArt.replaceChildren(...art.childNodes);
      Object.assign(titleNavigation.style, navigationLayout);
      titleNavigation.style.setProperty("--navigation-color", color ?? "");
      titleNavigation.style.setProperty("--navigation-outline", outline?.[0]?.[1] ?? "");
      titleNavigation.style.setProperty("--navigation-hover-outline", hoverOutline?.[0]?.[1] ?? "");
      titleNavigation.replaceChildren(...navigation.childNodes);
      startTitleAudio();
    } catch (problem) {
      if (refresh !== titleRefresh) return;
      error.textContent = problem instanceof Error ? problem.message : String(problem);
      error.hidden = false;
    } finally {
      if (refresh === titleRefresh) openFiles.disabled = false;
    }
  }

  function updateFiles(scope: PythonScope): void {
    const files = scope.get("__gameFiles");
    fileList.replaceChildren(...files.list().map(({ name, present }: { name: string; present: boolean }) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name + (present ? "" : " (removed)");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-button";
      button.textContent = present ? "Remove" : "Restore";
      button.setAttribute("aria-label", button.textContent + " " + name);
      button.addEventListener("click", () => {
        files.set(name, !present);
        if (scope === activeScope) currentRun?.record({ kind: "file", name, present: !present });
        updateFiles(scope);
        fileList.querySelector<HTMLButtonElement>(`[aria-label="${present ? "Restore" : "Remove"} ${CSS.escape(name)}"]`)?.focus();
      });
      item.append(label, button);
      return item;
    }));
  }

  openFiles.addEventListener("click", () => {
    if (fileDialog.open) return;
    const scope = activeScope ?? browserScope(game, "", browserHost(new AbortController().signal));
    updateFiles(scope);
    fileDialog.showModal();
  });

  function startupImage(name: string): string | undefined {
    return game.images[name]?.[0];
  }

  function setStartupBackground(name?: string): void {
    const path = name ? startupImage(name) : undefined;
    startup.style.backgroundImage = path ? 'url("' + path + '")' : "";
  }

  async function loadStartupFiles(): Promise<void> {
    const paths = new Set<string>();
    const add = (path: string | undefined) => { if (path) paths.add(path); };
    for (const [name, animation] of Object.entries(game.titleAtl)) {
      add(startupImage(name));
      if (animation.particles) add(assetPath(animation.particles.asset));
    }
    add(startupImage("intro"));
    add(startupImage(game.startup.consent.background));
    add(startupImage(game.startup.consent.acceptedBackground));
    for (const name of ["gui/textbox.png", "gui/namebox.png"]) add(assetPath(name));

    const progress = document.createElement("progress");
    progress.id = "startup-progress";
    progress.max = paths.size;
    progress.value = 0;
    progress.setAttribute("aria-label", "Game files loaded");
    const heading = document.createElement("h1");
    heading.textContent = "Loading game files";
    const status = document.createElement("p");
    status.id = "startup-status";
    status.setAttribute("role", "status");
    status.textContent = "Preparing the game…";
    startupContent.replaceChildren(heading, progress, status);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let completed = 0;
    const results = await Promise.allSettled([...paths].map(async (path) => {
      const image = new Image();
      image.src = path;
      try { await image.decode(); }
      catch (error) { throw new Error("Could not load " + path, { cause: error }); }
      finally {
        progress.value = ++completed;
        status.textContent = completed + " of " + paths.size + " startup files loaded";
      }
    }));
    const failed = results.find((item) => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  function startupButton(text: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button";
    button.textContent = text;
    return button;
  }

  function waitForConsent(): Promise<void> {
    const consent = game.startup.consent;
    setStartupBackground(consent.background);
    startupContent.classList.add("startup-warning");
    const heading = document.createElement("h1");
    heading.textContent = "Content warning";
    const copy = consent.warnings.map((text) => {
      const url = /https?:\/\/[^\s]+$/.exec(text);
      if (!url) return paragraph(text);
      const message = paragraph(text.slice(0, url.index));
      const link = document.createElement("a");
      link.href = url[0];
      link.textContent = "Read the content warnings";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      message.append(link);
      return message;
    });
    const agreement = paragraph(consent.statement);
    const accept = startupButton(consent.accept);
    accept.id = "startup-agree";
    startupContent.replaceChildren(heading, ...copy, agreement, accept);
    heading.tabIndex = -1;
    heading.focus();
    return new Promise((resolve) => accept.addEventListener("click", () => resolve(), { once: true }));
  }

  function startupCard(element: HTMLElement, seconds: number): Promise<void> {
    const skip = startupButton("Continue");
    skip.classList.add("startup-continue");
    startupContent.replaceChildren(element, skip);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        skip.removeEventListener("click", done);
        resolve();
      };
      const timeout = setTimeout(done, seconds * 1000);
      skip.addEventListener("click", done, { once: true });
    });
  }

  async function runStartup(): Promise<void> {
    try {
      setStartupBackground();
      startupContent.classList.remove("startup-warning", "startup-splash");
      await loadStartupFiles();
      const host = browserHost(new AbortController().signal);
      const scope = browserScope(game, "", host);
      const runtime = new Runtime(game, scope, gameCode, host);
      await runtime.initialize();
      if (!scope.values.persistent.first_run) {
        await waitForConsent();
        scope.values.persistent.first_run = true;
        scope.values.renpy.save_persistent();
        startupContent.classList.remove("startup-warning");
        setStartupBackground(game.startup.consent.acceptedBackground);
        startupContent.replaceChildren();
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
      setStartupBackground();
      startupContent.classList.add("startup-splash");
      titleTrack = scope.values.config.main_menu_music;
      startupMusicAllowed = true;
      startTitleAudio();
      const logo = new Image();
      logo.alt = "Team Salvato";
      logo.src = startupImage("intro")!;
      await startupCard(logo, game.startup.intro.end);
      const warning = paragraph(String(await runtime.evaluate(game.startup.splash_warning.message)));
      warning.classList.add("startup-reminder");
      await startupCard(warning, game.startup.splash_warning.end - game.startup.intro.end);
      await updateTitle();
      startupMusicAllowed = false;
      startup.hidden = true;
      title.hidden = false;
      openFiles.hidden = false;
      startTitleAudio();
      titleNavigation.querySelector("button")?.focus();
    } catch (problem) {
      startupMusicAllowed = false;
      const heading = document.createElement("h1");
      heading.textContent = "Couldn’t load DDLC";
      const retry = startupButton("Retry");
      retry.addEventListener("click", () => { void runStartup(); }, { once: true });
      startupContent.classList.remove("startup-warning", "startup-splash");
      startupContent.replaceChildren(heading, paragraph(problem instanceof Error ? problem.message : String(problem)), retry);
      retry.focus();
    }
  }

  function openReset(): void {
    if (resetDialog.open) return;
    resetForm.reset();
    resetError.hidden = true;
    resetSubmit.disabled = true;
    resetDialog.showModal();
    resetInput.focus();
  }

  filesReset.addEventListener("click", openReset);
  const resetPhrase = "CLEAR DDLC DATA";
  resetInput.addEventListener("input", () => {
    resetSubmit.disabled = resetInput.value !== resetPhrase;
    resetError.hidden = true;
  });
  resetCancel.addEventListener("click", () => resetDialog.close());
  resetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (resetInput.value !== resetPhrase) return;
    try {
      clearDialogueSettings();
      clearSaveSlots();
      clearGameProgress();
      session?.abort();
      location.reload();
    } catch (problem) {
      resetError.textContent = "Browser storage could not be cleared. " + (problem instanceof Error ? problem.message : String(problem));
      resetError.hidden = false;
    }
  });

  function startGame(): void {
    if (audioUnlocked) return;
    audioUnlocked = true;
    document.removeEventListener("keydown", onStartKey, true);
    // Play a silent sample during the actual gesture, then reuse this element for the title track.
    primedTitleAudio = new Audio("data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==");
    void primedTitleAudio.play().catch(() => {});
    startButton.hidden = true;
    startup.hidden = false;
    void runStartup();
  }

  function onStartKey(event: KeyboardEvent): void {
    if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
        || ["Meta", "Alt", "Control", "Shift", "CapsLock"].includes(event.key)) return;
    event.preventDefault();
    startGame();
  }

  startButton.addEventListener("click", startGame);
  document.addEventListener("keydown", onStartKey, true);
  startButton.disabled = false;

  nameDialog.addEventListener("close", () => {
    if (nameDialog.returnValue === "start") void play(nameInput.value.trim() || "Player", pendingEntry);
  });
  back.addEventListener("click", returnToTitle);
  function advanceStory(): void {
    if (skipping) setSkip(false);
    else nextBeat?.();
  }

  advance.addEventListener("click", advanceStory);
  opening.addEventListener("contextmenu", (event) => {
    if (!currentRuntime || fileDialog.open || menuDialog.open) return;
    event.preventDefault();
    void showMenu(currentRuntime, "save");
  });
  opening.addEventListener("click", (event) => {
    if (!(event.target instanceof Element && event.target.closest("button, #reading"))) advanceStory();
  });
  document.addEventListener("keydown", (event) => {
    if (opening.hidden || fileDialog.open || menuDialog.open) return;
    if (event.key === "Control" && !event.repeat && !skipping && currentRuntime?.scope.values.config.allow_skipping
        && canSkipLine && choicePanel.hidden) {
      controlSkip = true;
      auto = false;
      quickNavigation.querySelector('[data-menu-action="auto-forward"]')?.setAttribute("aria-pressed", "false");
      setSkip(true);
    }
    if (event.key === "Escape" && currentRuntime) {
      event.preventDefault();
      void showMenu(currentRuntime, "save");
    }
    if ((event.key === " " || event.key === "Enter") && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      advanceStory();
    }
  });
  function releaseControlSkip(): void {
    if (!controlSkip) return;
    controlSkip = false;
    setSkip(false);
  }
  document.addEventListener("keyup", (event) => {
    if (event.key === "Control") releaseControlSkip();
  });
  window.addEventListener("blur", releaseControlSkip);
}
