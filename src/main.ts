import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, htmlToMarkdown, normalizePath, requestUrl } from 'obsidian';
import { EMPTY_STATE, type PluginState, type Settings } from './types';
import type { Env, Http, NoteMeta, VaultIO } from './io';
import { randomHex } from './io';
import { findClaudeCli, nodeExec } from './exec';
import {
  type Ctx,
  addLink,
  addQuickThought,
  digestExists,
  extractPositions,
  finishExercise,
  generateDigest,
  harvestAll,
  importSubstackRss,
  importSubstackZip,
  nextQuestion,
  runDaily,
  startExercise,
} from './pipeline';
import { sourceAtLine } from './digest';
import { inFolder } from './sources';
import { isDigestDue, localDate } from './scheduler';
import { rewriteRate } from './shifts';

const CHECK_EVERY_MS = 5 * 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function obsidianVault(app: App): VaultIO {
  const fileOf = (path: string) => app.vault.getFileByPath(normalizePath(`${path}.md`));
  const ensureFolder = async (path: string) => {
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = normalizePath(parts.slice(0, i).join('/'));
      if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
    }
  };
  return {
    list(): NoteMeta[] {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path.replace(/\.md$/, ''),
        ctime: f.stat.ctime,
        mtime: f.stat.mtime,
        frontmatter: (app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined) ?? null,
      }));
    },
    async read(path) {
      const f = fileOf(path);
      return f ? app.vault.read(f) : null;
    },
    async write(path, content) {
      const f = fileOf(path);
      if (f) return app.vault.modify(f, content);
      await ensureFolder(path);
      await app.vault.create(normalizePath(`${path}.md`), content);
    },
    exists(path) {
      return fileOf(path) !== null;
    },
  };
}

const obsidianHttp: Http = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method ?? 'GET', headers: req.headers, body: req.body, throw: false });
  return { status: res.status, text: res.text };
};

export default class ThinkingDigestPlugin extends Plugin {
  state: PluginState = EMPTY_STATE();
  private running = false;

