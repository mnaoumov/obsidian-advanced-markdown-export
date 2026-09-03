const BYTES_PER_UNIT = 1024;
const DECIMALS = 1;
const UNITS = [
  'B',
  'KB',
  'MB',
  'GB',
  'TB'
] as const;

/**
 * Renders a byte count the way a file manager does, so the running total in the export tree answers "is
 * this export getting huge?" at a glance.
 *
 * @param bytes - The number of bytes.
 * @returns The formatted size, e.g. `1.4 MB`.
 */
export function formatBytes(bytes: number): string {
  let size = bytes;
  let unit: string = UNITS[0];
  let isInBytes = true;

  for (const largerUnit of UNITS.slice(1)) {
    if (size < BYTES_PER_UNIT) {
      break;
    }

    size /= BYTES_PER_UNIT;
    unit = largerUnit;
    isInBytes = false;
  }

  // Whole bytes never want a decimal point: `817 B`, not `817.0 B`.
  return `${isInBytes ? String(size) : size.toFixed(DECIMALS)} ${unit}`;
}
