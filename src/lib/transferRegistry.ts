import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import {
  buildBarangayFile,
  buildTerminalFile,
  type TransferFile,
  type TransferKind,
} from './transferState';

/**
 * What differs between the two Configuration screens' Import / Export, in
 * one table instead of two parallel implementations.
 *
 * Every field below was previously a literal repeated in both screens: the
 * file kind, the store's `kind` discriminator, the collection to export, the
 * builder, the noun, and the one genuine behavioural question — whether this
 * registry's file may CREATE the municipalities its stops link to.
 *
 * `createsMunicipalities` is the single branch the transfer flow needs, and
 * the rule it encodes is the one the module documents: Barangay Configuration
 * owns the municipality registry, so its file restores it; Terminal
 * Configuration does not, so its file only ever RE-LINKS to a municipality
 * this device already lists. Encoding it here means the flow has no `if` on
 * a screen's identity, and a third registry is a third row rather than a
 * third copy of the same 130 lines.
 */
export type TransferRegistry = {
  /** Which file this screen reads and writes. */
  kind: TransferKind;
  /** The store's registry discriminator, so a file can never cross over. */
  storeKind: import('../data/schema').TerminalKind;
  /** Builds the document from this registry's live rows. */
  build: (
    municipalities: MunicipalityRowRecord[],
    stops: TerminalRowRecord[],
    now: number,
  ) => TransferFile;
  /**
   * Whether an import may create the file's municipalities. False means link
   * to what this device already has and leave the rest `Not linked`.
   */
  createsMunicipalities: boolean;
  /** The trigger row's own line, and the sheet's two headings. */
  triggerLabel: string;
  sheetTitle: string;
  subtitle: string;
  /**
   * The registry's own nouns, in the three forms the copy needs. Every place
   * the sheet used to ask "is this a barangay file?" lives here instead, so
   * the renderer holds no policy — and because the three are separate fields,
   * no one of them has to serve a grammatical role it does not fit.
   */
  /** The count row: "Barangays on this device". */
  stopsLabel: string;
  /** A count, and the import notice: "Imported 20 barangays". */
  stopsNoun: string;
  /** The singular in a sentence about the screen's subject: "Export barangay configuration". */
  stopsSingular: string;
};

/** The two registries, in the order the Settings screen lists them. */
export const BARANGAY_REGISTRY: TransferRegistry = {
  kind: 'barangay-config',
  storeKind: 'BARANGAY',
  build: buildBarangayFile,
  createsMunicipalities: true,
  triggerLabel: 'Municipalities and barangays, with their registered KM',
  sheetTitle: 'Barangay data',
  subtitle: 'Municipalities and registered KM',
  stopsLabel: 'Barangays on this device',
  stopsNoun: 'barangays',
  stopsSingular: 'barangay',
};

export const TERMINAL_REGISTRY: TransferRegistry = {
  kind: 'terminal-config',
  storeKind: 'TERMINAL',
  build: buildTerminalFile,
  createsMunicipalities: false,
  triggerLabel: 'Terminals, with their registered KM',
  sheetTitle: 'Terminal data',
  subtitle: 'Registered KM and route order',
  stopsLabel: 'Terminals on this device',
  stopsNoun: 'terminals',
  stopsSingular: 'terminal',
};

/** The sheet's closing note: what this registry's PDF does and does not carry. */
export function transferScopeNote(registry: TransferRegistry): string {
  return registry.createsMunicipalities
    ? 'A barangay PDF carries every municipality and every barangay with its registered KM. Nothing already on this device is deleted.'
    : 'A terminal PDF carries every terminal with its registered KM. Municipalities are referenced by name and never created by this screen.';
}
