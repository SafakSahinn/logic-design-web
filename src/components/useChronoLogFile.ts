// Log file output of the chronogram (logging step c), after evolution's FilePanel + LogThread.
// - Desktop app: a file picked in a save dialog (overwrite / append / cancel when it exists) is appended to as the
//   history grows, flushed every 500 ms (LogThread.FLUSH_FREQUENCY); the file can be switched off and on again
//   (FilePanel enable button), writing goes on where it stopped.
// - Web: there is no file system, so the lines are held in memory and downloaded when the logging stops.
// The text is the same in both (chronogram.ts advanceChronoLogStream). The file and the on/off state are not saved:
// a reopened project starts with logging off, as evolution does.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Radix } from '../types/logic';
import type { WaveformSample } from '../utils/vcdGenerator';
import { advanceChronoLogStream, CHRONO_LOG_EOL, newChronoLogStream, type ChronoLogStream, type ChronoSignal } from '../utils/chronogram';

/** The desktop preload's log file bridge (electron/preload.cjs `ldsLog`) */
interface LdsLogBridge {
  choose: (suggestedName: string) => Promise<{ path: string } | { error: string } | null>;
  append: (file: string, text: string) => Promise<boolean>;
}
const logBridge = (): LdsLogBridge | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { ldsLog?: LdsLogBridge }).ldsLog;

/** evolution LogThread.FLUSH_FREQUENCY */
const FLUSH_MS = 500;

export interface ChronoLogFile {
  /** desktop: the log streams into a file; web: lines are held and downloaded */
  canStream: boolean;
  /** desktop: the picked file (null = none yet) */
  file: string | null;
  /** logging on */
  enabled: boolean;
  /** lines written (desktop) or held (web) since the file was picked / the logging started */
  lineCount: number;
  /** the last write or file error */
  error: string | null;
  /** desktop: pick a file; on success logging starts into it from the start of the history */
  choose: () => void;
  /** desktop: switch writing into the picked file off / on */
  setEnabled: (on: boolean) => void;
  /** web: start holding lines (from the start of the history) */
  startMemory: () => void;
  /** web: stop and download the held lines */
  stopMemory: () => void;
}

export function useChronoLogFile({
  samples,
  signals,
  radix,
  clockKey,
  header,
  fileBaseName,
  eol = CHRONO_LOG_EOL,
}: {
  samples: WaveformSample[];
  signals: ChronoSignal[];
  radix: Record<string, Radix> | undefined;
  clockKey: string | null;
  header: boolean;
  fileBaseName: string;
  eol?: string;
}): ChronoLogFile {
  const bridge = logBridge();
  const canStream = bridge !== undefined;
  const [file, setFile] = useState<string | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<ChronoLogStream>(newChronoLogStream());
  // lines not yet appended to the file (desktop) / every held line (web)
  const bufferRef = useRef<string[]>([]);
  const writingRef = useRef(false);
  // the inputs of the newest render, for the final write when the logging stops
  const inputsRef = useRef({ samples, signals, radix, clockKey, header });
  inputsRef.current = { samples, signals, radix, clockKey, header };

  const advance = useCallback((final: boolean) => {
    const { samples: smp, signals: sig, radix: rdx, clockKey: ck, header: hd } = inputsRef.current;
    const r = advanceChronoLogStream(streamRef.current, smp, sig, (k) => rdx?.[k] ?? '16', ck, hd, final);
    streamRef.current = r.stream;
    if (r.lines.length > 0) {
      bufferRef.current.push(...r.lines);
      setLineCount((n) => n + r.lines.length);
    }
  }, []);

  // desktop: append the buffered lines, one write at a time so the order holds, until the buffer is empty (lines
  // added during a write go in the next one)
  const flush = useCallback(async (target: string | null) => {
    if (!bridge || !target || writingRef.current) return;
    writingRef.current = true;
    while (bufferRef.current.length > 0) {
      const lines = bufferRef.current;
      bufferRef.current = [];
      const ok = await bridge.append(target, lines.map((l) => l + eol).join(''));
      if (!ok) {
        // evolution LogThread: a write error drops the file
        setError('Dosyaya yazılamadı; dosya bırakıldı.');
        setEnabledState(false);
        setFile(null);
        break;
      }
    }
    writingRef.current = false;
  }, [bridge, eol]);

  // the app closing (the simulator unmounting) writes what is left, as LogThread closes its writer
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    if (canStream && enabled && file) {
      advance(true);
      void flush(file);
    }
  };
  useEffect(() => () => closeRef.current(), []);

  // new slots, a new selection, time source or display base: the lines that are final now
  useEffect(() => {
    if (enabled) advance(false);
  }, [enabled, samples, signals, radix, clockKey, advance]);

  useEffect(() => {
    if (!canStream || !enabled || !file) return;
    const id = window.setInterval(() => void flush(file), FLUSH_MS);
    return () => window.clearInterval(id);
  }, [canStream, enabled, file, flush]);

  const choose = useCallback(() => {
    if (!bridge) return;
    void bridge.choose(`${fileBaseName}_log.txt`).then((r) => {
      if (!r) return;
      if ('error' in r) {
        setError(r.error);
        return;
      }
      streamRef.current = newChronoLogStream();
      bufferRef.current = [];
      setLineCount(0);
      setError(null);
      setFile(r.path);
      setEnabledState(true);
    });
  }, [bridge, fileBaseName]);

  const setEnabled = useCallback(
    (on: boolean) => {
      if (!file) return;
      if (!on && enabled) {
        // switching off writes the newest slot too and empties the buffer now
        advance(true);
        void flush(file);
      }
      setEnabledState(on);
    },
    [file, enabled, advance, flush]
  );

  const startMemory = useCallback(() => {
    streamRef.current = newChronoLogStream();
    bufferRef.current = [];
    setLineCount(0);
    setError(null);
    setEnabledState(true);
  }, []);

  const stopMemory = useCallback(() => {
    if (!enabled) return;
    advance(true);
    const text = bufferRef.current.map((l) => l + eol).join('');
    bufferRef.current = [];
    setEnabledState(false);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBaseName}_log.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [enabled, advance, eol, fileBaseName]);

  return { canStream, file, enabled, lineCount, error, choose, setEnabled, startMemory, stopMemory };
}
