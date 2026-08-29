import { MathQuillField, MathQuillView } from "#components";
import { PluginController } from "#plugins/PluginController.ts";
import type { CustomLatexCommand } from "#plugins/index.ts";
import "./index.less";
import { Config, configList } from "./config";

interface PendingCommand {
  mq: MathQuillField;
  command: string;
  cursorIndex: number;
  preview: HTMLElement | undefined;
  sourceElement: HTMLElement | undefined;
  onLatexChanged: ((latex: string) => void) | undefined;
  previewPointerDown: boolean;
}

type MathQuillFieldWithLatexWriter = MathQuillField & {
  write?: (latex: string) => unknown;
};

/** On JIS keyboards the same character can be reported as `¥`. */
function isBackslashKey(event: KeyboardEvent) {
  return event.key === "\\" || event.key === "¥";
}

function isModifierKey(key: string) {
  return ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(
    key
  );
}

/** Any printable ASCII character can be part of the LaTeX being composed. */
function getLatexInputCharacter(event: KeyboardEvent) {
  // Use the character, not the physical key code. International keyboard
  // layouts can use the same physical key for different shifted characters.
  if (event.key === "\\" || event.key === "¥") return "\\";
  return /^[\x20-\x7e]$/.test(event.key) ? event.key : undefined;
}

function parseBraceArgument(source: string, startIndex: number) {
  const start = startIndex + 1;
  let index = start;
  let depth = 1;
  while (index < source.length && depth > 0) {
    const character = source[index++];
    if (character === "{") depth++;
    else if (character === "}") depth--;
  }
  if (depth !== 0) return;
  return {
    value: source.slice(start, index - 1),
    endIndex: index,
  };
}

/**
 * Read the next TeX token for each template argument. Groups are passed
 * without their outer braces; a command or any other character is one token.
 */
function parseTemplateArguments(
  source: string,
  startIndex: number,
  count: number
) {
  const values: string[] = [];
  let index = startIndex;
  while (values.length < count) {
    // TeX ignores spaces between a control word and its arguments. Do not
    // consume trailing spaces when there is no following argument, though.
    const beforeWhitespace = index;
    while (source[index] === " ") index++;
    if (index >= source.length) {
      index = beforeWhitespace;
      break;
    }

    if (source[index] === "{") {
      const argument = parseBraceArgument(source, index);
      if (!argument) return;
      values.push(argument.value);
      index = argument.endIndex;
      continue;
    }

    if (source[index] === "\\") {
      const commandStart = index++;
      const nameMatch = /^[A-Za-z]+/.exec(source.slice(index));
      index += nameMatch?.[0].length ?? 1;
      values.push(source.slice(commandStart, index));
      continue;
    }

    values.push(source[index++]);
  }
  return { values, endIndex: index };
}

function maxTemplateArgument(expansion: string) {
  return Math.max(
    0,
    ...[...expansion.matchAll(/\$([1-9]\d*)/g)].map((match) => Number(match[1]))
  );
}

function expandCustomCommands(
  latex: string,
  customCommands: readonly CustomLatexCommand[]
) {
  let expanded = "";
  let index = 0;
  while (index < latex.length) {
    if (latex[index] !== "\\") {
      expanded += latex[index++];
      continue;
    }

    const nameMatch = /^[A-Za-z]+/.exec(latex.slice(index + 1));
    if (!nameMatch) {
      expanded += latex[index++];
      continue;
    }

    const [name] = nameMatch;
    const nameEndIndex = index + 1 + name.length;
    const customCommand = customCommands.find(
      (candidate) => candidate.name === name
    );
    if (!customCommand) {
      expanded += latex.slice(index, nameEndIndex);
      index = nameEndIndex;
      continue;
    }

    const parsedArguments = parseTemplateArguments(
      latex,
      nameEndIndex,
      maxTemplateArgument(customCommand.expansion)
    );
    if (!parsedArguments) {
      expanded += latex.slice(index, nameEndIndex);
      index = nameEndIndex;
      continue;
    }
    expanded += customCommand.expansion.replace(
      /\$([1-9]\d*)/g,
      (_, number: string) =>
        expandCustomCommands(
          parsedArguments.values[Number(number) - 1] ?? "",
          customCommands
        )
    );
    index = parsedArguments.endIndex;
  }
  return expanded;
}

