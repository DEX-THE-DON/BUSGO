/**
 * Handheld Thermal POS Bluetooth & ESC/POS Client Driver
 * ======================================================
 * Supports 58mm (32 chars) and 80mm (48 chars) thermal roll printers
 * over Web Bluetooth GATT, WebUSB, or offline raw binary streams.
 *
 * Compatible with Kenyan PSV conductor hardware:
 * - Sunmi V2 / V2 Pro
 * - MPT-II / Zjiang POS-5802 / POS-80
 * - Telpo & Nexgo Android Handhelds
 */

import { TicketData } from '@/components/user/PrintableTicketModal';

// Standard Bluetooth GATT Printing Service UUIDs
export const BT_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Generic Printer Service
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Common POS / ZJiang / MPT-II
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent TX/RX
];

export const BT_WRITE_CHARACTERISTICS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

// ESC/POS Command Byte Sequences
const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  DOUBLE_HEIGHT: [GS, 0x21, 0x01],
  DOUBLE_BOTH: [GS, 0x21, 0x11],
  NORMAL_SIZE: [GS, 0x21, 0x00],
  FEED_CUT: [GS, 0x56, 0x41, 0x00],
};

function stringToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes.push(code < 128 ? code : 63); // ASCII or '?' fallback
  }
  return bytes;
}

function padLine(left: string, right: string, width: number = 32): string {
  const spaceNeeded = width - left.length - right.length;
  if (spaceNeeded < 1) {
    const maxLeft = Math.max(0, width - right.length - 1);
    left = left.substring(0, maxLeft);
  }
  const spaces = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(spaces) + right;
}

function centerText(text: string, width: number = 32): string {
  if (text.length >= width) return text.substring(0, width);
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

/**
 * Builds a native ESC/POS QR code command sequence (Model 2).
 */
function buildQrCodeCommand(text: string): number[] {
  const data = stringToBytes(text);
  const out: number[] = [];

  // Model 2
  out.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  // Module size 4
  out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04);
  // Error correction Level M
  out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
  // Store data
  const pLen = data.length + 3;
  const pL = pLen & 0xff;
  const pH = (pLen >> 8) & 0xff;
  out.push(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...data);
  // Print
  out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, 0x0a);

  return out;
}

/**
 * Generates raw ESC/POS binary bytes for a passenger boarding slip.
 * Works 100% offline without hitting any backend server.
 */
export function buildEscPosTicketBytes(
  ticket: TicketData,
  widthMm: 58 | 80 = 58
): Uint8Array {
  const cols = widthMm === 80 ? 48 : 32;
  const bytes: number[] = [];

  const add = (cmd: number[]) => bytes.push(...cmd);
  const addLine = (str: string) => bytes.push(...stringToBytes(str + '\n'));

  // 1. Initialize
  add(CMD.INIT);
  add(CMD.ALIGN_CENTER);

  // 2. Header
  const sacco = (ticket.saccoName || 'BUSGO TRANSIT SACCO').toUpperCase();
  add(CMD.BOLD_ON);
  add(CMD.DOUBLE_HEIGHT);
  addLine(sacco);
  add(CMD.NORMAL_SIZE);
  addLine('STAGE PASSENGER TICKET');
  addLine('HELPLINE: 0716 314 831');
  addLine('='.repeat(cols));

  // 3. Highlighted Assignment
  add(CMD.DOUBLE_BOTH);
  add(CMD.BOLD_ON);
  addLine(`SEAT: #${ticket.seatNumber}`);
  add(CMD.NORMAL_SIZE);
  add(CMD.BOLD_ON);
  addLine(`BUS: ${ticket.vehiclePlate || 'ASSIGNED AT STAGE'}`);
  add(CMD.BOLD_OFF);
  addLine('-'.repeat(cols));

  // 4. Passenger & Journey
  add(CMD.ALIGN_LEFT);
  const depTime = ticket.departureTime
    ? new Date(ticket.departureTime).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }) +
      ' ' +
      new Date(ticket.departureTime).toLocaleDateString([], {
        day: '2-digit',
        month: 'short',
      })
    : new Date().toLocaleString();

  addLine(padLine('TKT NO:', `BG-${ticket.bookingId}`, cols));
  addLine(padLine('DEPART:', depTime, cols));
  addLine(
    padLine(
      'NAME:',
      (ticket.passengerName || 'PASSENGER').toUpperCase().substring(0, cols - 8),
      cols
    )
  );
  addLine(padLine('PHONE:', ticket.passengerPhone || 'WALK-IN', cols));
  addLine(
    padLine(
      'BOARD:',
      (ticket.boardStop || 'ORIGIN').toUpperCase().substring(0, cols - 9),
      cols
    )
  );
  addLine(
    padLine(
      'ALIGHT:',
      (ticket.alightStop || 'DESTINATION').toUpperCase().substring(0, cols - 10),
      cols
    )
  );
  addLine('-'.repeat(cols));

  // 5. Payment details
  const fare = ticket.fareAmount || 0;
  const luggage = ticket.luggageFee || 0;
  const total = fare + luggage;
  addLine(padLine('FARE:', `KES ${fare.toLocaleString()}`, cols));
  if (luggage > 0) {
    addLine(padLine('MZIGO:', `KES ${luggage.toLocaleString()}`, cols));
  }
  add(CMD.BOLD_ON);
  addLine(padLine('TOTAL PAID:', `KES ${total.toLocaleString()}`, cols));
  addLine(padLine('M-PESA REF:', ticket.receiptNumber || `MP-${ticket.bookingId}`, cols));
  add(CMD.BOLD_OFF);
  addLine('='.repeat(cols));

  // 6. QR Code
  add(CMD.ALIGN_CENTER);
  const qrString =
    ticket.qrData ||
    `BUSGO:TKT:${ticket.bookingId}:${ticket.seatNumber}:${ticket.receiptNumber || 'PAID'}`;
  add(buildQrCodeCommand(qrString));
  addLine('SCAN QR TO BOARD');

  // 7. Legal Conditions
  addLine('');
  addLine('NOTICE: Retain ticket until alight.');
  addLine('Luggage carried at passenger risk.');
  addLine('NTSA TOLL FREE: 0800 720 000');
  addLine('*'.repeat(cols));

  // 8. Feed & Cut
  addLine('\n\n\n');
  add(CMD.FEED_CUT);

  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Web Bluetooth Printing Connection & Transmission
