// Tcl sandbox (Aşama 6d): one safe child interpreter per user script.
//
// Tcl can run programs (exec), open files and sockets, and load code. User scripts therefore never run in the
// master interpreter. Each one gets a child made with `interp create -safe`, which hides exec, open, socket,
// file, load, source, cd, glob, exit, encoding, fconfigure, ... (the child cannot call hidden commands).
// On top of that the sandbox:
// - hides `interp` (a child could create its own child, whose work would not count against the limits),
//   `after`, `vwait` and `update` (they wait on the event loop, which would block the page);
// - routes `while`, `for` and `time` through the master so every loop round runs one counted command: Tcl's
//   command limit is only checked when a command starts, and a compiled `while 1 {}` starts none;
// - routes `info` through the master, so the master can read the child's command count without calling a
//   command the script could have redefined;
// - replaces `puts` (a safe child has no channels) with a collector capped at OUTPUT_LIMIT bytes per run;
// - runs every call into the child with a command limit, a time limit and a recursion limit. Nothing calls
//   into the child outside those limits, so a script that redefines `set`, `proc`, ... stays bounded too.
//
// Values cross between JavaScript and Tcl only as hex text, decoded by the master (see wacl.ts).
import { tclString, type WaclRuntime } from './wacl';

/** Bounds for one call into the child */
export interface TclLimits {
  /** Commands the call may start */
  commands: number;
  /** Wall time for the call in milliseconds */
  timeMs: number;
}

export const DEFAULT_TCL_LIMITS: TclLimits = { commands: 2_000_000, timeMs: 2_000 };
/** Nested evaluations allowed in a child (Tcl's default is 1000) */
export const RECURSION_LIMIT = 500;
/** Characters of `puts` output kept per call */
export const OUTPUT_LIMIT = 64 * 1024;
/** Largest script or value accepted from the app (the call passes through the WebAssembly stack) */
export const MAX_TEXT_BYTES = 256 * 1024;

export interface TclOutcome {
  ok: boolean;
  /** The result, or the error message */
  result: string;
  /** The full error trace (Tcl's errorInfo) when !ok */
  errorInfo?: string;
  /** Line of the error in the evaluated script (1-based), when Tcl reports one */
  line?: number;
  /** Why the call was stopped, when a limit ended it */
  limit?: 'commands' | 'time';
  /** Text the script printed with puts, line by line (a last line without newline is kept) */
  output: string[];
  /** Output beyond OUTPUT_LIMIT was dropped */
  outputTruncated: boolean;
}

// Master-side helpers, installed once per runtime. Fixed text: no user value is ever spliced into it.
const MASTER_PRELUDE = String.raw`
namespace eval ::lds {
  variable out
  variable outSize
  variable outCut
  variable limit [expr {64 * 1024}]

  proc decode {hex} { encoding convertfrom utf-8 [binary decode hex $hex] }
  proc encode {text} { binary encode hex [encoding convertto utf-8 $text] }

  proc setup {c recursion} {
    foreach cmd {interp after vwait update while for time info puts} {
      interp hide $c $cmd
    }
    interp alias $c while {} ::lds::loopWhile $c
    interp alias $c for {} ::lds::loopFor $c
    interp alias $c time {} ::lds::loopTime $c
    interp alias $c info {} ::lds::childInfo $c
    interp alias $c puts {} ::lds::childPuts $c
    interp alias $c ::__lds_step {} ::lds::step
    interp recursionlimit $c $recursion
    # Bytecode tools: an assembled loop starts no command (so no limit fires) and bad code aborts the runtime
    interp eval $c {namespace delete ::tcl::unsupported}
    file mkdir /tmp/lds
  }

  proc step {} {}
  # (Names differ from the Tcl commands so the master's own code in ::lds never resolves to them.)
  # Hidden commands run in the caller's frame of the child, so loops see the caller's variables and
  # break / continue / return behave as usual.
  proc loopWhile {c args} {
    if {[llength $args] != 2} { return -code error {wrong # args: should be "while test command"} }
    lassign $args test body
    tailcall $c invokehidden while $test "::__lds_step;$body"
  }
  proc loopFor {c args} {
    if {[llength $args] != 4} { return -code error {wrong # args: should be "for start test next command"} }
    lassign $args start test next body
    tailcall $c invokehidden for $start $test $next "::__lds_step;$body"
  }
  proc loopTime {c args} {
    if {[llength $args] < 1 || [llength $args] > 2} { return -code error {wrong # args: should be "time command ?count?"} }
    set args [lreplace $args 0 0 "::__lds_step;[lindex $args 0]"]
    tailcall $c invokehidden time {*}$args
  }
  proc childInfo {c args} { tailcall $c invokehidden info {*}$args }

  proc childPuts {c args} {
    variable out
    variable outSize
    variable outCut
    variable limit
    set newline 1
    if {[lindex $args 0] eq "-nonewline"} { set newline 0; set args [lrange $args 1 end] }
    switch [llength $args] {
      1 { set text [lindex $args 0] }
      2 {
        if {[lindex $args 0] ni {stdout stderr}} {
          return -code error "can not find channel named \"[lindex $args 0]\""
        }
        set text [lindex $args 1]
      }
      default { return -code error {wrong # args: should be "puts ?-nonewline? ?channelId? string"} }
    }
    if {$newline} { append text \n }
    if {$outSize + [string length $text] > $limit} {
      set text [string range $text 0 [expr {$limit - $outSize - 1}]]
      set outCut 1
    }
    append out $text
    incr outSize [string length $text]
    return
  }

  # Runs a script (mode script) or one command given as a list (mode call) in the child under limits.
  # Returns the outcome as space-separated fields "h<hex>" (never empty): code result errorInfo errorLine
  # errorCode output outputCut.
  proc run {c mode text commands ms} {
    variable out {}
    variable outSize 0
    variable outCut 0
    set now [clock milliseconds]
    set count [$c invokehidden info cmdcount]
    interp limit $c commands -value [expr {min($count + $commands, 0x7fffffff)}]
    set end [expr {$now + $ms}]
    interp limit $c time -seconds [expr {$end / 1000}] -milliseconds [expr {$end % 1000}]
    if {$mode eq "call"} {
      set code [catch {interp eval $c $text} result options]
    } else {
      # Scripts go through the child's hidden "source" (from the in-memory file system of the WebAssembly
      # build, never the disk): unlike "eval" it reports the script's own line numbers, and the script cannot
      # redefine it.
      set path /tmp/lds/$c.tcl
      set f [open $path w]
      fconfigure $f -encoding utf-8 -translation lf
      ::puts -nonewline $f $text
      close $f
      set code [catch {$c invokehidden source -encoding utf-8 $path} result options]
      file delete $path
    }
    interp limit $c commands -value {}
    interp limit $c time -seconds {} -milliseconds {}
    set info {}
    set line {}
    set ecode {}
    if {$code == 1} {
      set info [dict get $options -errorinfo]
      set ecode [dict get $options -errorcode]
      if {$mode ne "call"} {
        # Keep the trace down to the script's own frame: "(script line N)" instead of the file and our frames.
        set marker "(file \"$path\" line "
        set at [string last $marker $info]
        if {$at >= 0} {
          set rest [string range $info [expr {$at + [string length $marker]}] end]
          if {[regexp {^([0-9]+)\)} $rest -> line]} {
            set info "[string range $info 0 [expr {$at - 1}]](script line $line)"
          }
        }
      }
    }
    return [join [lmap x [list $code $result $info $line $ecode $out $outCut] { string cat h [encode $x] }] { }]
  }
}
`;