/**
 * Adds a LaTeX entry box without patching MathQuill's private `CharCmds`
 * table. The completed contents are parsed by the calculator's MathQuill
 * instance.
 */
export default class BackslashCommands extends PluginController<Config> {
  static id = "backslash-commands" as const;
  static enabledByDefault = false;
  static config = configList;

  private pending: PendingCommand | undefined;
  private isEnabled = false;
  private customCommands: CustomLatexCommand[] = [];

  private setCustomCommands(commands: readonly CustomLatexCommand[]) {
    this.customCommands = commands.filter(
      (command) =>
        /^[A-Za-z]+$/.test(command.name) && command.expansion.length > 0
    );
  }

  private clearPending() {
    this.pending?.sourceElement?.classList.remove(
      "dsm-latex-command-input-active"
    );
    this.pending?.preview?.remove();
    this.pending = undefined;
  }

  /**
   * Desmos uses MathQuill's basic build, which omits LatexCommandInput.
   * Place an equivalent visual node next to the live cursor instead. The
   * preview owns a fake caret; the MathQuill cursor remains in its original
   * DOM position so repeated input cannot disturb MathQuill's internals.
   */
  private createPreview(mq: MathQuillField) {
    const sourceElement = mq.el();
    const cursor = sourceElement.querySelector(".dcg-mq-cursor");
    if (!(cursor instanceof HTMLElement) || !cursor.parentElement) return;

    const preview = document.createElement("span");
    preview.className = "dsm-latex-command-input";
    preview.setAttribute("aria-hidden", "true");
    cursor.parentElement.insertBefore(preview, cursor);
    preview.addEventListener("mousedown", this.previewMouseDownHandler);
    sourceElement.classList.add("dsm-latex-command-input-active");
    return { preview, sourceElement };
  }

  private updatePreview(pending: PendingCommand) {
    const { preview } = pending;
    if (!preview) return;

    const clampedIndex = Math.max(
      0,
      Math.min(pending.cursorIndex, pending.command.length)
    );
    pending.cursorIndex = clampedIndex;
    preview.dataset.cursorIndex = String(clampedIndex);
    preview.replaceChildren();

    const addCharacter = (text: string, index: number) => {
      const char = document.createElement("var");
      char.textContent = text;
      char.dataset.dsmCommandIndex = String(index);
      char.className = "dsm-latex-command-input-char";
      preview.append(char);
    };

    const addCaret = () => {
      const caret = document.createElement("span");
      caret.className = "dsm-latex-command-input-caret";
      preview.append(caret);
    };

    addCharacter("\\", 0);
    if (clampedIndex === 0) addCaret();
    for (let i = 0; i < pending.command.length; i++) {
      addCharacter(pending.command[i], i + 1);
      if (clampedIndex === i + 1) addCaret();
    }
  }

  private beginPendingCommand(
    mq: MathQuillField,
    onLatexChanged?: (latex: string) => void
  ) {
    const previewInfo = this.createPreview(mq);
    const pending: PendingCommand = {
      mq,
      command: "",
      cursorIndex: 0,
      preview: previewInfo?.preview,
      sourceElement: previewInfo?.sourceElement,
      onLatexChanged,
      previewPointerDown: false,
    };
    this.pending = pending;
    this.updatePreview(pending);
  }
  private commitPendingCommand(pending: PendingCommand) {
    this.clearPending();
    if (pending.command) this.insertPendingCommand(pending);
  }

