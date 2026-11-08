namespace WebVN {
  type Segment = [time: number, duration: number, from: number, to: number, warper: string];

  export interface TitleAnimation {
    tracks: {
      property: string;
      segments: Segment[];
      repeat: number | null;
      start: number;
    }[];
    displayable?: string | null;
    particles?: {
      asset: string;
      start: number;
      x: number;
      y: number;
      explodeTime: number;
      numParticles: number;
      particleTime: number;
      particleXSpeed: number;
      particleYSpeed: number;
      gravity: number;
    } | null;
  }

  const properties: Record<string, [string, (value: number) => string]> = {
    xoffset: ["--atl-x-offset", (value) => `${value / 12.8}cqw`],
    yoffset: ["--atl-y-offset", (value) => `${value / 12.8}cqw`],
    xpos: ["--atl-x-position", (value) => `${value / 12.8}cqw`],
    ypos: ["--atl-y-position", (value) => `${value / 12.8}cqw`],
    zoom: ["--atl-scale", String],
    alpha: ["opacity", String],
  };

  function ease(name: string, value: number): number {
    switch (name) {
      case "ease": return (1 - Math.cos(Math.PI * value)) / 2;
      case "easeout": return 1 - Math.cos(Math.PI * value / 2);
      case "easein_quint": return 1 - (1 - value) ** 5;
      case "ease_cubic": return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
      case "easein_bounce": {
        const bounce = (t: number) => {
          if (t < 1 / 2.75) return 7.5625 * t * t;
          if (t < 2 / 2.75) return 7.5625 * (t - 1.5 / 2.75) ** 2 + 0.75;
          if (t < 2.5 / 2.75) return 7.5625 * (t - 2.25 / 2.75) ** 2 + 0.9375;
          return 7.5625 * (t - 2.625 / 2.75) ** 2 + 0.984375;
        };
        return bounce(value);
      }
      default: return value;
    }
  }

  export function animateTitleLayer(element: HTMLElement, definition: TitleAnimation, startTime: number): void {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const track of definition.tracks) {
      const spec = properties[track.property];
      if (!spec) continue;
      const [property, format] = spec;
      const [last] = track.segments.slice(-1);
      const duration = track.repeat ?? last[0] + last[1] - track.start;
      if (reduceMotion || duration <= 0) {
        element.style.setProperty(property, format(track.repeat ? track.segments[0][3] : last[3]));
        continue;
      }
      const frames: Keyframe[] = [];
      const add = (time: number, value: number) => {
        frames.push({ offset: Math.max(0, Math.min(1, (time - track.start) / duration)), [property]: format(value) });
      };
      add(track.start, track.segments[0][2]);
      let previous = track.segments[0][2];
      for (const [time, length, from, to, warper] of track.segments) {
        add(time, previous);
        if (length === 0) {
          add(time, to);
        } else {
          const steps = warper === "linear" ? 1 : Math.ceil(length * 60);
          for (let step = 1; step <= steps; step++) {
            const fraction = step / steps;
            add(time + length * fraction, from + (to - from) * ease(warper, fraction));
          }
        }
        previous = to;
      }
      add(track.start + duration, previous);
      const animation = element.animate(frames, {
        duration: duration * 1000, delay: track.start * 1000,
        iterations: track.repeat ? Infinity : 1, fill: "both",
      });
      animation.startTime = startTime;
    }
  }

  export function titleParticles(container: HTMLElement, path: string, definition: TitleAnimation, startTime: number): void {
    const particles = definition.particles;
    if (!particles || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const burst = document.createElement("div");
    burst.className = "title-layer title-particles";
    burst.style.left = `${particles.x / 12.8}%`;
    burst.style.top = `${particles.y / 7.2}%`;
    const delay = (particles.start + particles.explodeTime) * 1000;
    for (let index = 0; index < particles.numParticles; index++) {
      const image = new Image();
      image.addEventListener("load", () => { image.style.width = String(image.naturalWidth / 12.8) + "cqw"; }, { once: true });
      image.src = path;
      image.alt = "";
      burst.append(image);
      const speed = Math.random();
      const angle = Math.random() * 2 * Math.PI;
      const xSpeed = speed * Math.cos(angle) * particles.particleXSpeed;
      const ySpeed = speed * Math.sin(angle) * particles.particleYSpeed - 1;
      const frames = Array.from({ length: 25 }, (_, step) => {
        const time = step / 24 * particles.particleTime;
        const x = xSpeed * 120 * (time + 0.2);
        const y = ySpeed * 120 * (time + 0.2) + particles.gravity * time * time;
        return { transform: `translate(${x / 12.8}cqw, ${y / 12.8}cqw)` };
      });
      const animation = image.animate(frames, { duration: particles.particleTime * 1000, delay, fill: "forwards" });
      animation.startTime = startTime;
    }
    const visibility = burst.animate([{ visibility: "hidden", offset: 0 },
      { visibility: "visible", offset: 0 }, { visibility: "visible", offset: 1 }], {
      duration: particles.particleTime * 1000, delay, fill: "both",
    });
    visibility.startTime = startTime;
    void visibility.finished.then(() => burst.remove(), () => {});
    const opacity = definition.tracks.filter(({ property }) => property === "alpha");
    animateTitleLayer(burst, { tracks: opacity }, startTime);
    container.append(burst);
  }
}
