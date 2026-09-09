/**
 * Export & Manifest Print Engine
 * Provides CSV file generation and official Kenyan NTSA/Police passenger manifest printouts.
 */

export interface ManifestPassenger {
  seat_number: number;
  passenger_name: string;
  phone?: string | null;
  board_stop: string;
  alight_stop: string;
  status: string;
}

export interface ManifestPrintData {
  tripName: string;
  routeName: string;
  vehiclePlate: string;
  driverName: string;
  departureTime?: string | null;
  passengers: ManifestPassenger[];
}

/**
 * Generates and downloads a sanitized CSV file in the browser.
 */
export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void {
  const sanitize = (val: string | number | boolean | null | undefined): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvContent = [
    headers.map(sanitize).join(','),
    ...rows.map((row) => row.map(sanitize).join(',')),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Opens a print-formatted official Kenyan Passenger Manifest window.
 */
export function printPoliceManifest(data: ManifestPrintData): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups to print the passenger manifest.');
    return;
  }

  const rowsHtml = data.passengers
    .map(
      (p, idx) => `
      <tr>
        <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
        <td style="text-align: center; font-family: monospace; font-weight: bold; font-size: 14px;">#${p.seat_number}</td>
        <td style="font-weight: 600;">${p.passenger_name}</td>
        <td style="font-family: monospace;">${p.phone || '—'}</td>
        <td>${p.board_stop}</td>
        <td>${p.alight_stop}</td>
        <td style="text-align: center; text-transform: uppercase; font-size: 11px; font-weight: bold;">
          <span style="border: 1px solid #333; padding: 2px 6px; border-radius: 4px;">
            ${p.status === 'boarded' ? 'CHECKED IN' : p.status}
          </span>
        </td>
        <td style="border-bottom: 1px dotted #999; min-width: 80px;">&nbsp;</td>
      </tr>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Official Passenger Manifest - ${data.vehiclePlate}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 10px; font-size: 12px; }
          .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
          .title { font-size: 18px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin: 0; }
          .subtitle { font-size: 11px; color: #555; text-transform: uppercase; margin-top: 4px; }
          .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 15px; font-size: 11px; }
          .meta-box { border: 1px solid #ccc; padding: 6px 10px; border-radius: 4px; background: #fdfdfd; }
          .meta-label { font-size: 9px; text-transform: uppercase; color: #666; font-weight: bold; }
          .meta-val { font-size: 12px; font-weight: bold; color: #000; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #f0f0f0; border: 1px solid #444; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
          td { border: 1px solid #ccc; padding: 6px 8px; font-size: 11px; }
          .footer { margin-top: 25px; display: flex; justify-content: space-between; font-size: 10px; border-top: 1px solid #999; padding-top: 10px; }
          .sign-line { border-top: 1px solid #000; width: 180px; margin-top: 30px; text-align: center; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">REPUBLIC OF KENYA · TRANSIT CARRIER MANIFEST</div>
          <div class="subtitle">BUSGO DIGITAL COMMUTE PLATFORM · NTSA & POLICE CHECKPOINT COMPLIANCE</div>
        </div>

        <div class="meta-grid">
          <div class="meta-box">
            <div class="meta-label">Vehicle Registration</div>
            <div class="meta-val" style="font-family: monospace;">${data.vehiclePlate}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Assigned Driver</div>
            <div class="meta-val">${data.driverName}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Route Service</div>
            <div class="meta-val">${data.routeName}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Trip Schedule</div>
            <div class="meta-val">${data.departureTime || 'Scheduled Transit'}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Total Manifest Count</div>
            <div class="meta-val">${data.passengers.length} Passenger(s)</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Date Generated</div>
            <div class="meta-val">${new Date().toLocaleString('en-KE')}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 25px; text-align: center;">No.</th>
              <th style="width: 50px; text-align: center;">Seat</th>
              <th>Passenger Name</th>
              <th>Contact Phone</th>
              <th>Boarding Station</th>
              <th>Destination Station</th>
              <th style="width: 90px; text-align: center;">Status</th>
              <th style="width: 90px;">Verification</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml.length > 0 ? rowsHtml : '<tr><td colspan="8" style="text-align: center; padding: 20px;">No passengers currently booked on this service.</td></tr>'}
          </tbody>
        </table>

        <div class="footer">
          <div>
            <p style="margin: 0; font-weight: bold;">System Verification Token:</p>
            <p style="margin: 2px 0 0 0; font-family: monospace; color: #666;">BUSGO-CERT-${Date.now().toString(36).toUpperCase()}</p>
          </div>
          <div class="sign-line">
            Driver / Conductor Signature
          </div>
          <div class="sign-line">
            Inspection Officer Stamp & Sign
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
