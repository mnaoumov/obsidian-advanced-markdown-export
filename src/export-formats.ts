import { Platform } from 'obsidian';

import { ExportFormat } from './plugin-settings.ts';

/**
 * Listed in the order a dropdown shows them: the plugin's original output first.
 */
const EXPORT_FORMAT_ENTRIES: readonly (readonly [ExportFormat, string])[] = [
  [ExportFormat.Markdown, 'Markdown files'],
  [ExportFormat.Epub, 'EPUB book'],
  [ExportFormat.Pdf, 'PDF document']
];

const EXPORT_FORMAT_LABELS: ReadonlyMap<ExportFormat, string> = new Map(EXPORT_FORMAT_ENTRIES);

/**
 * The formats this platform can produce. PDF needs Electron to print it, so a phone never sees it.
 *
 * @returns The available formats with their labels.
 */
export function getAvailableExportFormatOptions(): Map<ExportFormat, string> {
  const options = getExportFormatOptions();

  if (!Platform.isDesktopApp) {
    options.delete(ExportFormat.Pdf);
  }

  return options;
}

/**
 * Every format with its label, in the order a dropdown lists them.
 *
 * @returns A fresh map, so a dropdown may take ownership of it.
 */
export function getExportFormatOptions(): Map<ExportFormat, string> {
  return new Map(EXPORT_FORMAT_LABELS);
}

/**
 * Reads a format back from its stored or displayed value.
 *
 * @param value - The format's value.
 * @returns The format.
 * @throws When the value names no format.
 */
export function parseExportFormat(value: string): ExportFormat {
  const formatsByValue = new Map<string, ExportFormat>([...EXPORT_FORMAT_LABELS.keys()].map((candidate) => [candidate, candidate]));
  const format = formatsByValue.get(value);

  if (format === undefined) {
    throw new Error(`Unknown export format: ${value}`);
  }

  return format;
}

/**
 * The format an export starts on: the configured one, or Markdown where the configured one cannot be
 * produced - a PDF default carried to a phone by Sync.
 *
 * @param format - The configured format.
 * @returns A format this platform can produce.
 */
export function resolveAvailableExportFormat(format: ExportFormat): ExportFormat {
  return getAvailableExportFormatOptions().has(format) ? format : ExportFormat.Markdown;
}
