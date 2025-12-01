'use client';

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink, QrCode } from "lucide-react";

interface EventCodeQRProps {
  eventCode: string;
  eventName: string;
}

export default function EventCodeQR({ eventCode, eventName }: EventCodeQRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const url = `${window.location.origin}/event/${eventCode}`;
    setPublicUrl(url);

    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        url,
        {
          width: 256,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        },
        (error) => {
          if (error) console.error("Error generating QR code:", error);
        }
      );
    }
  }, [eventCode]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(eventCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleDownloadQR = () => {
    if (canvasRef.current) {
      const url = canvasRef.current.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `${eventName}-qr-code.png`;
      link.href = url;
      link.click();
    }
  };

  const handleOpenPublicView = () => {
    window.open(publicUrl, "_blank");
  };

  return (
    <div className="bg-white rounded-xl border-2 border-orange-200 p-6 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <QrCode className="h-5 w-5 text-orange-500" />
        <h2 className="text-lg font-bold">Share Event with Players</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Players can scan this QR code or enter the event code to view live standings and courts—no login required.
      </p>

      {/* Event Code Display */}
      <div className="mb-6">
        <label className="text-sm font-medium mb-2 block">Event Code</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 px-4 py-3 rounded-lg text-center">
            <span className="text-2xl font-bold font-mono tracking-wider text-orange-600">{eventCode}</span>
          </div>
          <button
            onClick={handleCopyCode}
            className="p-3 border rounded-lg hover:bg-gray-50"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
        {copied && <p className="text-xs text-green-600 mt-1">Code copied!</p>}
      </div>

      {/* QR Code Display */}
      <div className="mb-6">
        <label className="text-sm font-medium mb-2 block">QR Code</label>
        <div className="flex flex-col items-center gap-4">
          <div className="bg-white p-4 rounded-lg border-2">
            <canvas ref={canvasRef} />
          </div>
          <div className="flex gap-2 w-full">
            <button
              onClick={handleDownloadQR}
              className="flex-1 flex items-center justify-center gap-2 py-2 border rounded-lg hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              Download QR
            </button>
            <button
              onClick={handleOpenPublicView}
              className="flex-1 flex items-center justify-center gap-2 py-2 border rounded-lg hover:bg-gray-50"
            >
              <ExternalLink className="h-4 w-4" />
              Preview
            </button>
          </div>
        </div>
      </div>

      {/* Public URL */}
      <div>
        <label className="text-sm font-medium mb-2 block">Public Link</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 px-3 py-2 rounded-lg text-sm font-mono truncate">
            {publicUrl}
          </div>
          <button
            onClick={handleCopyLink}
            className="p-3 border rounded-lg hover:bg-gray-50"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
        {linkCopied && <p className="text-xs text-green-600 mt-1">Link copied!</p>}
      </div>
    </div>
  );
}