// ---------------------------------------------------------------------------

export interface BluetoothPrinterState {
  connected: boolean;
  deviceName: string | null;
  statusText: string;
}

let activeBluetoothDevice: any = null;
let activeCharacteristic: any = null;

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export async function connectBluetoothThermalPrinter(): Promise<string> {
  if (!isWebBluetoothSupported()) {
    throw new Error(
      'Web Bluetooth is not supported on this browser. Use Chrome on Android or desktop with Bluetooth enabled.'
    );
  }

  // Request Bluetooth device
  const device = await (navigator as any).bluetooth.requestDevice({
    filters: [
      { services: ['000018f0-0000-1000-8000-00805f9b34fb'] },
      { services: ['0000ffe0-0000-1000-8000-00805f9b34fb'] },
      { services: ['e7810a71-73ae-499d-8c15-faa9aef0c3f2'] },
      { services: ['49535343-fe7d-4ae5-8fa9-9fafd205e455'] },
      { namePrefix: 'MPT' },
      { namePrefix: 'POS' },
      { namePrefix: 'RPP' },
      { namePrefix: 'ZJ' },
      { namePrefix: 'Sunmi' },
      { namePrefix: 'Printer' },
    ],
    optionalServices: BT_PRINTER_SERVICES,
  });

  if (!device || !device.gatt) {
    throw new Error('No compatible Bluetooth printer selected.');
  }

  const server = await device.gatt.connect();

  // Try each known service UUID
  let writeChar: any = null;
  for (const serviceUuid of BT_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          writeChar = char;
          break;
        }
      }
      if (writeChar) break;
    } catch {
      // Continue to next service
    }
  }

  if (!writeChar) {
    throw new Error('Printer connected, but writable printing channel was not found.');
  }

  activeBluetoothDevice = device;
  activeCharacteristic = writeChar;

  // Persist device name in localStorage
  if (typeof window !== 'undefined' && device.name) {
    localStorage.setItem('busgo_last_bt_printer', device.name);
  }

  return device.name || 'Bluetooth Thermal Printer';
}

/**
 * Sends ESC/POS byte buffer to connected printer in safe BLE chunks (100 bytes).
 */
export async function sendEscPosToPrinter(bytes: Uint8Array): Promise<void> {
  if (!activeCharacteristic) {
    throw new Error('Printer is not connected. Connect printer first.');
  }

  const CHUNK_SIZE = 100;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    if (activeCharacteristic.writeValueWithoutResponse) {
      await activeCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await activeCharacteristic.writeValue(chunk);
    }
    // Small delay between Bluetooth GATT writes
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Download raw .bin ESC/POS file as fallback.
 */
export function downloadRawEscPosFile(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
