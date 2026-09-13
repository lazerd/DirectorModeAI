import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, Copy, Download, ExternalLink, Share2, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { shareMixerEvent } from "@/lib/share";

interface EventCodeQRProps {
  /** Needed for the poster, which is built server-side from the event record. */
  eventId: string;
  eventCode: string;
  eventName: string;
}

const EventCodeQR = ({ eventId, eventCode, eventName }: EventCodeQRProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const [publicUrl, setPublicUrl] = useState("");
  const [posterBusy, setPosterBusy] = useState(false);

  useEffect(() => {
    // Use the current origin so this works in dev, staging, and prod — the
    // old hardcoded https://club.coachmode.ai URL broke local testing.
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/event/${eventCode}`;
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

  /**
   * The printable poster.
   *
   * Built on the server rather than in the browser: it is a real PDF at US
   * Letter with the event's theme, its date in CLUB time and the club's own
   * mark, none of which this component knows. A canvas-to-PNG "poster" would
   * print at screen resolution and blur.
   */
  const handleDownloadPoster = async () => {
    setPosterBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/poster`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not build the poster.");
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${eventName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-poster.pdf`;
      link.href = href;
      link.click();
      // Revoked on the next tick — Safari cancels the download if it goes now.
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast({
        title: "Poster downloaded",
        description: "Letter size, ready to print and pin up.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Poster failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setPosterBusy(false);
    }
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

  const handleNativeShare = async () => {
    const result = await shareMixerEvent({ eventName, eventCode });
    if (result === "copied") {
      toast({
        title: "Link copied!",
        description: "Public event link copied to clipboard",
      });
    } else if (result === "shared") {
      // The OS share sheet confirmed — no toast needed, the system UI
      // already gave the user visual feedback.
    } else if (result === "failed") {
      toast({
        title: "Share failed",
        description: "Could not copy or share the link. Please try again.",
        variant: "destructive",
      });
    }
    // result === "cancelled" → user dismissed, stay silent.
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
            {/*
              Poster first, because that is what gets pinned up. The bare PNG
              stays because it is the thing you paste into a newsletter or a
              group text, where a PDF is useless.
            */}
            <Button onClick={handleDownloadPoster} disabled={posterBusy} className="w-full">
              <Printer className="h-4 w-4 mr-2" />
              {posterBusy ? "Building poster…" : "Download printable poster"}
            </Button>
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleDownloadQR} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                QR image only
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
          {/* Prominent share button — on mobile this opens the native share
              sheet (SMS, WhatsApp, email, etc.), on desktop it falls back to
              copying the link to clipboard. */}
          <Button onClick={handleNativeShare} className="w-full" size="lg">
            <Share2 className="h-4 w-4 mr-2" />
            Share with players
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default EventCodeQR;
