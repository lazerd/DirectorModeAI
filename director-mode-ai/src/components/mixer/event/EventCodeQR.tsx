import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, Copy, Download, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EventCodeQRProps {
  eventCode: string;
  eventName: string;
}

const EventCodeQR = ({ eventCode, eventName }: EventCodeQRProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const [publicUrl, setPublicUrl] = useState("");

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
    toast({
      title: "Code copied!",
      description: "Event code copied to clipboard",
    });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    toast({
      title: "Link copied!",
      description: "Public event link copied to clipboard",
    });
  };

  const handleDownloadQR = () => {
    if (canvasRef.current) {
      const url = canvasRef.current.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `${eventName}-qr-code.png`;
      link.href = url;
      link.click();
      toast({
        title: "QR Code downloaded!",
        description: "QR code image saved to your device",
      });
    }
  };

  const handleOpenPublicView = () => {
    window.open(publicUrl, "_blank");
  };

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5" />
          Share Event with Players
        </CardTitle>
        <CardDescription>
          Players can scan this QR code or enter the event code to view live standings and courts—no login required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Event Code Display */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Event Code</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted px-4 py-3 rounded-lg text-center">
              <span className="text-2xl font-bold font-mono tracking-wider">{eventCode}</span>
            </div>
            <Button variant="outline" size="icon" onClick={handleCopyCode}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this code with players to let them view the event
          </p>
        </div>

        {/* QR Code Display */}
        <div className="space-y-3">
          <label className="text-sm font-medium">QR Code</label>
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white p-4 rounded-lg border-2 border-border">
              <canvas ref={canvasRef} />
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleDownloadQR} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Download QR
              </Button>
              <Button variant="outline" onClick={handleOpenPublicView} className="flex-1">
                <ExternalLink className="h-4 w-4 mr-2" />
                Preview
              </Button>
            </div>
          </div>
        </div>

        {/* Public URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Public Link</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted px-3 py-2 rounded-lg text-sm font-mono truncate">
              {publicUrl}
            </div>
            <Button variant="outline" size="icon" onClick={handleCopyLink}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EventCodeQR;