  private readonly beforeInputHandler = (event: InputEvent) => {
    if (!this.pending) {
      // Fallback for environments where keydown does not expose the key. Only
      // accept an actual backslash here: `¥` may be committed by an IME.
      if (
        event.isComposing ||
        event.inputType !== "insertText" ||
        event.data !== "\\"
      ) {
        return;
      }
      const mq = this.calc.focusedMathQuill?.mq;
      if (!mq) return;
      event.preventDefault();
      this.beginPendingCommand(mq);
      return;
    }

    // `overrideKeystroke` runs before MathQuill's hidden textarea receives
    // the browser's text input. Suppress that second path while a command is
    // being collected.
    if (
      event.inputType === "insertText" ||
      event.inputType === "deleteContentBackward"
    ) {
      event.preventDefault();
    }
  };

  private readonly keydownHandler = (event: KeyboardEvent) => {
    const mq = this.calc.focusedMathQuill?.mq;
    if (
      !mq ||
      !(event.target instanceof Node) ||
      !mq.el().contains(event.target)
    ) {
      return;
    }
    if (mq.el().closest(".dsm-backslash-command-scoped-input")) return;
    const result = this.onMQKeystroke(event.key, event, mq);
    if (result === "cancel") event.stopImmediatePropagation();
  };

  private readonly mouseDownHandler = (event: MouseEvent) => {
    const { pending } = this;
    if (!pending) return;

    const { target } = event;
    if (target instanceof Node && pending.preview?.contains(target)) return;
    const focusedPending = this.getPendingForFocusedMathquill();
    if (focusedPending) this.commitPendingCommand(focusedPending);
  };

  private readonly focusOutHandler = (event: FocusEvent) => {
    const { pending } = this;
    const { target } = event;
    if (!(target instanceof Node) || !pending?.mq.el().contains(target)) return;

    queueMicrotask(() => {
      if (this.pending !== pending) return;
      if (pending.previewPointerDown) return;
      const { activeElement } = document;
      if (
        activeElement instanceof Node &&
        pending.mq.el().contains(activeElement)
      ) {
        return;
      }
      this.commitPendingCommand(pending);
    });
  };

  private readonly previewMouseDownHandler = (event: MouseEvent) => {
    const { pending } = this;
    const { target } = event;
    if (!(target instanceof HTMLElement) || !pending?.preview) return;

    const char = target.closest<HTMLElement>("[data-dsm-command-index]");
    if (!char || !pending.preview.contains(char)) return;
    const index = Number(char.dataset.dsmCommandIndex);
    if (!Number.isInteger(index)) return;

    event.preventDefault();
    event.stopPropagation();
    pending.previewPointerDown = true;
    setTimeout(() => {
      if (this.pending === pending) pending.previewPointerDown = false;
    });
    pending.cursorIndex = index;
    this.updatePreview(pending);
    pending.mq.focus();
  };

  private getPendingForMathquill(mq: MathQuillField | undefined) {
    if (!mq || !this.pending || this.pending.mq !== mq) {
      this.clearPending();
      return undefined;
    }
    return this.pending;
  }

  private getPendingForFocusedMathquill() {
    return this.getPendingForMathquill(this.calc.focusedMathQuill?.mq);
  }

  private insertPendingCommand(pending: PendingCommand) {
    const mq = pending.mq as MathQuillFieldWithLatexWriter;
    const latex = expandCustomCommands(
      `\\${pending.command}`,
      this.customCommands
    );
    const latexBefore = pending.mq.latex();

    // `write()` accepts complete LaTeX fragments, such as `\\frac{a}{b}`.
    if (typeof mq.write === "function") {
      mq.write(latex);
      const latexAfter = pending.mq.latex();
      if (latexAfter !== latexBefore) {
        this.syncPendingLatex(pending, latexAfter);
      }
    }
  }

  private syncPendingLatex(pending: PendingCommand, latex: string) {
    if (pending.onLatexChanged) pending.onLatexChanged(latex);
    else this.syncFocusedLatex(latex);
  }

  private syncFocusedLatex(latex: string) {
    const item = this.cc.getSelectedItem();
    if (!item) return;
    this.cc.dispatch({ type: "set-item-latex", id: item.id, latex });
  }

