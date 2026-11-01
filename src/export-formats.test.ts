import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { Platform } from 'obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getAvailableExportFormatOptions,
  getExportFormatOptions,
  parseExportFormat,
  resolveAvailableExportFormat
} from './export-formats.ts';
import { ExportFormat } from './plugin-settings.ts';

interface MockIsDesktopApp {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Each test selects the platform branch by changing this mock flag.
  isDesktopApp: boolean;
}

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  Platform: { isDesktopApp: true }
}));

function setIsDesktopApp(isDesktopApp: boolean): void {
  castTo<MockIsDesktopApp>(Platform).isDesktopApp = isDesktopApp;
}

describe('export formats', () => {
  beforeEach(() => {
    setIsDesktopApp(true);
  });

  it('should list every format, Markdown first', () => {
    expect([...getExportFormatOptions().keys()]).toEqual([ExportFormat.Markdown, ExportFormat.Epub, ExportFormat.Pdf]);
  });

  it('should hand out a fresh map each time', () => {
    getExportFormatOptions().clear();
    expect(getExportFormatOptions().size).toBe(3);
  });

  it('should offer PDF on the desktop app only', () => {
    expect(getAvailableExportFormatOptions().has(ExportFormat.Pdf)).toBe(true);
    setIsDesktopApp(false);
    expect([...getAvailableExportFormatOptions().keys()]).toEqual([ExportFormat.Markdown, ExportFormat.Epub]);
  });

  it('should fall back to Markdown for a format this platform cannot produce', () => {
    expect(resolveAvailableExportFormat(ExportFormat.Pdf)).toBe(ExportFormat.Pdf);
    setIsDesktopApp(false);
    expect(resolveAvailableExportFormat(ExportFormat.Pdf)).toBe(ExportFormat.Markdown);
    expect(resolveAvailableExportFormat(ExportFormat.Epub)).toBe(ExportFormat.Epub);
  });

  it('should parse every format back from its value, and refuse anything else', () => {
    expect(parseExportFormat('Epub')).toBe(ExportFormat.Epub);
    expect(parseExportFormat('Markdown')).toBe(ExportFormat.Markdown);
    expect(parseExportFormat('Pdf')).toBe(ExportFormat.Pdf);
    expect(() => parseExportFormat('Docx')).toThrow('Unknown export format: Docx');
  });
});