const prepared = new WeakSet<WaclRuntime>();
let nextId = 1;

function master(runtime: WaclRuntime, script: string): string {
  const { code, result } = runtime.evalMaster(script);
  if (code !== 0) throw new Error(`Tcl sandbox error: ${result}`);
  return result;
}

function unhex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new RangeError(`Tcl text is larger than ${MAX_TEXT_BYTES / 1024} KB`);
  }
}

/** A Tcl list of the given words, written so the master builds it itself (no quoting rules involved) */
function tclList(words: string[]): string {
  return `[list ${words.map((w) => tclString(w)).join(' ')}]`;
}

export class TclSandbox {
  readonly name: string;
  private readonly runtime: WaclRuntime;
  private disposed = false;

  private constructor(runtime: WaclRuntime, name: string) {
    this.runtime = runtime;
    this.name = name;
  }

  static create(runtime: WaclRuntime): TclSandbox {
    if (!prepared.has(runtime)) {
      master(runtime, MASTER_PRELUDE);
      prepared.add(runtime);
    }
    const name = `lds_sandbox_${nextId++}`;
    master(runtime, `interp create -safe ${name}; ::lds::setup ${name} ${RECURSION_LIMIT}`);
    return new TclSandbox(runtime, name);
  }

  get usable(): boolean {
    return !this.disposed && !this.runtime.broken;
  }

  /**
   * Evaluates a script in the child's global scope. Tcl 8.6 stores text as UCS-2, so characters beyond U+FFFF
   * (emoji) do not survive; U+001A ends a sourced script in Tcl and is refused.
   */
  run(script: string, limits: TclLimits = DEFAULT_TCL_LIMITS): TclOutcome {
    checkSize(script);
    if (script.includes('\u001a')) throw new RangeError('A Tcl script cannot contain the character U+001A');
    return this.invoke('script', tclString(script), limits);
  }

  /** Calls one command with the given words (each word is passed as is, never re-parsed) */
  call(words: string[], limits: TclLimits = DEFAULT_TCL_LIMITS): TclOutcome {
    if (words.length === 0) throw new RangeError('A Tcl call needs a command name');
    for (const word of words) checkSize(word);
    return this.invoke('call', tclList(words), limits);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.runtime.broken) master(this.runtime, `interp delete ${this.name}`);
  }

  private invoke(mode: 'script' | 'call', text: string, limits: TclLimits): TclOutcome {
    if (this.disposed) throw new Error('The Tcl sandbox was disposed');
    const commands = Math.min(0x7fffffff, Math.max(1, Math.floor(limits.commands)));
    const ms = Math.max(1, Math.floor(limits.timeMs));
    const fields = master(this.runtime, `::lds::run ${this.name} ${mode} ${text} ${commands} ${ms}`).split(' ');
    const [code, result, errorInfo, line, errorCode, output, cut] = fields.map((field) => unhex(field.slice(1)));
    const ok = code === '0' || code === '2'; // 2 = return at top level
    const message = code === '3' || code === '4' ? `invoked "${code === '3' ? 'break' : 'continue'}" outside of a loop` : result;
    const outcome: TclOutcome = { ok, result: message, output: splitOutput(output), outputTruncated: cut === '1' };
    if (!ok) {
      outcome.errorInfo = errorInfo || result;
      const n = Number(line);
      if (line && Number.isInteger(n) && n > 0) outcome.line = n;
      if (errorCode.startsWith('TCL LIMIT COMMANDS')) outcome.limit = 'commands';
      else if (errorCode.startsWith('TCL LIMIT TIME')) outcome.limit = 'time';
    }
    return outcome;
  }
}

function splitOutput(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
