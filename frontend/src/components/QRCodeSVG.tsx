'use client';

import React, { useMemo } from 'react';
import { generateQRMatrix, getQRCodeSVGPath } from '@/lib/qrcode';

export interface QRCodeSVGProps {
  value: string;
  size?: number;
  className?: string;
  bgColor?: string;
  fgColor?: string;
}

export default function QRCodeSVG({
  value,
  size = 180,
  className = '',
  bgColor = '#ffffff',
  fgColor = '#0f172a',
}: QRCodeSVGProps) {
  const { matrixSize, pathData } = useMemo(() => {
    try {
      const matrix = generateQRMatrix(value);
      const path = getQRCodeSVGPath(matrix);
      return { matrixSize: matrix.size, pathData: path };
    } catch {
      // Fallback
      return { matrixSize: 21, pathData: '' };
    }
  }, [value]);

  // Include 2-module quiet zone padding around matrix
  const padding = 2;
  const totalViewBox = matrixSize + padding * 2;

  return (
    <div
      className={`inline-flex items-center justify-center p-2 rounded-xl bg-white shadow-inner ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`-${padding} -${padding} ${totalViewBox} ${totalViewBox}`}
        className="w-full h-full"
        shapeRendering="crispEdges"
      >
        <rect
          x={-padding}
          y={-padding}
          width={totalViewBox}
          height={totalViewBox}
          fill={bgColor}
        />
        <path d={pathData} fill={fgColor} />
      </svg>
    </div>
  );
}

