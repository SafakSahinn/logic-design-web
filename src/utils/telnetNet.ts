// Telnet part network layer (Aşama 5c-2b). The desktop app's preload exposes `window.ldsNet` (the Electron main
// process runs one TCP server per port, shared by every Telnet part on it, like Logisim-evolution's
// TelnetServer.ServerHolder); the web version has no sockets, there the part's terminal window is its only client.

/** One TCP server as the main process reports it */
export interface LdsNetStatus {
  port: number;
  /** address it listens on: 127.0.0.1, or 0.0.0.0 when the app-wide network setting is on */
  host: string;
  listening: boolean;
  clients: number;
  /** listen error code (EADDRINUSE, EACCES, ...) */
  error?: string;
  /** the last part on this port let go of it: the server is gone */
  closed?: boolean;
}

/** Bridge from electron/preload.cjs; its presence means the desktop app */
export interface LdsNet {
  /** a Telnet part (id) wants the server on `port`; telnetMode strips IAC sequences and announces WILL SGA/ECHO */
  open(id: string, port: number, telnetMode: boolean): void;
  close(id: string): void;
  /** bytes the circuit sent through part `id` go to the newest client on its port */
  send(id: string, bytes: number[]): void;
  /** bytes a client sent to `port` (telnet escapes already removed) */
  onRx(cb: (port: number, bytes: number[]) => void): () => void;
  onStatus(cb: (status: LdsNetStatus) => void): () => void;
  /** app-wide setting (desktop only, not saved in the circuit): accept connections from the network (0.0.0.0) */
  getLan(): Promise<boolean>;
  setLan(on: boolean): Promise<boolean>;
}

export function getLdsNet(): LdsNet | null {
  if (typeof window === 'undefined') return null;
  const net = (window as unknown as { ldsNet?: LdsNet }).ldsNet;
  return net && typeof net.open === 'function' ? net : null;
}

/**
 * The terminal window's screen for bytes the circuit sent: printable bytes are UTF-8 decoded per line, LF and CR
 * start a new line (CR LF counts once), backspace (8) deletes the last byte and form feed (12) clears the screen,
 * as the TTY part treats them; other control bytes are not shown. Only the last `maxLines` lines are kept.
 */
export function terminalScreen(bytes: number[], maxLines = 500): string[] {
  const done: number[][] = [];
  let line: number[] = [];
  let lastCr = false;
  for (const b of bytes) {
    const cr = b === 13;
    if (b === 10 || cr) {
      if (!(b === 10 && lastCr)) {
        done.push(line);
        line = [];
        if (done.length > maxLines) done.shift();
      }
    } else if (b === 8 || b === 127) {
      line.pop();
    } else if (b === 12) {
      done.length = 0;
      line = [];
    } else if (b >= 32) {
      line.push(b);
    }
    lastCr = cr;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const lines = [...done, line].map((l) => decoder.decode(new Uint8Array(l)));
  return lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
}

/** Text typed or pasted into the terminal window as bytes: UTF-8, CR LF and lone CR become LF (10) */
export function textToTelnetBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text.replace(/\r\n?/g, '\n')));
}

/** A key pressed in the terminal window as the bytes a client sends, or null when the key sends nothing */
export function keyToTelnetBytes(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): number[] | null {
  if (e.altKey || e.metaKey) return null;
  if (e.ctrlKey) {
    // Ctrl+A..Ctrl+Z = 1..26 (Ctrl+C / Ctrl+V stay copy and paste)
    const k = e.key.toLowerCase();
    if (k.length === 1 && k >= 'a' && k <= 'z' && k !== 'c' && k !== 'v') return [k.charCodeAt(0) - 96];
    return null;
  }
  switch (e.key) {
    case 'Enter':
      return [10];
    case 'Backspace':
      return [8];
    case 'Tab':
      return [9];
    case 'Escape':
      return [27];
    case 'Delete':
      return [127];
    default:
      return e.key.length >= 1 && [...e.key].length === 1 ? textToTelnetBytes(e.key) : null;
  }
}
