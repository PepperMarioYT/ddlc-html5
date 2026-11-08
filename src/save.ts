namespace WebVN {
  type Input =
    | { kind: "pause"; key: string; skipping?: boolean }
    | { kind: "choice"; key: string; index: number; skipping?: boolean }
    | { kind: "file"; name: string; present: boolean };

  export interface SavedGame {
    version: 1;
    player: string;
    entry: string;
    seed: number;
    state: string;
    inputs: Input[];
    times: number[];
    pending: string;
    savedAt: number;
  }

  const key = "webvn-slots:" + location.pathname;
  let slots: Record<string, SavedGame> = Object.create(null);
  try { slots = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { /* In-memory saves. */ }

  export function removeBrowserKey(key: string): void {
    try { localStorage.removeItem(key); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
      // File URLs may have no local storage. Reset still clears the in-memory session.
    }
  }

  export function clearSaveSlots(): void {
    removeBrowserKey(key);
    slots = Object.create(null);
  }

  export function savedGame(slot: string): SavedGame | undefined {
    const save = slots[slot];
    if (save?.version === 1 && typeof save.player === "string" && typeof save.entry === "string"
        && typeof save.state === "string" && Array.isArray(save.inputs) && Array.isArray(save.times)) return save;
  }

  export function saveSlots(): string[] { return Object.keys(slots); }

  export function writeSlot(slot: string, save?: SavedGame): void {
    if (save) slots[slot] = save;
    else delete slots[slot];
    try { localStorage.setItem(key, JSON.stringify(slots)); } catch { /* In-memory saves. */ }
  }

  export class GameRun {
    readonly seed: number;
    private randomState: number;
    private readonly inputs: Input[];
    private readonly times: number[];
    private inputCursor = 0;
    private timeCursor = 0;
    private replay: SavedGame | undefined;
    pending: string | undefined;
    entry = "";
    state = "";

    constructor(readonly player: string, save?: SavedGame) {
      this.seed = save?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0];
      this.randomState = this.seed;
      this.inputs = save ? [...save.inputs] : [];
      this.times = save ? [...save.times] : [];
      this.replay = save;
      this.state = save?.state ?? "";
    }

    get replaying(): boolean { return this.replay !== undefined; }

    random(): number {
      this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
      return this.randomState / 0x100000000;
    }

    now(): number {
      if (this.replaying && this.timeCursor < this.times.length) return this.times[this.timeCursor++];
      const time = Date.now();
      this.times.push(time);
      return time;
    }

    beforeInput(kind: "pause" | "choice", key: string, applyFile: (name: string, present: boolean) => void): Input | undefined {
      if (this.replaying) {
        let event = this.inputs[this.inputCursor];
        while (event?.kind === "file") {
          applyFile(event.name, event.present);
          event = this.inputs[++this.inputCursor];
        }
        if (event) {
          if (event.kind !== kind || event.key !== key) throw new Error("This save diverged from the current game script.");
          this.inputCursor++;
          return event;
        }
        if (this.replay?.pending !== key) throw new Error("The saved dialogue could not be reached.");
        this.replay = undefined;
      }
      this.pending = key;
    }

    record(input: Input): void {
      this.inputs.push(input);
      if (input.kind !== "file") this.pending = undefined;
    }

    checkpoint(): SavedGame | undefined {
      if (!this.pending || !this.entry || this.replaying) return;
      return {
        version: 1, player: this.player, entry: this.entry, seed: this.seed, state: this.state,
        inputs: [...this.inputs], times: [...this.times], pending: this.pending, savedAt: Date.now(),
      };
    }
  }
}