  /**
   * Handles a key from an InlineMathInputView without bypassing that view's
   * state owner when the command is committed.
   */
  handleInlineMathQuillKeystroke(
    key: string,
    event: KeyboardEvent,
    onLatexChanged: (latex: string) => void
  ) {
    const mq = MathQuillView.getFocusedMathquill();
    if (!mq) return;

    const latexBefore = mq.latex();
    const result = this.onMQKeystroke(key, event, mq, onLatexChanged);
    if (result !== "cancel") {
      mq.keystroke(key, event);
      const latexAfter = mq.latex();
      if (latexAfter !== latexBefore) onLatexChanged(latexAfter);
    }
  }

  private onMQKeystroke(
    key: string,
    event: KeyboardEvent,
    mq: MathQuillField,
    onLatexChanged?: (latex: string) => void
  ): undefined | "cancel" {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      this.clearPending();
      return;
    }

    const pending = this.getPendingForMathquill(mq);
    if (!pending) {
      if (!isBackslashKey(event)) return;
      event.preventDefault();
      this.beginPendingCommand(mq, onLatexChanged);
      return "cancel";
    }

    // Holding Shift for a capital command name must not commit the command.
    if (isModifierKey(event.key)) return "cancel";

    const latexInputCharacter = getLatexInputCharacter(event);
    if (latexInputCharacter) {
      event.preventDefault();
      pending.command =
        pending.command.slice(0, pending.cursorIndex) +
        latexInputCharacter +
        pending.command.slice(pending.cursorIndex);
      pending.cursorIndex++;
      this.updatePreview(pending);
      return "cancel";
    }

    if (key.endsWith("Left") || event.key === "ArrowLeft") {
      if (pending.cursorIndex === 0) {
        event.preventDefault();
        return "cancel";
      }
      event.preventDefault();
      pending.cursorIndex--;
      this.updatePreview(pending);
      return "cancel";
    }

    if (key.endsWith("Right") || event.key === "ArrowRight") {
      if (pending.cursorIndex === pending.command.length) {
        event.preventDefault();
        return "cancel";
      }
      event.preventDefault();
      pending.cursorIndex++;
      this.updatePreview(pending);
      return "cancel";
    }

    if (key.endsWith("Backspace")) {
      event.preventDefault();
      if (!pending.command) {
        this.clearPending();
        return "cancel";
      }
      if (pending.cursorIndex === 0) return "cancel";
      pending.command =
        pending.command.slice(0, pending.cursorIndex - 1) +
        pending.command.slice(pending.cursorIndex);
      pending.cursorIndex--;
      this.updatePreview(pending);
      return "cancel";
    }
    if (key === "Esc" || key === "Escape") {
      event.preventDefault();
      this.clearPending();
      return "cancel";
    }
    if (!pending.command) {
      this.clearPending();
      pending.mq.typedText("\\");
      return;
    }

    this.commitPendingCommand(pending);

    // These keys commit the entry without inserting an additional delimiter.
    if (key === "Tab" || key === "Enter") {
      event.preventDefault();
      return "cancel";
    }
    if (isBackslashKey(event)) {
      event.preventDefault();
      this.beginPendingCommand(pending.mq, pending.onLatexChanged);
      return "cancel";
    }
    // Normal delimiters proceed into MathQuill.
  }

  afterEnable() {
    if (this.isEnabled) return;
    this.isEnabled = true;
    this.setCustomCommands(this.settings.customCommands);
    document.addEventListener("keydown", this.keydownHandler, true);
    document.addEventListener("mousedown", this.mouseDownHandler, true);
    document.addEventListener("focusout", this.focusOutHandler, true);
    document.addEventListener("beforeinput", this.beforeInputHandler, true);
  }

  afterDisable() {
    if (!this.isEnabled) return;
    this.isEnabled = false;
    document.removeEventListener("keydown", this.keydownHandler, true);
    document.removeEventListener("mousedown", this.mouseDownHandler, true);
    document.removeEventListener("focusout", this.focusOutHandler, true);
    document.removeEventListener("beforeinput", this.beforeInputHandler, true);
    this.clearPending();
  }

  afterConfigChange() {
    this.setCustomCommands(this.settings.customCommands);
  }
}