  async onload(): Promise<void> {
    await this.loadState();
    this.addSettingTab(new DigestSettingTab(this.app, this));

    this.addCommand({ id: 'generate-digest', name: "Generate today's digest", callback: () => this.guarded('Digest', (c) => runDaily(c)) });
    this.addCommand({
      id: 'generate-digest-dry-run',
      name: 'Generate digest (dry run)',
      callback: () =>
        this.guarded('Dry run', async (c) => {
          const r = await generateDigest(c, { dryRun: true });
          if (r.path) await this.openNote(r.path);
          return r.message;
        }),
    });
    this.addCommand({
      id: 'harvest-now',
      name: 'Harvest now',
      callback: () =>
        this.guarded('Harvest', async (c) => {
          const r = await harvestAll(c);
          return `Harvested ${r.takes} take(s) from ${r.digests} digest(s); ${r.rejected} rejected.`;
        }),
    });
    this.addCommand({
      id: 'import-substack',
      name: 'Import Substack',
      callback: () =>
        this.guarded('Substack import', async (c) => {
          const r = await importSubstackRss(c);
          const kept = r.keptEdits.length ? ` Kept your edits in ${r.keptEdits.length} note(s).` : '';
          return `Substack: ${r.written} written, ${r.unchanged} unchanged.${kept}`;
        }),
    });
    this.addCommand({ id: 'import-substack-export', name: 'Import Substack export…', callback: () => this.pickExportZip() });
    this.addCommand({
      id: 'update-positions',
      name: 'Update positions now',
      callback: () =>
        this.guarded('Positions', async (c) => {
          const r = await extractPositions(c, { dryRun: false });
          return `Positions: ${r.sources} source(s) read, +${r.added}, ${r.superseded} updated, ${r.tensions} in tension.${r.failedBatches ? ` ${r.failedBatches} batch(es) failed; see console.` : ''}`;
        }),
    });
    this.addCommand({
      id: 'rebuild-positions-dry-run',
      name: 'Rebuild positions (dry run)',
      callback: () =>
        this.guarded('Positions dry run', async (c) => {
          const r = await extractPositions(c, { dryRun: true });
          await this.openNote(`${this.state.settings.positionsPath} (dry run)`);
          return `Dry-run ledger: ${r.added} position(s) from ${r.sources} source(s).`;
        }),
    });
    this.addCommand({
      id: 'open-today',
      name: "Open today's digest",
      callback: () => this.openNote(`${this.state.settings.digestFolder}/${localDate(new Date())}`),
    });
    this.addCommand({
      id: 'quick-thought',
      name: 'Quick thought',
      callback: () =>
        new QuickThoughtModal(this.app, (text) =>
          this.guarded('Saving thought', async (c) => `Added to ${await addQuickThought(c, text)}.`),
        ).open(),
    });
    this.addCommand({
      id: 'add-link',
      name: 'Add link',
      callback: () =>
        new AddLinkModal(this.app, (url, note) =>
          this.guarded('Saving link', async (c) => {
            const r = await addLink(c, url, note);
            await this.openNote(r.path);
            return r.bodyRead ? `Saved to ${r.path}.` : `Saved the link only (the page didn't share its text): ${r.path}.`;
          }),
        ).open(),
    });
    this.addCommand({ id: 'think-about-this', name: 'Think about this', callback: () => this.thinkAboutCurrent() });
    this.addCommand({
      id: 'next-question',
      name: 'Next question',
      callback: () =>
        this.withExercise((path) =>
          this.guarded('Next question', async (c) => {
            const r = await nextQuestion(c, path);
            return r.done ? 'That’s enough to write it up. Run "Finish exercise" (or keep going).' : 'New question added.';
          }),
        ),
    });
    this.addCommand({
      id: 'finish-exercise',
      name: 'Finish exercise',
      callback: () =>
        this.withExercise((path) =>
          this.guarded('Writing your pondering', async (c) => {
            const pondering = await finishExercise(c, path);
            await this.openNote(pondering);
            return `Pondering saved: ${pondering}.`;
          }),
        ),
    });
    this.registerObsidianProtocolHandler('thinking-digest', (params) => {
      if (params.think) void this.startThinking(decodeURIComponent(params.think).replace(/\.md$/, ''));
    });

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.trackRename(file.path, oldPath)));
    this.app.workspace.onLayoutReady(() => void this.maybeAutoRun());
    this.registerInterval(window.setInterval(() => void this.maybeAutoRun(), CHECK_EVERY_MS));
  }

  private ctx(): Ctx {
    const env: Env = {
      vault: obsidianVault(this.app),
      http: obsidianHttp,
      exec: nodeExec,
      cliPath: findClaudeCli(this.state.settings.cliPath),
      toMarkdown: (html) => htmlToMarkdown(html),
      now: () => new Date(),
      newHex: randomHex,
      log: (msg, extra) => console.log(`[thinking-digest] ${msg}`, extra ?? ''),
    };
    return { env, state: this.state, save: () => this.saveState() };
  }

  private async guarded(label: string, fn: (c: Ctx) => Promise<string>): Promise<void> {
    if (this.running) {
      new Notice('Thinking Digest is already running.');
      return;
    }
    this.running = true;
    const notice = new Notice(`Thinking Digest: ${label}…`, 0);
    try {
      const msg = await fn(this.ctx());
      notice.hide();
      new Notice(`Thinking Digest: ${msg}`, 8000);
    } catch (err) {
      notice.hide();
      console.error('[thinking-digest]', err);
      new Notice(`Thinking Digest: ${label} failed: ${(err as Error).message}`, 12000);
    } finally {
      this.running = false;
    }
  }

  private async maybeAutoRun(): Promise<void> {
    const s = this.state.settings;
    const ready = s.provider === 'cli' ? !!findClaudeCli(s.cliPath) : !!s.apiKey;
    if (!s.autoRun || !ready || this.running) return;
    const today = localDate(new Date());
    const exists = await digestExists(this.ctx(), today);
    if (!isDigestDue({ now: new Date(), settings: s, lastRunDate: this.state.lastRunDate, digestExists: exists })) return;
    await this.guarded('Digest', async (c) => {
      const msg = await runDaily(c);
      await this.openNote(`${s.digestFolder}/${today}`, false);
      return msg;
    });
  }

  private pickExportZip(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void this.guarded('Substack export import', async (c) => {
        const r = await importSubstackZip(c, new Uint8Array(await file.arrayBuffer()));
        return `Substack export: ${r.written} written, ${r.unchanged} unchanged, ${r.keptEdits.length} kept your edits.`;
      });
    };
    input.click();
  }

  private async startThinking(source: string): Promise<void> {
    await this.guarded('Starting a thinking exercise', async (c) => {
      const path = await startExercise(c, source);
      await this.openNote(path);
      return 'Answer under the question, then run "Next question".';
    });
  }

  private thinkAboutCurrent(): void {
    const s = this.state.settings;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file) {
      new Notice('Thinking Digest: open a note (or a digest item) first.');
      return;
    }
    const path = file.path.replace(/\.md$/, '');
    if (inFolder(path, s.exerciseFolder)) {
      new Notice('Thinking Digest: this is already an exercise. Use "Next question" or "Finish exercise".');
      return;
    }
    const source = inFolder(path, s.digestFolder) ? sourceAtLine(view.editor.getValue(), view.editor.getCursor().line) : path;
    if (!source) {
      new Notice('Thinking Digest: put your cursor inside a digest item first.');
      return;
    }
    void this.startThinking(source);
  }

  private withExercise(run: (path: string) => Promise<void>): void {
    const file = this.app.workspace.getActiveFile();
    const path = file?.path.replace(/\.md$/, '');
    if (!path || !inFolder(path, this.state.settings.exerciseFolder)) {
      new Notice('Thinking Digest: open a thinking exercise first.');
      return;
    }
    void (async () => {
      await this.app.workspace.getActiveViewOfType(MarkdownView)?.save();
      await run(path);
    })();
  }

  private async openNote(path: string, notifyMissing = true): Promise<void> {
    const file = this.app.vault.getFileByPath(normalizePath(`${path}.md`));
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else if (notifyMissing) new Notice(`Thinking Digest: ${path} doesn't exist yet.`);
  }

  private trackRename(newFile: string, oldFile: string): void {
    const from = oldFile.replace(/\.md$/, '');
    const to = newFile.replace(/\.md$/, '');
    const move = (rec: Record<string, string>) => {
      if (from in rec) {
        rec[to] = rec[from];
        delete rec[from];
      }
    };
    move(this.state.handled);
    move(this.state.extracted);
    for (const imp of Object.values(this.state.imports)) if (imp.path === from) imp.path = to;
    void this.saveState();
  }

  async loadState(): Promise<void> {
    const saved = ((await this.loadData()) ?? {}) as Partial<PluginState>;
    const base = EMPTY_STATE();
    this.state = { ...base, ...saved, settings: { ...base.settings, ...(saved.settings ?? {}) } };
  }

  async saveState(): Promise<void> {
    await this.saveData(this.state);
  }
}

class DigestSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ThinkingDigestPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.state.settings;
    const save = async (patch: Partial<Settings>) => {
      Object.assign(s, patch);
      await this.plugin.saveState();
    };
    const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

    const detected = findClaudeCli(s.cliPath);
    new Setting(containerEl)
      .setName('Model provider')
      .setDesc('Claude Code CLI runs on your Claude subscription; API uses an Anthropic API key.')
      .addDropdown((d) =>
        d
          .addOption('cli', 'Claude Code CLI')
          .addOption('api', 'Anthropic API key')
          .setValue(s.provider)
          .onChange(async (v) => {
            await save({ provider: v === 'api' ? 'api' : 'cli' });
            this.display();
          }),
      );
    if (s.provider === 'cli') {
      new Setting(containerEl)
        .setName('Claude CLI path')
        .setDesc(detected ? `Using ${detected}` : 'Not found. Install Claude Code or enter the full path to `claude`.')
        .addText((t) => t.setPlaceholder('auto-detect').setValue(s.cliPath).onChange((v) => save({ cliPath: v.trim() })));
    } else {
      new Setting(containerEl)
        .setName('Anthropic API key')
        .setDesc('Stored in this plugin’s data, never in your notes.')
        .addText((t) => {
          t.inputEl.type = 'password';
          t.setPlaceholder('sk-ant-…').setValue(s.apiKey).onChange((v) => save({ apiKey: v.trim() }));
        });
    }
    new Setting(containerEl)
      .setName('Model')
      .addText((t) => t.setValue(s.model).onChange((v) => save({ model: v.trim() || s.model })));
    new Setting(containerEl)
      .setName('Run automatically')
      .setDesc('Generate the digest when Obsidian is open on digest days after the digest time.')
      .addToggle((t) => t.setValue(s.autoRun).onChange((v) => save({ autoRun: v })));
    new Setting(containerEl)
      .setName('Digest time')
      .setDesc('24-hour HH:MM.')
      .addText((t) => t.setValue(s.digestTime).onChange((v) => /^\d{2}:\d{2}$/.test(v) && save({ digestTime: v })));
    new Setting(containerEl)
      .setName('Digest days')
      .setDesc('Comma-separated, e.g. Mon, Tue, Wed, Thu, Fri.')
      .addText((t) =>
        t.setValue(s.digestDays.map((d) => WEEKDAYS[d]).join(', ')).onChange((v) => {
          const days = list(v).map((x) => WEEKDAYS.findIndex((w) => w.toLowerCase() === x.slice(0, 3).toLowerCase())).filter((d) => d >= 0);
          if (days.length) void save({ digestDays: days });
        }),
      );
    new Setting(containerEl)
      .setName('Shifts day')
      .addDropdown((d) => {
        WEEKDAYS.forEach((w, i) => d.addOption(String(i), w));
        d.setValue(String(s.shiftsDay)).onChange((v) => save({ shiftsDay: Number(v) }));
      });
    new Setting(containerEl)
      .setName('Items per day')
      .addSlider((sl) => sl.setLimits(1, 10, 1).setValue(s.dailyCap).setDynamicTooltip().onChange((v) => save({ dailyCap: v })));
    new Setting(containerEl)
      .setName('Substack URL')
      .addText((t) => t.setValue(s.substackUrl).onChange((v) => save({ substackUrl: v.trim() })));

    containerEl.createEl('h3', { text: 'Folders' });
    const folder = (
      name: string,
      key: 'writingFolder' | 'digestFolder' | 'takesFolder' | 'positionsPath' | 'voiceRulesPath' | 'clippingsFolder' | 'exerciseFolder' | 'ponderingFolder',
    ) =>
      new Setting(containerEl).setName(name).addText((t) => t.setValue(s[key]).onChange((v) => v.trim() && save({ [key]: v.trim() })));
    const folders = (name: string, key: 'sourceFolders' | 'excludedFolders' | 'priorFolders' | 'thoughtFolders', desc: string) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => t.setValue(s[key].join(', ')).onChange((v) => save({ [key]: list(v) })));
    folders('Source folders', 'sourceFolders', 'New notes here become digest candidates.');
    folders('Excluded folders', 'excludedFolders', 'Never candidates (e.g. transcripts).');
    folders('Prior folders', 'priorFolders', 'Your own thinking used to ground drafts.');
    folders('Quick-notes folders', 'thoughtFolders', 'Your running thoughts (Fleeting Notes). Read as your own words; new lines only. Quick thought writes to the first one.');
    new Setting(containerEl)
      .setName('Private tag')
      .setDesc('Notes tagged with this (or with it set to true in frontmatter) are never read.')
      .addText((t) => t.setValue(s.privateTag).onChange((v) => save({ privateTag: v.trim().replace(/^#/, '') })));
    folder('Writing folder (Substack)', 'writingFolder');
    folder('Digest folder', 'digestFolder');
    folder('Takes folder', 'takesFolder');
    folder('Positions note', 'positionsPath');
    folder('Voice rules note', 'voiceRulesPath');
    folder('Clippings folder ("Add link" saves here)', 'clippingsFolder');
    folder('Exercises folder', 'exerciseFolder');
    folder('Ponderings folder', 'ponderingFolder');
    new Setting(containerEl)
      .setName('Questions per exercise')
      .addSlider((sl) => sl.setLimits(3, 8, 1).setValue(s.maxRounds).setDynamicTooltip().onChange((v) => save({ maxRounds: v })));

    containerEl.createEl('h3', { text: 'Loop' });
    const today = localDate(new Date());
    const rate = rewriteRate(this.plugin.state.metrics, '0000-01-01', today);
    const harvested = this.plugin.state.harvested.length;
    containerEl.createEl('p', {
      text:
        rate === null
          ? `No harvested takes yet (${harvested} digest(s) harvested).`
          : `Rewrite rate so far: ${Math.round(rate * 100)}% across ${harvested} digest(s). Lower means drafts sound more like you.`,
    });
  }
}

class QuickThoughtModal extends Modal {
  private text = '';

  constructor(app: App, private onSubmit: (text: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Quick thought');
    new Setting(this.contentEl).addTextArea((t) => {
      t.setPlaceholder('what’s on your mind…').onChange((v) => (this.text = v));
      t.inputEl.rows = 3;
      t.inputEl.style.width = '100%';
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    this.contentEl.createEl('p', { text: 'Enter saves · Shift+Enter for a new line', cls: 'setting-item-description' });
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.text.trim()) return;
        this.close();
        void this.onSubmit(this.text);
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class AddLinkModal extends Modal {
  private url = '';
  private note = '';

  constructor(app: App, private onSubmit: (url: string, note: string) => Promise<void>) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.setTitle('Add link');
    let urlInput: HTMLInputElement | null = null;
    new Setting(this.contentEl).setName('Link').addText((t) => {
      urlInput = t.inputEl;
      t.setPlaceholder('https://…').onChange((v) => (this.url = v));
      t.inputEl.style.width = '100%';
    });
    new Setting(this.contentEl)
      .setName('First reaction (optional)')
      .setDesc('One line on what you think. It seeds your take in the digest.')
      .addTextArea((t) => {
        t.setPlaceholder('this is wrong because…').onChange((v) => (this.note = v));
        t.inputEl.rows = 3;
        t.inputEl.style.width = '100%';
      });
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText('Save')
        .setCta()
        .onClick(() => this.submit()),
    );
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.submit();
    });
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (/^https?:\/\/\S+$/.test(clip) && urlInput) {
        (urlInput as HTMLInputElement).value = clip;
        this.url = clip;
      }
    } catch {
      // clipboard access denied: the field just stays empty
    }
  }

  private submit(): void {
    if (!this.url.trim()) return;
    this.close();
    void this.onSubmit(this.url.trim(), this.note);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
